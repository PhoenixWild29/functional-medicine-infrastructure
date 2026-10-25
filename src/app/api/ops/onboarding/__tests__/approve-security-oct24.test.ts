/**
 * @jest-environment node
 *
 * Security review, Oct 24: the ops approval write.
 *
 *   - Demo payouts on approval: on unless DEMO_PAYOUTS_ON_APPROVAL is
 *     "false". (H1, never with a live Stripe key, is split out to the
 *     demo-payouts-live-key-guard branch until Sam decides.)
 *   - Every approval and send-back counts the rows it changed. If the
 *     clinic left "submitted" between the read and the write (a second
 *     reviewer won), it answers 409 and records no event; before, only the
 *     demo path checked, so an "approved" event could be written for an
 *     approval that never happened.
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

describe('demo payouts on approval', () => {
  it('on unless the flag is "false"', () => {
    expect(demoPayoutsOnApproval()).toBe(true)
    process.env['STRIPE_SECRET_KEY'] = 'sk_test_abc'
    expect(demoPayoutsOnApproval()).toBe(true)
    process.env['DEMO_PAYOUTS_ON_APPROVAL'] = 'false'
    expect(demoPayoutsOnApproval()).toBe(false)
  })
})

describe('the write changed nothing (the clinic left "submitted" first)', () => {
  it.each(['approve', 'send_back'])('%s with demo payouts off: 409 and no event', async action => {
    process.env['DEMO_PAYOUTS_ON_APPROVAL'] = 'false'
    script = clinic([])
    const res = await POST(req({ action, note: 'Fix the address.' }), ctx)
    expect(res.status).toBe(409)
    expect(db.to('clinic_onboarding_events', 'insert')).toHaveLength(0)
  })

  it('one row changed: 200 and the event', async () => {
    process.env['DEMO_PAYOUTS_ON_APPROVAL'] = 'false'
    script = clinic([{ clinic_id: CLINIC }])
    const res = await POST(req({ action: 'approve' }), ctx)
    expect(res.status).toBe(200)
    expect(db.to('clinic_onboarding_events', 'insert')).toHaveLength(1)
  })
})
