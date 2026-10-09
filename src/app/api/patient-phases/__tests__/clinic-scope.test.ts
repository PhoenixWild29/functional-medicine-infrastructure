/**
 * @jest-environment node
 *
 * /api/patient-phases was open across clinics: any signed-in user, of any
 * clinic or none, could read or change any patient's protocol phases by id
 * (found while wiring Compliance C2). Now:
 *
 *   - getUser(), never getSession(): a token that does not verify is 401;
 *   - a clinic user only: ops (no clinic) and unknown roles are 403;
 *   - every read and write is scoped to the caller's clinic: a patient,
 *     protocol or tracking row of another clinic is 404, and nothing is
 *     written;
 *   - reading: provider, medical assistant, clinic admin; changing a phase
 *     (start, advance, status): the provider only, a clinical decision.
 */

import { NextRequest } from 'next/server'
import { scriptedDb, type ScriptedCall } from '@/__tests__/helpers/scripted-db'
import { userFromSession, withForgedSession } from '@/__tests__/helpers/auth-from-session'

const CLINIC_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CLINIC_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const PATIENT_A = 'a3000000-0000-4000-8000-00000000000a'
const PROTOCOL_A = 'c1000000-0000-4000-8000-00000000000a'
const TRACKING_A = 't1000000-0000-4000-8000-00000000000a'

let user: Record<string, unknown> | null = null
let db = scriptedDb(() => undefined)

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({
    auth: {
      getSession: async () => ({ data: { session: user ? { user } : null } }),
      getUser: async () => userFromSession({ data: { session: user ? { user } : null } }),
    },
  }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))

import { GET, POST, PATCH } from '../route'

/** Clinic A's rows, answered only to a query scoped to clinic A. */
function clinicA(c: ScriptedCall) {
  if (c.table === 'patients') {
    return c.filters['patient_id'] === PATIENT_A && c.filters['clinic_id'] === CLINIC_A
      ? { data: { patient_id: PATIENT_A } } : { data: null }
  }
  if (c.table === 'protocol_templates') {
    return c.filters['protocol_id'] === PROTOCOL_A && c.filters['clinic_id'] === CLINIC_A
      ? { data: { protocol_id: PROTOCOL_A } } : { data: null }
  }
  if (c.table === 'patient_protocol_phases' && c.op === 'select') {
    return c.filters['tracking_id'] === TRACKING_A
      ? { data: { tracking_id: TRACKING_A, patient_id: PATIENT_A, current_phase: 'loading' } }
      : { data: [{ tracking_id: TRACKING_A, current_phase: 'loading' }] }
  }
  if (c.table === 'patient_protocol_phases' && c.op === 'update') return { data: [{ patient_id: PATIENT_A }] }
  if (c.table === 'patient_protocol_phases' && c.op === 'upsert') return { data: { tracking_id: TRACKING_A } }
  return undefined
}

const as = (role: string, clinic: string | null) => ({ id: `u-${role}`, email: `${role}@x.example`, app_metadata: { app_role: role, clinic_id: clinic } })

const get = () => GET(new NextRequest(`https://app.test/api/patient-phases?patient_id=${PATIENT_A}`))
const post = (body: Record<string, unknown>) => POST(new NextRequest('https://app.test/api/patient-phases', { method: 'POST', body: JSON.stringify(body) }))
const start = () => post({ action: 'start', patient_id: PATIENT_A, protocol_id: PROTOCOL_A, initial_phase: 'loading', provider_id: 'pr-1' })
const advance = () => post({ action: 'advance', tracking_id: TRACKING_A, new_phase: 'maintenance', provider_id: 'pr-1' })
const patch = () => PATCH(new NextRequest(`https://app.test/api/patient-phases?tracking_id=${TRACKING_A}`, { method: 'PATCH', body: JSON.stringify({ status: 'paused' }) }))

const writes = () => db.calls.filter(c => c.op !== 'select')

beforeEach(() => {
  db = scriptedDb(clinicA)
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe('a user from clinic B cannot read or change clinic A\'s patient phases', () => {
  beforeEach(() => { user = as('provider', CLINIC_B) })

  it('GET is 404 and returns nothing of clinic A', async () => {
    const res = await get()
    expect(res.status).toBe(404)
    expect(db.to('patient_protocol_phases', 'select')).toHaveLength(0)
  })

  it('start, advance and status changes are 404, and nothing is written', async () => {
    expect((await start()).status).toBe(404)
    expect((await advance()).status).toBe(404)
    expect((await patch()).status).toBe(404)
    expect(writes()).toHaveLength(0)
  })
})

describe('clinic A', () => {
  it('its provider reads, starts, advances and changes status', async () => {
    user = as('provider', CLINIC_A)
    expect((await get()).status).toBe(200)
    expect((await start()).status).toBe(201)
    expect((await advance()).status).toBe(200)
    expect((await patch()).status).toBe(200)
  })

  it('a medical assistant or clinic admin may read but not change a phase (403, nothing written)', async () => {
    for (const role of ['medical_assistant', 'clinic_admin']) {
      user = as(role, CLINIC_A)
      expect((await get()).status).toBe(200)
      expect((await start()).status).toBe(403)
      expect((await advance()).status).toBe(403)
      expect((await patch()).status).toBe(403)
    }
    expect(writes()).toHaveLength(0)
  })

  it('a protocol of another clinic cannot be started for clinic A\'s patient', async () => {
    user = as('provider', CLINIC_A)
    const res = await post({ action: 'start', patient_id: PATIENT_A, protocol_id: 'c1000000-0000-4000-8000-00000000000b', initial_phase: 'loading' })
    expect(res.status).toBe(404)
    expect(writes()).toHaveLength(0)
  })
})

describe('who may call it at all', () => {
  it('no user: 401; ops (no clinic) and unknown roles: 403', async () => {
    user = null
    expect((await get()).status).toBe(401)
    user = as('ops_admin', null)
    expect((await get()).status).toBe(403)
    user = as('patient', CLINIC_A)
    expect((await get()).status).toBe(403)
    expect(db.calls).toHaveLength(0)
  })

  it('a session whose token does not verify is 401', async () => {
    user = as('provider', CLINIC_A)
    expect((await withForgedSession(() => get())).status).toBe(401)
    expect((await withForgedSession(() => advance())).status).toBe(401)
    expect(writes()).toHaveLength(0)
  })
})
