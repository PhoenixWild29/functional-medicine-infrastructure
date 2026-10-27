/**
 * @jest-environment node
 *
 * Batch 3, PR 3: advancing a protocol phase fails loud.
 *
 * Before, a failed read of the current phase answered 404 "Tracking not
 * found", and a failed write of the advancement history still answered
 * { ok: true } — the phase moved with no record of who moved it or why.
 * Now the read failure answers 500, and a failed history write puts the
 * phase back and answers 500, so the advancement is all-or-nothing.
 */

import type { NextRequest } from 'next/server'
import { scriptedDb, DB_DOWN, type Script } from '@/__tests__/helpers/scripted-db'
import { POST, PATCH } from '../route'
import { phiLog, phiEntries, expectOnePhiRow } from '@/__tests__/helpers/phi-log'
import { logPhiWriteNotCompleted } from '@/lib/audit/phi-access'

const PT_1 = 'a3000000-0000-4000-8000-000000000001'
const PR_1 = 'c1000000-0000-4000-8000-000000000001'
const T_1 = 'e1000000-0000-4000-8000-000000000001'

let db = scriptedDb(() => undefined)

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockResolvedValue({
    // A provider of clinic c-1 (the phase routes are clinic-scoped, provider-only for changes).
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'u1', app_metadata: { app_role: 'provider', clinic_id: 'c-1' } } } } }),
      getUser: async () => ({ data: { user: { id: 'u1', app_metadata: { app_role: 'provider', clinic_id: 'c-1' } } }, error: null }),
    },
  }),
}))
// The signed-in provider's own row (C-2026-10-25-07: advanced_by is the caller,
// and the body's provider_id must be theirs).
jest.mock('@/lib/auth/current-provider', () => ({
  ...jest.requireActual('@/lib/auth/current-provider'),
  resolveCurrentProvider: async () => ({ provider_id: 'c1000000-0000-4000-8000-000000000001', clinic_id: 'c', first_name: 'P', last_name: 'One', npi_number: '1', signature_hash: null }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))

jest.spyOn(console, 'error').mockImplementation(() => {})

async function advance(more: Script) {
  db = scriptedDb(c => more(c)
    ?? (c.table === 'patient_protocol_phases' && c.op === 'select' ? { data: { current_phase: 'loading', patient_id: PT_1 } }
      : c.table === 'patients' ? { data: { patient_id: PT_1 } }
      : undefined))
  const res = await POST({ json: async () => ({ action: 'advance', tracking_id: T_1, new_phase: 'maintenance', provider_id: PR_1 }) } as unknown as NextRequest)
  return { status: res.status, body: await res.json() as Record<string, unknown> }
}

it('a failed read of the current phase answers 500, not 404', async () => {
  const r = await advance(c => (c.table === 'patient_protocol_phases' && c.op === 'select' ? DB_DOWN : undefined))
  expect(r.status).toBe(500)
  expect(String(r.body['error'])).not.toMatch(/connection reset/)
  expect(db.to('patient_protocol_phases', 'update')).toHaveLength(0)
})

it('a failed history write puts the phase back and answers 500, never ok: true', async () => {
  const r = await advance(c => (c.table === 'phase_advancement_history' ? DB_DOWN : undefined))
  expect(r.status).toBe(500)
  expect(r.body['ok']).toBeUndefined()
  expect(String(r.body['error'])).toMatch(/Nothing was changed/)
  const updates = db.to('patient_protocol_phases', 'update')
  expect(updates).toHaveLength(2)
  expect(updates[1]!.payload).toEqual(expect.objectContaining({ current_phase: 'loading' }))
})

it('a failed history write whose put-back also fails says the phase moved without a record', async () => {
  let updates = 0
  const r = await advance(c => {
    if (c.table === 'phase_advancement_history') return DB_DOWN
    if (c.table === 'patient_protocol_phases' && c.op === 'update' && ++updates === 2) return DB_DOWN
    return undefined
  })
  expect(r.status).toBe(500)
  expect(String(r.body['error'])).toMatch(/advanced to maintenance, but its history could not be recorded/)
})

// Compliance C2: a patient's protocol phase change is logged once, and
// (L1) BEFORE the write: refused 503 when the row cannot be written; a
// write that then fails gets a not_completed_patient_phases row.
describe('PHI access log', () => {
  const notCompleted = jest.mocked(logPhiWriteNotCompleted)
  beforeEach(() => { phiLog.mockClear(); notCompleted.mockClear() })
  const REFUSED = 'This change could not be recorded. Nothing was changed. Try again.'

  async function start(more: Script) {
    db = scriptedDb(c => more(c)
      ?? (c.table === 'patients' ? { data: { patient_id: PT_1 } }
        : c.table === 'protocol_templates' ? { data: { protocol_id: PR_1 } }
        : c.table === 'patient_protocol_phases' && c.op === 'upsert' ? { data: { tracking_id: T_1 } }
        : undefined))
    const res = await POST({ json: async () => ({ action: 'start', patient_id: PT_1, protocol_id: PR_1, initial_phase: 'loading' }) } as unknown as NextRequest)
    return { status: res.status, body: await res.json() as Record<string, unknown> }
  }
  async function status(more: Script) {
    db = scriptedDb(c => more(c)
      ?? (c.table === 'patient_protocol_phases' && c.op === 'select' ? { data: { current_phase: 'loading', patient_id: PT_1 } }
        : c.table === 'patients' ? { data: { patient_id: PT_1 } }
        : undefined))
    const res = await PATCH({ url: `https://app.test/api/patient-phases?tracking_id=${T_1}`, json: async () => ({ status: 'paused' }) } as unknown as NextRequest)
    return { status: res.status, body: await res.json() as Record<string, unknown> }
  }
  const none: Script = () => undefined

  it.each([
    ['start', () => start(none), 'upsert', 'create'],
    ['advance', () => advance(none), 'update', 'update'],
    ['status', () => status(none), 'update', 'update'],
  ] as const)('%s: the row is written BEFORE the write', async (_l, run, op, action) => {
    let writesAtLog = -1
    phiLog.mockImplementationOnce(async () => { writesAtLog = db.to('patient_protocol_phases', op).length; return true })
    const r = await run()
    expect(r.status).toBeLessThan(300)
    expect(writesAtLog).toBe(0)
    expectOnePhiRow({ action, resource: 'patient_phases', route: '/api/patient-phases', patientId: PT_1 })
    expect(notCompleted).not.toHaveBeenCalled()
  })

  it.each([
    ['start', () => start(none)],
    ['advance', () => advance(none)],
    ['status', () => status(none)],
  ] as const)('%s: the row cannot be written: 503, nothing written', async (_l, run) => {
    phiLog.mockResolvedValueOnce(false)
    const r = await run()
    expect(r.status).toBe(503)
    expect(r.body['error']).toBe(REFUSED)
    expect(db.calls.filter(c => c.op !== 'select')).toHaveLength(0)
  })

  it.each([
    ['start: the upsert fails', () => start(c => (c.table === 'patient_protocol_phases' && c.op === 'upsert' ? DB_DOWN : undefined))],
    ['advance: the update fails', () => advance(c => (c.table === 'patient_protocol_phases' && c.op === 'update' ? DB_DOWN : undefined))],
    ['advance: the history fails and the phase is put back', () => advance(c => (c.table === 'phase_advancement_history' ? DB_DOWN : undefined))],
    ['status: the update fails', () => status(c => (c.table === 'patient_protocol_phases' && c.op === 'update' ? DB_DOWN : undefined))],
  ] as const)('%s after logging: a not_completed row for the same entry', async (_l, run) => {
    expect((await run()).status).toBe(500)
    expect(notCompleted).toHaveBeenCalledTimes(1)
    expect(notCompleted).toHaveBeenCalledWith(phiEntries()[0])
  })

  it('advance: the history fails and the put-back fails too: the change stands, so no not_completed row', async () => {
    let updates = 0
    await advance(c => {
      if (c.table === 'phase_advancement_history') return DB_DOWN
      if (c.table === 'patient_protocol_phases' && c.op === 'update' && ++updates === 2) return DB_DOWN
      return undefined
    })
    expect(phiEntries()).toHaveLength(1)
    expect(notCompleted).not.toHaveBeenCalled()
  })

  it('an advance logs exactly one row: update, patient_phases, the patient', async () => {
    const r = await advance(c => (c.table === 'patient_protocol_phases' && c.op === 'select' ? { data: { current_phase: 'loading', patient_id: PT_1 } } : undefined))
    expect(r.status).toBe(200)
    expectOnePhiRow({ action: 'update', resource: 'patient_phases', route: '/api/patient-phases', patientId: PT_1 })
  })

  it('a refused advance (the current phase unreadable) logs nothing', async () => {
    await advance(c => (c.table === 'patient_protocol_phases' && c.op === 'select' ? DB_DOWN : undefined))
    expect(phiEntries()).toHaveLength(0)
  })
})
