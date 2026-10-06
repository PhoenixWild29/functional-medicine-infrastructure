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
import { POST } from '../route'
import { phiLog, phiEntries, expectOnePhiRow } from '@/__tests__/helpers/phi-log'

let db = scriptedDb(() => undefined)

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockResolvedValue({
    // A provider of clinic c-1 (the phase routes are clinic-scoped, provider-only for changes).
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'u1', user_metadata: { app_role: 'provider', clinic_id: 'c-1' } } } } }),
      getUser: async () => ({ data: { user: { id: 'u1', user_metadata: { app_role: 'provider', clinic_id: 'c-1' } } }, error: null }),
    },
  }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))

jest.spyOn(console, 'error').mockImplementation(() => {})

async function advance(more: Script) {
  db = scriptedDb(c => more(c)
    ?? (c.table === 'patient_protocol_phases' && c.op === 'select' ? { data: { current_phase: 'loading', patient_id: 'pt-1' } }
      : c.table === 'patients' ? { data: { patient_id: 'pt-1' } }
      : undefined))
  const res = await POST({ json: async () => ({ action: 'advance', tracking_id: 't-1', new_phase: 'maintenance', provider_id: 'pr-1' }) } as unknown as NextRequest)
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

// Compliance C2: a patient's protocol phase change is logged once.
describe('PHI access log', () => {
  beforeEach(() => phiLog.mockClear())

  it('an advance logs exactly one row: update, patient_phases, the patient', async () => {
    const r = await advance(c => (c.table === 'patient_protocol_phases' && c.op === 'select' ? { data: { current_phase: 'loading', patient_id: 'pt-1' } } : undefined))
    expect(r.status).toBe(200)
    expectOnePhiRow({ action: 'update', resource: 'patient_phases', route: '/api/patient-phases', patientId: 'pt-1' })
  })

  it('a failed advance logs nothing', async () => {
    await advance(c => (c.table === 'phase_advancement_history' ? DB_DOWN : undefined))
    expect(phiEntries()).toHaveLength(0)
  })
})
