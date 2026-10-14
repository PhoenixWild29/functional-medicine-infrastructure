/**
 * @jest-environment node
 *
 * Self sign-up: pending review. A clinic ops has not approved yet can look
 * around (Dashboard, New Prescription, Practice, Settings) but every write
 * that matters is refused SERVER SIDE, not just hidden: 403 with the
 * banner's words, and nothing written. One guard
 * (lib/onboarding/approval-guard) on every route below.
 *
 * Approved means onboarding_status 'approved' AND is_active true, as the
 * batch-sign check always required. Fails closed: a clinic that cannot be
 * read is 503, never a yes.
 */

import { NextRequest } from 'next/server'
import { fakeDb } from '@/lib/orders/__tests__/fake-db'

const CLINIC = 'c0000000-0000-4000-8000-000000000001'
const ORDER = 'a0000000-0000-4000-8000-000000000001'
const PATIENT = 'b0000000-0000-4000-8000-000000000001'
const BANNER = "We're verifying your licenses. You can look around; ordering opens once you're approved."

let db = fakeDb({})
let role = 'clinic_admin'
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u-1', email: 'a@b.test', app_metadata: { app_role: role, clinic_id: CLINIC } } }, error: null }) },
    from: (t: string) => db.client.from(t),
    rpc: (...a: unknown[]) => (db.client as unknown as { rpc: (...b: unknown[]) => unknown }).rpc?.(...a),
  }),
}))
// Nothing here may reach Stripe, SMS or the PHI log for real.
jest.mock('@/lib/sms/triggers', () => ({ sendPaymentLinkSms: jest.fn(), sendIntakeLinkSms: jest.fn() }))
jest.mock('@/lib/audit/phi-access', () => ({ logPhiAccess: jest.fn() }))

function world(clinic: Record<string, unknown>) {
  db = fakeDb({
    clinics: [{ clinic_id: CLINIC, name: 'Ruiz Family Medicine', stripe_connect_status: 'ACTIVE', ...clinic }],
    orders: [{ order_id: ORDER, clinic_id: CLINIC, status: 'DRAFT', is_active: true, deleted_at: null, patient_id: PATIENT, provider_id: 'p1' }],
    patients: [{ patient_id: PATIENT, clinic_id: CLINIC, is_active: true, deleted_at: null, first_name: 'Ana', last_name: 'Lee', phone: '+15125550100' }],
    providers: [{ provider_id: 'p1', user_id: 'u-1', clinic_id: CLINIC, is_active: true, deleted_at: null, first_name: 'Dana', last_name: 'Ruiz', npi_number: '1234567890' }],
    provider_npi_verifications: [{ provider_id: 'p1', npi: '1234567890', status: 'verified' }],
  })
}

function req(url: string, method: string, body?: unknown) {
  return new NextRequest(new URL(`https://app.example${url}`), {
    method,
    headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
const params = <T,>(p: T) => ({ params: Promise.resolve(p) })

type Call = { name: string; role?: string; run: () => Promise<Response> }
const ROUTES: Call[] = [
  { name: 'save a draft (POST /api/orders)', run: async () => (await import('@/app/api/orders/route')).POST(req('/api/orders', 'POST', { patientId: PATIENT, providerId: 'p1', formulationId: 'f1', pharmacyId: 'ph1', retailCents: 10000, sigText: 'Take one daily' })) },
  { name: 'edit a draft (PATCH /api/orders/[orderId])', run: async () => (await import('@/app/api/orders/[orderId]/route')).PATCH(req(`/api/orders/${ORDER}`, 'PATCH', { pharmacyId: 'ph1', retailCents: 10000, sigText: 'x' }), params({ orderId: ORDER })) },
  { name: 'remove a draft (DELETE /api/orders/[orderId])', run: async () => (await import('@/app/api/orders/[orderId]/route')).DELETE(req(`/api/orders/${ORDER}`, 'DELETE'), params({ orderId: ORDER })) },
  { name: 'sign (POST /api/orders/batch-sign)', run: async () => (await import('@/app/api/orders/batch-sign/route')).POST(req('/api/orders/batch-sign', 'POST', { orderIds: [ORDER], signature: {} })) },
  { name: 'pre-sign check (POST /api/orders/batch-sign/check)', run: async () => (await import('@/app/api/orders/batch-sign/check/route')).POST(req('/api/orders/batch-sign/check', 'POST', { orderIds: [ORDER] })) },
  { name: 'payment link (POST /api/orders/[orderId]/checkout-link)', run: async () => (await import('@/app/api/orders/[orderId]/checkout-link/route')).POST(req(`/api/orders/${ORDER}/checkout-link`, 'POST', {}), params({ orderId: ORDER })) },
  { name: 'group payment link (GET /api/orders/[orderId]/group-link)', run: async () => (await import('@/app/api/orders/[orderId]/group-link/route')).GET(req(`/api/orders/${ORDER}/group-link`, 'GET'), params({ orderId: ORDER })) },
  { name: 'group and send (POST /api/orders/[orderId]/group-and-send)', run: async () => (await import('@/app/api/orders/[orderId]/group-and-send/route')).POST(req(`/api/orders/${ORDER}/group-and-send`, 'POST', {}), params({ orderId: ORDER })) },
  { name: 'payment group (POST /api/checkout/payment-group)', run: async () => (await import('@/app/api/checkout/payment-group/route')).POST(req('/api/checkout/payment-group', 'POST', { orderIds: [ORDER] })) },
  { name: 'refill (POST /api/orders/refill)', run: async () => (await import('@/app/api/orders/refill/route')).POST(req('/api/orders/refill', 'POST', { orderIds: [ORDER] })) },
  { name: 'shipping (POST /api/orders/shipping)', run: async () => (await import('@/app/api/orders/shipping/route')).POST(req('/api/orders/shipping', 'POST', { orderIds: [ORDER] })) },
  { name: 'reassign to me (POST /api/orders/[orderId]/reassign-to-me)', run: async () => (await import('@/app/api/orders/[orderId]/reassign-to-me/route')).POST(req(`/api/orders/${ORDER}/reassign-to-me`, 'POST', {}), params({ orderId: ORDER })) },
  { name: 'add a patient (POST /api/patients)', run: async () => (await import('@/app/api/patients/route')).POST(req('/api/patients', 'POST', { firstName: 'Ana', lastName: 'Lee', dateOfBirth: '1980-01-01', phone: '512-555-0100', state: 'TX' })) },
  { name: 'patient intake link (POST /api/patients/[patientId]/intake-link)', run: async () => (await import('@/app/api/patients/[patientId]/intake-link/route')).POST(req(`/api/patients/${PATIENT}/intake-link`, 'POST', {}), params({ patientId: PATIENT })) },
  { name: 'import patients (POST /api/patients/import)', run: async () => (await import('@/app/api/patients/import/route')).POST(req('/api/patients/import', 'POST', { headers: ['First name'], rows: [['Ana']], mapping: {} })) },
]

beforeEach(() => {
  process.env['PHASE_C_GROUPS_ENABLED'] = 'true'
  role = 'clinic_admin'
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'info').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe.each([
  ['signed up, not yet reviewed', { onboarding_status: 'in_progress', is_active: false }],
  ['submitted for review', { onboarding_status: 'submitted', is_active: false }],
  ['sent back for changes', { onboarding_status: 'changes_requested', is_active: false }],
  ['approved but switched off', { onboarding_status: 'approved', is_active: false }],
])('a clinic %s', (_label, clinic) => {
  it.each(ROUTES.map(r => [r.name, r] as const))('%s: 403 with the banner wording, nothing written', async (_name, route) => {
    world(clinic)
    const res = await route.run()
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: BANNER, code: 'CLINIC_PENDING_REVIEW' })
    expect(db.writes).toEqual([])
  })
})

describe('an approved clinic', () => {
  it.each(ROUTES.map(r => [r.name, r] as const))('%s: not refused as pending review', async (_name, route) => {
    world({ onboarding_status: 'approved', is_active: true })
    let body: unknown = null
    try {
      const res = await route.run()
      body = await res.json().catch(() => null)
    } catch {
      // The route went past the guard into collaborators this harness does
      // not fake. That is all this control needs to show.
    }
    expect((body as { code?: string } | null)?.code).not.toBe('CLINIC_PENDING_REVIEW')
  })
})

describe('fails closed', () => {
  it('a clinic that cannot be read: 503, nothing written', async () => {
    world({ onboarding_status: 'approved', is_active: true })
    db.failOn('clinics:select')
    const res = await ROUTES[0]!.run()
    expect(res.status).toBe(503)
    expect(db.writes).toEqual([])
  })

  it('a clinic row that is missing is not approved', async () => {
    world({ onboarding_status: 'approved', is_active: true })
    db.tables['clinics']!.length = 0
    const res = await ROUTES[0]!.run()
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'CLINIC_PENDING_REVIEW' })
  })
})

describe('the batch-sign check names it in the same words', () => {
  it('clinic_not_approved carries the banner wording', async () => {
    const { checkBatch } = await import('@/lib/orders/batch-sign')
    world({ onboarding_status: 'submitted', is_active: false })
    const check = await checkBatch(db.client as never, { clinicId: CLINIC, userId: null, orderIds: [ORDER], atSigning: false })
    expect(check.problems).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'clinic_not_approved', message: BANNER })]))
  })
})
