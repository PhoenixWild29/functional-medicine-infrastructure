/**
 * @jest-environment node
 *
 * H1 (security review, Oct 24; split out of security-review-oct24 until Sam
 * decides): demo payouts never apply with a live Stripe key. A placeholder
 * Connect account makes checkout charge the patient with no Connect
 * routing, so with sk_live_ / rk_live_ keys the money would stay on the
 * platform. With a live key the approval is made as if
 * DEMO_PAYOUTS_ON_APPROVAL were "false". Test keys: unchanged.
 */

import { NextRequest } from 'next/server'
import { scriptedDb, type ScriptedCall, type ScriptedAnswer } from '@/__tests__/helpers/scripted-db'
import { demoPayoutsOnApproval } from '@/lib/clinics/demo-payouts'

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

function clinic(updated: Array<{ clinic_id: string }>) {
  return (c: ScriptedCall): ScriptedAnswer | undefined => {
    if (c.table === 'clinics' && c.op === 'select') return { data: { clinic_id: CLINIC, name: 'Solo Practice', onboarding_status: 'submitted', stripe_connect_account_id: null } }
    if (c.table === 'clinics' && c.op === 'update') return { data: updated }
    if (c.table === 'providers') return { data: [{ provider_id: 'p1', clinic_id: CLINIC, first_name: 'Sol', last_name: 'Owner', user_id: 'u1' }] }
    if (c.table === 'provider_npi_verifications') return { data: [{ provider_id: 'p1', status: 'verified' }] }
    return { data: [] }
  }
}

const saved = { ...process.env }
beforeEach(() => {
  delete process.env['DEMO_PAYOUTS_ON_APPROVAL']
  delete process.env['STRIPE_SECRET_KEY']
  db = scriptedDb(c => script(c))
})
afterAll(() => { process.env = saved })

describe('demo payouts and the Stripe key', () => {
  it('a test key or none: on unless the flag is "false"', () => {
    expect(demoPayoutsOnApproval()).toBe(true)
    process.env['STRIPE_SECRET_KEY'] = 'sk_test_abc'
    expect(demoPayoutsOnApproval()).toBe(true)
    process.env['DEMO_PAYOUTS_ON_APPROVAL'] = 'false'
    expect(demoPayoutsOnApproval()).toBe(false)
  })

  it('a live key: always off, whatever the flag says', () => {
    process.env['STRIPE_SECRET_KEY'] = 'sk_live_abc'
    expect(demoPayoutsOnApproval()).toBe(false)
    process.env['DEMO_PAYOUTS_ON_APPROVAL'] = 'true'
    expect(demoPayoutsOnApproval()).toBe(false)
    process.env['STRIPE_SECRET_KEY'] = 'rk_live_abc'
    expect(demoPayoutsOnApproval()).toBe(false)
  })

  it('a live key: the approval sets no placeholder account', async () => {
    process.env['STRIPE_SECRET_KEY'] = 'sk_live_abc'
    script = clinic([{ clinic_id: CLINIC }])
    const res = await POST(req({ action: 'approve' }), ctx)
    expect(res.status).toBe(200)
    const payload = db.to('clinics', 'update')[0]?.payload as Record<string, unknown>
    expect(payload).toMatchObject({ is_active: true, onboarding_status: 'approved' })
    expect(payload).not.toHaveProperty('stripe_connect_account_id')
    expect(payload).not.toHaveProperty('stripe_connect_status')
  })
})
