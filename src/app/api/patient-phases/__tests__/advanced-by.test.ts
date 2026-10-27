/**
 * @jest-environment node
 *
 * Security follow-up (C-2026-10-25-07, item 1): who advanced a patient's
 * protocol phase is the signed-in provider, never an id from the body.
 *
 *   - advanced_by (the phase row and the advancement history) is the
 *     caller's own provider row (providers.user_id = the auth user, in the
 *     caller's clinic, active), resolved on the server.
 *   - A body provider_id that is not the caller's is refused (403), not
 *     ignored: a client naming someone else is a bug or a forgery, and the
 *     record of who changed a treatment phase must not be put down to
 *     another provider either way. Nothing is read or written for it.
 *   - Omitting provider_id is fine: the caller's own id is used.
 *   - A provider-role session with no linked provider row cannot act as a
 *     provider (fail closed, lib/auth/current-provider): 403.
 */

import { NextRequest } from 'next/server'
import { scriptedDb, type ScriptedCall } from '@/__tests__/helpers/scripted-db'

const CLINIC_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PATIENT_A = 'a3000000-0000-4000-8000-00000000000a'
const PROTOCOL_A = 'c1000000-0000-4000-8000-00000000000a'
const TRACKING_A = 'e1000000-0000-4000-8000-00000000000a'
const ME = 'd1000000-0000-4000-8000-00000000000a'
const SOMEONE_ELSE = 'd1000000-0000-4000-8000-00000000000b'
const USER_ID = 'u-provider'

let user: Record<string, unknown> | null = null
let linked = true
let db = scriptedDb(() => undefined)

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user }, error: user ? null : { message: 'no user' } }) },
  }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.mock('@/lib/audit/phi-access', () => ({ logPhiAccess: jest.fn(async () => {}) }))

import { POST } from '../route'

function clinicA(c: ScriptedCall) {
  if (c.table === 'providers') {
    return { data: linked ? { provider_id: ME, clinic_id: CLINIC_A, first_name: 'P', last_name: 'One', npi_number: '1234567893', signature_hash: null } : null }
  }
  if (c.table === 'patients') return { data: { patient_id: PATIENT_A } }
  if (c.table === 'protocol_templates') return { data: { protocol_id: PROTOCOL_A } }
  if (c.table === 'patient_protocol_phases' && c.op === 'select') {
    return c.single ? { data: { tracking_id: TRACKING_A, patient_id: PATIENT_A, current_phase: 'loading' } } : { data: [] }
  }
  if (c.table === 'patient_protocol_phases' && c.op === 'upsert') return { data: { tracking_id: TRACKING_A } }
  return { data: null }
}

const post = (body: unknown) => POST(new NextRequest('https://app.test/api/patient-phases', { method: 'POST', body: JSON.stringify(body) }))
const start = (over: Record<string, unknown> = {}) =>
  post({ action: 'start', patient_id: PATIENT_A, protocol_id: PROTOCOL_A, initial_phase: 'loading', ...over })
const advance = (over: Record<string, unknown> = {}) =>
  post({ action: 'advance', tracking_id: TRACKING_A, new_phase: 'maintenance', reason: 'labs ok', ...over })

const writes = () => db.calls.filter(c => c.op !== 'select')
const advancedBy = () => writes().map(c => (c.payload as Record<string, unknown> | undefined)?.['advanced_by'])

beforeEach(() => {
  linked = true
  db = scriptedDb(clinicA)
  user = { id: USER_ID, app_metadata: { app_role: 'provider', clinic_id: CLINIC_A } }
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe('advanced_by is the signed-in provider', () => {
  it('start with no provider_id records the caller', async () => {
    expect((await start()).status).toBe(201)
    expect(advancedBy()).toEqual([ME])
  })
  it('advance with no provider_id records the caller on the phase and the history', async () => {
    expect((await advance()).status).toBe(200)
    expect(advancedBy()).toEqual([ME, ME])
  })
  it('the caller\'s own provider_id is accepted', async () => {
    expect((await start({ provider_id: ME })).status).toBe(201)
    expect(advancedBy()).toEqual([ME])
  })
  it('the provider row is looked up by the auth user, in the caller\'s clinic', async () => {
    await start()
    const lookup = db.calls.find(c => c.table === 'providers')!
    expect(JSON.stringify(lookup.filters)).toContain(USER_ID)
    expect(JSON.stringify(lookup.filters)).toContain(CLINIC_A)
  })
})

describe('another provider\'s id is refused', () => {
  it.each([['start', start], ['advance', advance]] as const)('%s with someone else\'s provider_id: 403, nothing written', async (_n, call) => {
    const res = await call({ provider_id: SOMEONE_ELSE })
    expect(res.status).toBe(403)
    expect(writes()).toHaveLength(0)
    expect(db.calls.some(c => c.table === 'patients' || c.table === 'patient_protocol_phases')).toBe(false)
  })
})

describe('a provider session with no linked provider row', () => {
  it('cannot change a phase: 403, nothing written', async () => {
    linked = false
    const res = await advance()
    expect(res.status).toBe(403)
    expect(writes()).toHaveLength(0)
  })
})
