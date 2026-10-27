/**
 * @jest-environment node
 *
 * /api/patient-phases input: ids are checked as ids, text is bounded, the
 * status is a closed set and a body that is not JSON is a 400, all before
 * any read or write (a bad id reaching Postgres was a 500, error 22P02).
 * Auth (provider, own clinic) still comes first: see clinic-scope.test.ts.
 */

import { NextRequest } from 'next/server'
import { scriptedDb, type ScriptedCall } from '@/__tests__/helpers/scripted-db'

const CLINIC_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PATIENT_A = 'a3000000-0000-4000-8000-00000000000a'
const PROTOCOL_A = 'c1000000-0000-4000-8000-00000000000a'
const TRACKING_A = 'e1000000-0000-4000-8000-00000000000a'
const PROVIDER_A = 'd1000000-0000-4000-8000-00000000000a'

let user: Record<string, unknown> | null = null
let db = scriptedDb(() => undefined)

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user }, error: user ? null : { message: 'no user' } }) },
  }),
}))
// The signed-in provider's own row (C-2026-10-25-07: advanced_by is the caller,
// and the body's provider_id must be theirs).
jest.mock('@/lib/auth/current-provider', () => ({
  ...jest.requireActual('@/lib/auth/current-provider'),
  resolveCurrentProvider: async () => ({ provider_id: 'd1000000-0000-4000-8000-00000000000a', clinic_id: 'c', first_name: 'P', last_name: 'One', npi_number: '1', signature_hash: null }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
// L1: the write is refused unless its log row is written, so the stub says it was.
jest.mock('@/lib/audit/phi-access', () => ({ logPhiAccess: jest.fn(async () => true), logPhiWriteNotCompleted: jest.fn(async () => true) }))

import { GET, POST, PATCH } from '../route'

function clinicA(c: ScriptedCall) {
  if (c.table === 'patients') return { data: { patient_id: PATIENT_A } }
  if (c.table === 'protocol_templates') return { data: { protocol_id: PROTOCOL_A } }
  if (c.table === 'patient_protocol_phases' && c.op === 'select') {
    return c.single ? { data: { tracking_id: TRACKING_A, patient_id: PATIENT_A, current_phase: 'loading' } } : { data: [] }
  }
  if (c.table === 'patient_protocol_phases' && c.op === 'upsert') return { data: { tracking_id: TRACKING_A } }
  return undefined
}

const as = (role: string) => ({ id: `u-${role}`, app_metadata: { app_role: role, clinic_id: CLINIC_A } })
const get = (qs: string) => GET(new NextRequest(`https://app.test/api/patient-phases?${qs}`))
const post = (body: unknown) => POST(new NextRequest('https://app.test/api/patient-phases', {
  method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body),
}))
const patch = (qs: string, body: unknown) => PATCH(new NextRequest(`https://app.test/api/patient-phases?${qs}`, {
  method: 'PATCH', body: typeof body === 'string' ? body : JSON.stringify(body),
}))
const start = (over: Record<string, unknown> = {}) =>
  post({ action: 'start', patient_id: PATIENT_A, protocol_id: PROTOCOL_A, initial_phase: 'loading', provider_id: PROVIDER_A, ...over })
const advance = (over: Record<string, unknown> = {}) =>
  post({ action: 'advance', tracking_id: TRACKING_A, new_phase: 'maintenance', provider_id: PROVIDER_A, ...over })

beforeEach(() => {
  db = scriptedDb(clinicA)
  user = as('provider')
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

async function expect400(res: Response) {
  expect(res.status).toBe(400)
  expect(db.calls).toHaveLength(0)
  const body = await res.json() as { error: string }
  expect(typeof body.error).toBe('string')
}

describe('a bad id is a 400, and nothing is read', () => {
  it('GET with a patient_id that is not an id', async () => {
    await expect400(await get('patient_id=not-a-uuid'))
  })
  it('start with a bad patient, protocol or provider id', async () => {
    await expect400(await start({ patient_id: 'pt-1' }))
    await expect400(await start({ protocol_id: "1' or 1=1" }))
    await expect400(await start({ provider_id: 'pr-1' }))
  })
  it('advance with a bad tracking or provider id', async () => {
    await expect400(await advance({ tracking_id: 't-1' }))
    await expect400(await advance({ provider_id: 42 }))
  })
  it('PATCH with a tracking_id that is not an id', async () => {
    await expect400(await patch('tracking_id=t-1', { status: 'paused' }))
  })
})

describe('text is bounded and types are checked', () => {
  it('an oversize phase name or reason is a 400', async () => {
    await expect400(await start({ initial_phase: 'x'.repeat(201) }))
    await expect400(await advance({ new_phase: 'x'.repeat(201) }))
    await expect400(await advance({ reason: 'x'.repeat(2001) }))
  })
  it('a phase that is not a string is a 400', async () => {
    await expect400(await advance({ new_phase: { $gt: '' } }))
  })
})

describe('a body that is not JSON is a 400, not a thrown 500', () => {
  it('POST', async () => { await expect400(await post('{not json')) })
  it('PATCH', async () => { await expect400(await patch(`tracking_id=${TRACKING_A}`, '{not json')) })
})

describe('closed sets', () => {
  it('an unknown status is a 400 with the existing message', async () => {
    const res = await patch(`tracking_id=${TRACKING_A}`, { status: 'deleted' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid status' })
    expect(db.calls).toHaveLength(0)
  })
  it('an unknown action keeps "Invalid action"', async () => {
    const res = await post({ action: 'merge' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid action' })
  })
})

describe('auth is still first', () => {
  it('a medical assistant is 403 on a write even with a bad body', async () => {
    user = as('medical_assistant')
    expect((await post('{not json')).status).toBe(403)
    expect(db.calls).toHaveLength(0)
  })
})

describe('good input still works', () => {
  it('start, advance and status change', async () => {
    expect((await start()).status).toBe(201)
    expect((await advance({ reason: 'labs in range', lab_results: { e2: 40 } })).status).toBe(200)
    expect((await patch(`tracking_id=${TRACKING_A}`, { status: 'paused' })).status).toBe(200)
    expect((await get(`patient_id=${PATIENT_A}`)).status).toBe(200)
  })
})
