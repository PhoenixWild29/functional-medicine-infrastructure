/**
 * @jest-environment node
 *
 * POST /api/ops/onboarding/clinics/[clinicId] { action: 'approve' } when a
 * provider's NPI is not verified in the national registry:
 *   - refused (422) unless ops confirms they checked the license with the
 *     state board (licenseChecked: true); nothing is changed;
 *   - with the confirmation: approved, and the approval event's note
 *     records it, naming the providers;
 *   - a clinic whose providers are all verified approves exactly as before
 *     (no confirmation needed, no note).
 */

import { NextRequest } from 'next/server'
import { scriptedDb, DB_DOWN, type ScriptedCall, type ScriptedAnswer } from '@/__tests__/helpers/scripted-db'

const CLINIC = '11111111-1111-4111-8111-111111111111'
const OPS_USER = { id: 'ops-1', email: 'ops@compoundiq.test', app_metadata: { app_role: 'ops_admin' } }

let script: (c: ScriptedCall) => ScriptedAnswer | undefined = () => undefined
let db = scriptedDb(c => script(c))
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: OPS_USER }, error: null }) } }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => Object.assign(db.client as object, { auth: { admin: { getUserById: async () => ({ data: { user: null }, error: null }) } } }) }))
jest.spyOn(console, 'error').mockImplementation(() => {})
jest.spyOn(console, 'info').mockImplementation(() => {})

import { POST } from '../clinics/[clinicId]/route'

const req = (body: unknown) => new NextRequest(`http://localhost/api/ops/onboarding/clinics/${CLINIC}`, { method: 'POST', body: JSON.stringify(body) })
const ctx = { params: Promise.resolve({ clinicId: CLINIC }) }

function clinicWith(npi: Array<{ provider_id: string; status: string }>) {
  return (c: ScriptedCall): ScriptedAnswer | undefined => {
    if (c.table === 'clinics' && c.op === 'select') return { data: { clinic_id: CLINIC, name: 'Blue Cedar', onboarding_status: 'submitted', signup_source: 'invite' } }
    if (c.table === 'providers') return { data: [
      { provider_id: 'p1', clinic_id: CLINIC, first_name: 'Ana', last_name: 'Ortiz', user_id: null },
      { provider_id: 'p2', clinic_id: CLINIC, first_name: 'Ben', last_name: 'Cole', user_id: null },
    ] }
    if (c.table === 'provider_npi_verifications') return { data: npi }
    if (c.table === 'onboarding_invites') return { data: [] }
    return undefined
  }
}
const UNVERIFIED = [{ provider_id: 'p1', status: 'verified' }, { provider_id: 'p2', status: 'not_found' }]
const ALL_VERIFIED = [{ provider_id: 'p1', status: 'verified' }, { provider_id: 'p2', status: 'verified' }]

beforeEach(() => { db = scriptedDb(c => script(c)) })

it('a provider not verified, no confirmation: 422, nothing changed', async () => {
  script = clinicWith(UNVERIFIED)
  const res = await POST(req({ action: 'approve' }), ctx)
  expect(res.status).toBe(422)
  const body = await res.json()
  expect(body.code).toBe('LICENSE_CHECK_REQUIRED')
  expect(body.unverified).toEqual(['Ben Cole'])
  expect(db.to('clinics', 'update')).toHaveLength(0)
  expect(db.to('clinic_onboarding_events', 'insert')).toHaveLength(0)
})

it.each([{ licenseChecked: false }, { licenseChecked: 'yes' }])('a confirmation that is not exactly true (%j): 422', async extra => {
  script = clinicWith(UNVERIFIED)
  expect((await POST(req({ action: 'approve', ...extra }), ctx)).status).toBe(422)
})

it('a provider with no registry check at all counts as not verified', async () => {
  script = clinicWith([{ provider_id: 'p1', status: 'verified' }])
  expect((await POST(req({ action: 'approve' }), ctx)).status).toBe(422)
})

it('with the confirmation: approved, and the event note records it', async () => {
  script = clinicWith(UNVERIFIED)
  const res = await POST(req({ action: 'approve', licenseChecked: true }), ctx)
  expect(res.status).toBe(200)
  expect(db.to('clinics', 'update')[0]?.payload).toMatchObject({ is_active: true, onboarding_status: 'approved' })
  const event = db.to('clinic_onboarding_events', 'insert')[0]?.payload as { event: string; note: string }
  expect(event.event).toBe('approved')
  expect(event.note).toContain('I checked this provider’s license with the state board')
  expect(event.note).toContain('Ben Cole')
})

it('all providers verified: approves exactly as before, no note', async () => {
  script = clinicWith(ALL_VERIFIED)
  const res = await POST(req({ action: 'approve' }), ctx)
  expect(res.status).toBe(200)
  expect((db.to('clinic_onboarding_events', 'insert')[0]?.payload as { note: string | null }).note).toBeNull()
})

it('the providers cannot be read: 503, nothing changed', async () => {
  script = c => (c.table === 'providers' ? DB_DOWN : clinicWith(UNVERIFIED)(c))
  expect((await POST(req({ action: 'approve', licenseChecked: true }), ctx)).status).toBe(503)
  expect(db.to('clinics', 'update')).toHaveLength(0)
})

it('send back never asks for the confirmation', async () => {
  script = clinicWith(UNVERIFIED)
  expect((await POST(req({ action: 'send_back', note: 'Fix the NPI.' }), ctx)).status).toBe(200)
})
