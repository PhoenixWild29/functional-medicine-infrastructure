/**
 * @jest-environment node
 *
 * A failed database call in /api/patient-phases answers with a generic
 * message, never the database's own text. Database errors can quote the
 * row they failed on (a patient id, a value), and they tell the caller
 * nothing they can act on. The detail goes to the server log.
 */

import type { NextRequest } from 'next/server'
import { scriptedDb, type ScriptedCall } from '@/__tests__/helpers/scripted-db'
import { GET, POST, PATCH } from '../route'

const DB_TEXT = 'duplicate key value violates unique constraint "ppp_patient_protocol" Key (patient_id)=(pt-1)'
const FAILED = { data: null, error: { message: DB_TEXT } }

let db = scriptedDb(() => undefined)

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockResolvedValue({
    auth: {
      getUser: async () => ({ data: { user: { id: 'u1', app_metadata: { app_role: 'provider', clinic_id: 'c-1' } } }, error: null }),
    },
  }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.mock('@/lib/audit/phi-access', () => ({ logPhiAccess: jest.fn(async () => {}) }))

const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
afterAll(() => errorSpy.mockRestore())

/** Scope reads answer; the one call under test fails. */
function failing(target: (c: ScriptedCall) => boolean) {
  db = scriptedDb(c => {
    if (target(c)) return FAILED
    if (c.table === 'patients') return { data: { patient_id: 'pt-1' } }
    if (c.table === 'protocol_templates') return { data: { protocol_id: 'pr-1' } }
    if (c.table === 'patient_protocol_phases' && c.op === 'select' && c.single) return { data: { current_phase: 'loading', patient_id: 'pt-1' } }
    return undefined
  })
}

async function expectGeneric(res: Response) {
  expect(res.status).toBe(500)
  const body = await res.json() as { error?: string }
  expect(body.error).toBeTruthy()
  expect(body.error).not.toContain('duplicate key')
  expect(body.error).not.toContain('pt-1')
}

const req = (url: string, body?: unknown) => ({ url, json: async () => body, headers: new Headers() }) as unknown as NextRequest

it('GET: a failed phases read', async () => {
  failing(c => c.table === 'patient_protocol_phases' && c.op === 'select' && !c.single)
  await expectGeneric(await GET(req('https://app.test/api/patient-phases?patient_id=pt-1')))
})

it('POST start: a failed upsert', async () => {
  failing(c => c.table === 'patient_protocol_phases' && c.op === 'upsert')
  await expectGeneric(await POST(req('https://app.test/api/patient-phases', { action: 'start', patient_id: 'pt-1', protocol_id: 'pr-1', initial_phase: 'loading' })))
})

it('POST advance: a failed phase update', async () => {
  failing(c => c.table === 'patient_protocol_phases' && c.op === 'update')
  await expectGeneric(await POST(req('https://app.test/api/patient-phases', { action: 'advance', tracking_id: 't-1', new_phase: 'maintenance', provider_id: 'pr-1' })))
})

it('PATCH: a failed status update', async () => {
  failing(c => c.table === 'patient_protocol_phases' && c.op === 'update')
  await expectGeneric(await PATCH(req('https://app.test/api/patient-phases?tracking_id=t-1', { status: 'paused' })))
})
