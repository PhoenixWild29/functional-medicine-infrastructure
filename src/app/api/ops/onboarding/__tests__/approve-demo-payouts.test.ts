/**
 * @jest-environment node
 *
 * Ordering opens on approval, on the demo payout path Sunrise uses: when
 * ops approves a clinic (invited or self sign-up) that has no Stripe
 * Connect account, the approval write also sets stripe_connect_account_id
 * 'poc_placeholder_<clinic_id>' (unique per clinic: the column is UNIQUE and
 * Sunrise holds 'poc_placeholder') and stripe_connect_status 'ACTIVE', and the approval
 * history note says "Demo payout account set on approval".
 *
 *   - Behind DEMO_PAYOUTS_ON_APPROVAL, on unless it is 'false'.
 *   - A real Connect account id is never overwritten (the write is
 *     conditional on there being none).
 *   - Flag off: approval exactly as today.
 */

import { NextRequest } from 'next/server'
import { scriptedDb, type ScriptedCall, type ScriptedAnswer } from '@/__tests__/helpers/scripted-db'

const CLINIC = '11111111-1111-4111-8111-111111111111'
const OPS_USER = { id: 'ops-1', email: 'ops@compoundiq.test', app_metadata: { app_role: 'ops_admin' } }
const NOTE = 'Demo payout account set on approval'

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

function clinic(account: string | null, npi = 'verified') {
  return (c: ScriptedCall): ScriptedAnswer | undefined => {
    if (c.table === 'clinics' && c.op === 'select') return { data: { clinic_id: CLINIC, name: 'Solo Practice', onboarding_status: 'submitted', stripe_connect_account_id: account } }
    if (c.table === 'clinics' && c.op === 'update') return { data: [{ clinic_id: CLINIC }] }
    if (c.table === 'providers') return { data: [{ provider_id: 'p1', clinic_id: CLINIC, first_name: 'Sol', last_name: 'Owner', user_id: 'u1' }] }
    if (c.table === 'provider_npi_verifications') return { data: [{ provider_id: 'p1', status: npi }] }
    return { data: [] }
  }
}
const update = () => db.to('clinics', 'update')[0]
const eventNote = () => (db.to('clinic_onboarding_events', 'insert')[0]?.payload as { note: string | null } | undefined)?.note

beforeEach(() => {
  delete process.env['DEMO_PAYOUTS_ON_APPROVAL']
  db = scriptedDb(c => script(c))
})
afterAll(() => { delete process.env['DEMO_PAYOUTS_ON_APPROVAL'] })

it('no Connect account: the approval write sets the placeholder and ACTIVE, only where none is set; the note says so', async () => {
  script = clinic(null)
  const res = await POST(req({ action: 'approve' }), ctx)
  expect(res.status).toBe(200)
  expect(db.to('clinics', 'update')).toHaveLength(1)
  expect(update()?.payload).toMatchObject({
    is_active: true, onboarding_status: 'approved',
    stripe_connect_account_id: `poc_placeholder_${CLINIC}`, stripe_connect_status: 'ACTIVE',
  })
  expect(update()?.filters).toMatchObject({ clinic_id: CLINIC, onboarding_status: 'submitted', 'stripe_connect_account_id.is.null,stripe_connect_account_id.eq.:or': undefined })
  expect(eventNote()).toContain(NOTE)
})

it('an empty-string account id counts as none', async () => {
  script = clinic('')
  await POST(req({ action: 'approve' }), ctx)
  expect(update()?.payload).toMatchObject({ stripe_connect_account_id: `poc_placeholder_${CLINIC}`, stripe_connect_status: 'ACTIVE' })
  // The write matches NULL or empty, so an empty id is really replaced.
  expect(Object.keys(update()?.filters ?? {})).toContain('stripe_connect_account_id.is.null,stripe_connect_account_id.eq.:or')
})

it('two clinics approved in a row: each gets its own placeholder (the column is UNIQUE)', async () => {
  const OTHER = '22222222-2222-4222-8222-222222222222'
  script = clinic(null)
  expect((await POST(req({ action: 'approve' }), ctx)).status).toBe(200)
  expect((await POST(req({ action: 'approve' }), { params: Promise.resolve({ clinicId: OTHER }) })).status).toBe(200)
  const ids = db.to('clinics', 'update').map(u => (u.payload as { stripe_connect_account_id: string }).stripe_connect_account_id)
  expect(ids).toEqual([`poc_placeholder_${CLINIC}`, `poc_placeholder_${OTHER}`])
  expect(new Set(ids).size).toBe(2)
})

it('a real Connect account is never touched: approval as today', async () => {
  script = clinic('acct_1RealAccount')
  const res = await POST(req({ action: 'approve' }), ctx)
  expect(res.status).toBe(200)
  const payload = update()?.payload as Record<string, unknown>
  expect(payload).not.toHaveProperty('stripe_connect_account_id')
  expect(payload).not.toHaveProperty('stripe_connect_status')
  expect(Object.keys(update()?.filters ?? {}).some(k => k.includes('stripe_connect_account_id'))).toBe(false)
  expect(eventNote()).toBeNull()
})

it('flag off (DEMO_PAYOUTS_ON_APPROVAL=false): approval exactly as today', async () => {
  process.env['DEMO_PAYOUTS_ON_APPROVAL'] = 'false'
  script = clinic(null)
  await POST(req({ action: 'approve' }), ctx)
  const payload = update()?.payload as Record<string, unknown>
  expect(payload).not.toHaveProperty('stripe_connect_account_id')
  expect(payload).not.toHaveProperty('stripe_connect_status')
  expect(eventNote()).toBeNull()
})

it('a Connect account added between the read and the write: no row updated, 409, nothing recorded', async () => {
  script = c => (c.table === 'clinics' && c.op === 'update' ? { data: [] } : clinic(null)(c))
  const res = await POST(req({ action: 'approve' }), ctx)
  expect(res.status).toBe(409)
  expect(db.to('clinic_onboarding_events', 'insert')).toHaveLength(0)
})

it('with the license check too: both in the note', async () => {
  script = clinic(null, 'not_found')
  await POST(req({ action: 'approve', licenseChecked: true }), ctx)
  expect(eventNote()).toContain('I checked this provider’s license with the state board')
  expect(eventNote()).toContain(NOTE)
})

it('send back never sets payouts', async () => {
  script = clinic(null)
  await POST(req({ action: 'send_back', note: 'Fix it.' }), ctx)
  expect(update()?.payload).not.toHaveProperty('stripe_connect_account_id')
})
