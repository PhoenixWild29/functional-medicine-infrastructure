/**
 * @jest-environment node
 *
 * Sign-up squatting (security review M3), at ops approval. A pending
 * sign-up's providers hold no NPI (npi_claimed false); approving claims
 * them. When an approved clinic's live provider already holds one of the
 * NPIs, Approve is refused (409 NPI_REGISTERED_ELSEWHERE, ops-only words)
 * and nothing changes. A claim the database refuses (unique index, a race)
 * is the same refusal. If the approval itself then fails, the claim is
 * undone.
 */

import { NextRequest } from 'next/server'
import { scriptedDb, type ScriptedCall, type ScriptedAnswer } from '@/__tests__/helpers/scripted-db'

const CLINIC = '11111111-1111-4111-8111-111111111111'
const NPI = '1234567893'
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

function world(opts: { elsewhere?: Array<Record<string, unknown>>; claim?: ScriptedAnswer; approve?: ScriptedAnswer } = {}) {
  return (c: ScriptedCall): ScriptedAnswer | undefined => {
    if (c.table === 'clinics' && c.op === 'select') return { data: { clinic_id: CLINIC, name: 'Ruiz Family Medicine', onboarding_status: 'submitted', signup_source: 'self_serve', stripe_connect_account_id: 'acct_1RealAccount' } }
    if (c.table === 'clinics' && c.op === 'update') return opts.approve
    if (c.table === 'providers' && c.op === 'update') return c.payload && (c.payload as { npi_claimed?: boolean }).npi_claimed ? opts.claim : undefined
    if (c.table === 'providers' && 'npi_number:in' in c.filters) {
      return { data: [{ provider_id: 'p1', clinic_id: CLINIC, npi_number: NPI, npi_claimed: false }, ...(opts.elsewhere ?? [])] }
    }
    if (c.table === 'providers') return { data: [{ provider_id: 'p1', clinic_id: CLINIC, first_name: 'Dana', last_name: 'Ruiz', user_id: null, npi_number: NPI }] }
    if (c.table === 'provider_npi_verifications') return { data: [{ provider_id: 'p1', status: 'verified' }] }
    if (c.table === 'onboarding_invites') return { data: [] }
    return undefined
  }
}

const claims = () => db.to('providers', 'update').map(c => c.payload)

beforeEach(() => { db = scriptedDb(c => script(c)) })

it('an approved clinic holds the NPI: 409 with ops-only words, nothing claimed or approved', async () => {
  script = world({ elsewhere: [{ provider_id: 'other', clinic_id: 'c-approved', npi_number: NPI, npi_claimed: true }] })
  const res = await POST(req({ action: 'approve' }), ctx)
  expect(res.status).toBe(409)
  const body = await res.json()
  expect(body.code).toBe('NPI_REGISTERED_ELSEWHERE')
  expect(body.error).toContain('Dana Ruiz’s NPI is already registered to a provider at an approved clinic')
  expect(claims()).toEqual([])
  expect(db.to('clinics', 'update')).toHaveLength(0)
  expect(db.to('clinic_onboarding_events', 'insert')).toHaveLength(0)
})

it('only other pending sign-ups name it: approved, and the providers are claimed first', async () => {
  script = world({ elsewhere: [{ provider_id: 'pending', clinic_id: 'c-pending', npi_number: NPI, npi_claimed: false }] })
  const res = await POST(req({ action: 'approve' }), ctx)
  expect(res.status).toBe(200)
  expect(claims()).toEqual([{ npi_claimed: true }])
  expect(db.to('providers', 'update')[0]!.filters).toEqual(expect.objectContaining({ clinic_id: CLINIC }))
  expect(db.to('clinics', 'update')[0]!.payload).toMatchObject({ onboarding_status: 'approved', is_active: true })
})

it('the database refuses the claim (unique index, a race): the same 409, nothing approved', async () => {
  script = world({ claim: { error: { message: 'duplicate key value violates unique constraint "providers_npi_number_unique"', code: '23505' } } })
  const res = await POST(req({ action: 'approve' }), ctx)
  expect(res.status).toBe(409)
  expect((await res.json()).code).toBe('NPI_REGISTERED_ELSEWHERE')
  expect(db.to('clinics', 'update')).toHaveLength(0)
})

it('the approval write fails after the claim: the claim is undone', async () => {
  script = world({ approve: { error: { message: 'connection reset' } } })
  const res = await POST(req({ action: 'approve' }), ctx)
  expect(res.status).toBe(500)
  expect(claims()).toEqual([{ npi_claimed: true }, { npi_claimed: false }])
})

it('send back claims nothing', async () => {
  script = world({ elsewhere: [{ provider_id: 'other', clinic_id: 'c-approved', npi_number: NPI, npi_claimed: true }] })
  const res = await POST(req({ action: 'send_back', note: 'Fix the license' }), ctx)
  expect(res.status).toBe(200)
  expect(claims()).toEqual([])
})
