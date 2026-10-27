/**
 * @jest-environment node
 *
 * Security review follow-up (L6): one same-origin rule for writes. A
 * browser write is accepted only when Sec-Fetch-Site is "same-origin" or
 * "none", or the header is absent (curl, server-to-server). "same-site"
 * (a sibling subdomain) and "cross-site" are refused with 403 before any
 * session is read. Each route keeps the 403 wording it had.
 */

import { NextRequest } from 'next/server'
import { refuseCrossSite, isCrossSiteWrite } from '@/lib/security/same-origin'

const sessionRead = jest.fn(() => { throw new Error('the session was read before the same-origin check') })
jest.mock('@/lib/supabase/server', () => ({ createServerClient: () => sessionRead() }))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => { throw new Error('the service client was made before the same-origin check') } }))
jest.spyOn(console, 'error').mockImplementation(() => {})
// The EPCS route imports otplib (ESM only); it is never reached here.
jest.mock('otplib', () => ({ TOTP: class {}, generateSecret: () => 'S', generateURI: () => 'otpauth://totp/x', verifySync: () => ({ valid: false }) }))

const ID = '11111111-1111-4111-8111-111111111111'
const TOKEN = 'A'.repeat(43)
const CROSS_SITE = 'Cross-site requests are not permitted'

describe('the rule', () => {
  const h = (v?: string) => new Headers(v === undefined ? {} : { 'sec-fetch-site': v })
  it.each([[undefined, false], ['same-origin', false], ['none', false], ['same-site', true], ['cross-site', true], ['SAME-ORIGIN', false]])('Sec-Fetch-Site %s: refused %s', (v, refused) => {
    expect(isCrossSiteWrite(h(v))).toBe(refused)
  })

  it('the default wording, and a route\'s own', async () => {
    const r1 = refuseCrossSite(new Request('https://app.test/x', { method: 'POST', headers: { 'sec-fetch-site': 'same-site' } }))
    expect(r1?.status).toBe(403)
    expect(await r1!.json()).toEqual({ error: 'Cross-site requests are not permitted' })
    const r2 = refuseCrossSite(new Request('https://app.test/x', { method: 'POST', headers: { 'sec-fetch-site': 'cross-site' } }), 'Forbidden')
    expect(await r2!.json()).toEqual({ error: 'Forbidden' })
    expect(refuseCrossSite(new Request('https://app.test/x', { method: 'POST' }))).toBeNull()
  })
})

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>
const ROUTES: Array<[string, () => Promise<Handler>, Record<string, string>, string]> = [
  ['POST /api/signup', async () => (await import('@/app/api/signup/route')).POST as unknown as Handler, {}, 'Forbidden'],
  ['POST /api/join/[token]', async () => (await import('@/app/api/join/[token]/route')).POST as unknown as Handler, { token: TOKEN }, 'Cross-site requests are not permitted'],
  ['POST /api/onboarding/invite/accept', async () => (await import('@/app/api/onboarding/invite/accept/route')).POST as unknown as Handler, {}, 'Cross-site requests are not permitted'],
  ['POST /api/protocols', async () => (await import('@/app/api/protocols/route')).POST as unknown as Handler, {}, 'Cross-site requests are not permitted'],
  ['POST /api/pharmacy/onboarding/licenses/[state]/document', async () => (await import('@/app/api/pharmacy/onboarding/licenses/[state]/document/route')).POST as unknown as Handler, { state: 'TX' }, 'Forbidden'],
  ['POST /api/ops/onboarding', async () => (await import('@/app/api/ops/onboarding/route')).POST as unknown as Handler, {}, 'Cross-site requests are not permitted'],
  ['POST /api/ops/onboarding/clinics/[clinicId]', async () => (await import('@/app/api/ops/onboarding/clinics/[clinicId]/route')).POST as unknown as Handler, { clinicId: ID }, 'Cross-site requests are not permitted'],
  ['POST /api/ops/fax/[faxId]/action', async () => (await import('@/app/api/ops/fax/[faxId]/action/route')).POST as unknown as Handler, { faxId: ID }, 'Cross-site requests are not permitted'],
  ['POST /api/ops/orders/[orderId]/action', async () => (await import('@/app/api/ops/orders/[orderId]/action/route')).POST as unknown as Handler, { orderId: ID }, 'Cross-site requests are not permitted'],
  ['POST /api/ops/catalog/upload', async () => (await import('@/app/api/ops/catalog/upload/route')).POST as unknown as Handler, {}, 'Cross-site requests are not permitted'],
  // Saved clinical difference statements (coverage gap 6).
  ['POST /api/clinical-statements', async () => (await import('@/app/api/clinical-statements/route')).POST as unknown as Handler, {}, CROSS_SITE],
  ['DELETE /api/clinical-statements', async () => (await import('@/app/api/clinical-statements/route')).DELETE as unknown as Handler, {}, CROSS_SITE],
  // Security follow-ups 3: every other cookie-authenticated write.
  ['POST /api/ops/adapters/[pharmacyId]/action', async () => (await import('@/app/api/ops/adapters/[pharmacyId]/action/route')).POST as unknown as Handler, { pharmacyId: ID }, CROSS_SITE],
  ['POST /api/ops/catalog/item', async () => (await import('@/app/api/ops/catalog/item/route')).POST as unknown as Handler, {}, CROSS_SITE],
  ['PATCH /api/ops/catalog/item', async () => (await import('@/app/api/ops/catalog/item/route')).PATCH as unknown as Handler, {}, CROSS_SITE],
  ['POST /api/ops/catalog/rollback', async () => (await import('@/app/api/ops/catalog/rollback/route')).POST as unknown as Handler, {}, CROSS_SITE],
  ['POST /api/ops/catalog/sync/[pharmacyId]', async () => (await import('@/app/api/ops/catalog/sync/[pharmacyId]/route')).POST as unknown as Handler, { pharmacyId: ID }, CROSS_SITE],
  ['PUT /api/ops/ingredients/[ingredientId]/compounding', async () => (await import('@/app/api/ops/ingredients/[ingredientId]/compounding/route')).PUT as unknown as Handler, { ingredientId: ID }, CROSS_SITE],
  ['POST /api/ops/payables/mark', async () => (await import('@/app/api/ops/payables/mark/route')).POST as unknown as Handler, {}, CROSS_SITE],
  ['POST /api/ops/sla/acknowledge', async () => (await import('@/app/api/ops/sla/acknowledge/route')).POST as unknown as Handler, {}, CROSS_SITE],
  ['POST /api/ops/onboarding/invites/[inviteId]', async () => (await import('@/app/api/ops/onboarding/invites/[inviteId]/route')).POST as unknown as Handler, { inviteId: ID }, CROSS_SITE],
  ['POST /api/admin/refresh-demo-data', async () => (await import('@/app/api/admin/refresh-demo-data/route')).POST as unknown as Handler, {}, CROSS_SITE],
  ['POST /api/admin/reset-poc-credentials', async () => (await import('@/app/api/admin/reset-poc-credentials/route')).POST as unknown as Handler, {}, CROSS_SITE],
  ['POST /api/checkout/payment-group', async () => (await import('@/app/api/checkout/payment-group/route')).POST as unknown as Handler, {}, CROSS_SITE],
  ['PATCH /api/clinic/settings', async () => (await import('@/app/api/clinic/settings/route')).PATCH as unknown as Handler, {}, CROSS_SITE],
  ['POST /api/coaching/prefs', async () => (await import('@/app/api/coaching/prefs/route')).POST as unknown as Handler, {}, CROSS_SITE],
  ['POST /api/favorites', async () => (await import('@/app/api/favorites/route')).POST as unknown as Handler, {}, CROSS_SITE],
  ['PATCH /api/favorites', async () => (await import('@/app/api/favorites/route')).PATCH as unknown as Handler, {}, CROSS_SITE],
  ['DELETE /api/favorites', async () => (await import('@/app/api/favorites/route')).DELETE as unknown as Handler, {}, CROSS_SITE],
  ['POST /api/onboarding/agreements', async () => (await import('@/app/api/onboarding/agreements/route')).POST as unknown as Handler, {}, CROSS_SITE],
  ['PUT /api/onboarding/practice', async () => (await import('@/app/api/onboarding/practice/route')).PUT as unknown as Handler, {}, CROSS_SITE],
  ['POST /api/onboarding/providers', async () => (await import('@/app/api/onboarding/providers/route')).POST as unknown as Handler, {}, CROSS_SITE],
  ['POST /api/onboarding/staff', async () => (await import('@/app/api/onboarding/staff/route')).POST as unknown as Handler, {}, CROSS_SITE],
  ['POST /api/onboarding/steps', async () => (await import('@/app/api/onboarding/steps/route')).POST as unknown as Handler, {}, CROSS_SITE],
  ['POST /api/onboarding/submit', async () => (await import('@/app/api/onboarding/submit/route')).POST as unknown as Handler, {}, CROSS_SITE],
  ['POST /api/onboarding/invites/[inviteId]', async () => (await import('@/app/api/onboarding/invites/[inviteId]/route')).POST as unknown as Handler, { inviteId: ID }, CROSS_SITE],
  ['POST /api/orders', async () => (await import('@/app/api/orders/route')).POST as unknown as Handler, {}, CROSS_SITE],
  ['PATCH /api/orders/[orderId]', async () => (await import('@/app/api/orders/[orderId]/route')).PATCH as unknown as Handler, { orderId: ID }, CROSS_SITE],
  ['DELETE /api/orders/[orderId]', async () => (await import('@/app/api/orders/[orderId]/route')).DELETE as unknown as Handler, { orderId: ID }, CROSS_SITE],
  ['POST /api/orders/[orderId]/reassign-to-me', async () => (await import('@/app/api/orders/[orderId]/reassign-to-me/route')).POST as unknown as Handler, { orderId: ID }, CROSS_SITE],
  ['POST /api/orders/refill', async () => (await import('@/app/api/orders/refill/route')).POST as unknown as Handler, {}, CROSS_SITE],
  ['POST /api/orders/shipping', async () => (await import('@/app/api/orders/shipping/route')).POST as unknown as Handler, {}, CROSS_SITE],
  ['POST /api/orders/batch-sign/check', async () => (await import('@/app/api/orders/batch-sign/check/route')).POST as unknown as Handler, {}, CROSS_SITE],
  ['PATCH /api/patients/[patientId]/allergies', async () => (await import('@/app/api/patients/[patientId]/allergies/route')).PATCH as unknown as Handler, { patientId: ID }, CROSS_SITE],
  ['POST /api/providers', async () => (await import('@/app/api/providers/route')).POST as unknown as Handler, {}, CROSS_SITE],
  ['PUT /api/providers/[providerId]/licenses', async () => (await import('@/app/api/providers/[providerId]/licenses/route')).PUT as unknown as Handler, { providerId: ID }, CROSS_SITE],
  ['POST /api/providers/[providerId]/npi-check', async () => (await import('@/app/api/providers/[providerId]/npi-check/route')).POST as unknown as Handler, { providerId: ID }, CROSS_SITE],
  ['POST /api/settings/agreements', async () => (await import('@/app/api/settings/agreements/route')).POST as unknown as Handler, {}, CROSS_SITE],
  ['POST /api/stripe/connect-onboarding', async () => (await import('@/app/api/stripe/connect-onboarding/route')).POST as unknown as Handler, {}, CROSS_SITE],
  // C-2026-10-25-07: the two routes kept by hand, and Keragon (which refused cross-site only, not same-site).
  ['POST /api/epcs', async () => (await import('@/app/api/epcs/route')).POST as unknown as Handler, {}, CROSS_SITE],
  ['POST /api/patient-phases', async () => (await import('@/app/api/patient-phases/route')).POST as unknown as Handler, {}, CROSS_SITE],
  ['PATCH /api/patient-phases', async () => (await import('@/app/api/patient-phases/route')).PATCH as unknown as Handler, {}, CROSS_SITE],
  ['DELETE /api/integrations/keragon/connection', async () => (await import('@/app/api/integrations/keragon/connection/route')).DELETE as unknown as Handler, {}, 'Forbidden'],
  ['POST /api/integrations/keragon/connection/secret', async () => (await import('@/app/api/integrations/keragon/connection/secret/route')).POST as unknown as Handler, {}, 'Forbidden'],
]

// Each case loads its route (await import) inside the test, and the first
// load compiles the route and its import tree: up to 3.2 s for one case in a
// full run, against jest's 5 s per-test default (B-2026-10-26-10). Load
// every route once here, with room for cold compiles; the cases then get them
// from the module registry (nothing here resets modules).
beforeAll(async () => { await Promise.all(ROUTES.map(([, load]) => load())) }, 180_000)

describe.each(ROUTES)('%s', (_name, load, params, wording) => {
  it.each(['same-site', 'cross-site'])('Sec-Fetch-Site %s: 403 with its wording, before any session read', async site => {
    sessionRead.mockClear()
    const handler = await load()
    const req = new NextRequest('https://app.test/api/x', { method: 'POST', headers: { 'sec-fetch-site': site, 'content-type': 'application/json' }, body: '{}' })
    const res = await handler(req, { params: Promise.resolve(params) })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: wording })
    expect(sessionRead).not.toHaveBeenCalled()
  })
})
