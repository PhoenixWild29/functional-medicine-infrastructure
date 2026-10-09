/**
 * @jest-environment node
 *
 * Pharmacy onboarding API routes: who may call them, and that each one
 * hands the library the caller's own identity.
 *
 *   - /api/pharmacy/onboarding/*: a verified pharmacy_admin only
 *     (getUser(), role and pharmacy_id from app_metadata). The pharmacy is
 *     the caller's claim, never a body field.
 *   - /api/ops/onboarding/*: ops_admin only; the actor is the caller.
 *   - /api/onboard/pharmacy/<token>: no session needed.
 *   - Writes refuse a cross-site request. Answers are no-store.
 */

import { NextRequest } from 'next/server'

const getUserMock = jest.fn()
jest.mock('@/lib/supabase/server', () => ({ createServerClient: async () => ({ auth: { getUser: () => getUserMock() } }) }))
const service = { marker: 'service-client' }
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => service }))

// The mocks are created inside the factories (they run before this
// module's own constants exist) and read back with requireMock.
jest.mock('@/lib/pharmacy-onboarding/application', () => ({
  ...jest.requireActual('@/lib/pharmacy-onboarding/application'),
  loadOnboarding: jest.fn(async () => ({ ok: true, state: { status: 'in_progress' } })),
  saveDetails: jest.fn(async () => ({ ok: true })),
  saveFacility: jest.fn(async () => ({ ok: true })),
  saveOrdering: jest.fn(async () => ({ ok: true })),
  saveShipping: jest.fn(async () => ({ ok: true })),
  saveCatalog: jest.fn(async () => ({ ok: true, rowCount: 1, warnings: [] })),
  acceptAgreement: jest.fn(async () => ({ ok: true })),
  submitApplication: jest.fn(async () => ({ ok: true })),
  saveLicense: jest.fn(async () => ({ ok: true })),
  deleteLicense: jest.fn(async () => ({ ok: true })),
  attachLicenseDocument: jest.fn(async () => ({ ok: true })),
}))
jest.mock('@/lib/pharmacy-onboarding/invites', () => ({
  createInvite: jest.fn(async () => ({ ok: true, invite: { inviteId: 'i-1' }, link: 'https://app.example/onboard/pharmacy/x' })),
  listInvites: jest.fn(async () => ({ ok: true, invites: [] })),
  revokeInvite: jest.fn(async () => ({ ok: true, invite: {} })),
  resendInvite: jest.fn(async () => ({ ok: true, invite: {}, link: 'l' })),
  inviteForToken: jest.fn(async () => ({ state: 'pending', pharmacyName: 'Strive', adminEmail: 'd@s.example', expiresAt: 'x' })),
  acceptInvite: jest.fn(async () => ({ ok: true, email: 'd@s.example' })),
}))
jest.mock('@/lib/pharmacy-onboarding/review', () => ({
  listApplications: jest.fn(async () => ({ ok: true, applications: [] })),
  getApplicationReview: jest.fn(async () => ({ ok: true, review: {} })),
  decideLicense: jest.fn(async () => ({ ok: true })),
  approveApplication: jest.fn(async () => ({ ok: true })),
  sendBackApplication: jest.fn(async () => ({ ok: true })),
}))
type Mocked = Record<string, jest.Mock>
const lib = jest.requireMock('@/lib/pharmacy-onboarding/application') as Mocked
const invites = jest.requireMock('@/lib/pharmacy-onboarding/invites') as Mocked
const review = jest.requireMock('@/lib/pharmacy-onboarding/review') as Mocked

import * as wizard from '@/app/api/pharmacy/onboarding/route'
import * as step from '@/app/api/pharmacy/onboarding/[step]/route'
import * as licenses from '@/app/api/pharmacy/onboarding/licenses/route'
import * as license from '@/app/api/pharmacy/onboarding/licenses/[state]/route'
import * as document from '@/app/api/pharmacy/onboarding/licenses/[state]/document/route'
import * as opsInvites from '@/app/api/ops/onboarding/pharmacy-invites/route'
import * as revoke from '@/app/api/ops/onboarding/pharmacy-invites/[inviteId]/revoke/route'
import * as resend from '@/app/api/ops/onboarding/pharmacy-invites/[inviteId]/resend/route'
import * as opsApps from '@/app/api/ops/onboarding/pharmacies/route'
import * as opsApp from '@/app/api/ops/onboarding/pharmacies/[applicationId]/route'
import * as decide from '@/app/api/ops/onboarding/pharmacies/[applicationId]/licenses/[state]/route'
import * as approve from '@/app/api/ops/onboarding/pharmacies/[applicationId]/approve/route'
import * as sendBack from '@/app/api/ops/onboarding/pharmacies/[applicationId]/send-back/route'
import * as onboard from '@/app/api/onboard/pharmacy/[token]/route'

const PH = 'ph000000-0000-4000-8000-000000000001'
const asPharmacyAdmin = () => getUserMock.mockResolvedValue({ data: { user: { id: 'u-ph', app_metadata: { app_role: 'pharmacy_admin', pharmacy_id: PH } } }, error: null })
const asOps = () => getUserMock.mockResolvedValue({ data: { user: { id: 'u-ops', app_metadata: { app_role: 'ops_admin' } } }, error: null })
const as = (role: string) => getUserMock.mockResolvedValue({ data: { user: { id: `u-${role}`, app_metadata: { app_role: role, clinic_id: 'c-1' }, user_metadata: { app_role: 'pharmacy_admin', pharmacy_id: PH } } }, error: null })
const signedOut = () => getUserMock.mockResolvedValue({ data: { user: null }, error: { message: 'no session' } })

const req = (method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(new URL('https://app.example/api/x'), { method, headers: { 'content-type': 'application/json', ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) })

beforeEach(() => {
  jest.clearAllMocks()
})

describe('the pharmacy portal API', () => {
  it('a pharmacy_admin: the pharmacy comes from its claims, never the body', async () => {
    asPharmacyAdmin()
    const res = await step.PUT(req('PUT', { facilityType: '503A', pharmacyId: 'someone-else' }), params({ step: 'facility' }))
    expect(res.status).toBe(200)
    expect(lib.saveFacility).toHaveBeenCalledWith(service, { pharmacyId: PH, userId: 'u-ph' }, expect.objectContaining({ facilityType: '503A' }))
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('each step reaches its handler; an unknown step is 404', async () => {
    asPharmacyAdmin()
    for (const [name, fn] of [['details', lib.saveDetails], ['ordering', lib.saveOrdering], ['shipping', lib.saveShipping], ['catalog', lib.saveCatalog]] as const) {
      expect((await step.PUT(req('PUT', {}), params({ step: name }))).status).toBe(200)
      expect(fn).toHaveBeenCalled()
    }
    expect((await step.POST(req('POST', {}), params({ step: 'agreement' }))).status).toBe(200)
    expect(lib.acceptAgreement).toHaveBeenCalled()
    expect((await step.POST(req('POST', {}), params({ step: 'submit' }))).status).toBe(200)
    expect(lib.submitApplication).toHaveBeenCalled()
    expect((await step.PUT(req('PUT', {}), params({ step: 'nope' }))).status).toBe(404)
  })

  it('anyone else is refused: signed out 401; other roles (even with a forged user_metadata) 403', async () => {
    signedOut()
    expect((await wizard.GET()).status).toBe(401)
    for (const role of ['ops_admin', 'clinic_admin', 'provider', 'medical_assistant']) {
      if (role === 'ops_admin') asOps()
      else as(role)
      expect((await wizard.GET()).status).toBe(403)
      expect((await licenses.POST(req('POST', {}))).status).toBe(403)
    }
    expect(lib.loadOnboarding).not.toHaveBeenCalled()
    expect(lib.saveLicense).not.toHaveBeenCalled()
  })

  it('a pharmacy_admin without a pharmacy_id claim is refused', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u', app_metadata: { app_role: 'pharmacy_admin' } } }, error: null })
    expect((await wizard.GET()).status).toBe(403)
  })

  it('a cross-site write is refused', async () => {
    asPharmacyAdmin()
    expect((await step.PUT(req('PUT', {}, { 'sec-fetch-site': 'cross-site' }), params({ step: 'facility' }))).status).toBe(403)
    expect(lib.saveFacility).not.toHaveBeenCalled()
  })

  it('licenses: save, remove, and a document as multipart', async () => {
    asPharmacyAdmin()
    expect((await licenses.POST(req('POST', { state: 'TX' }))).status).toBe(200)
    expect((await license.DELETE(req('DELETE'), params({ state: 'TX' }))).status).toBe(200)
    expect(lib.deleteLicense).toHaveBeenCalledWith(service, { pharmacyId: PH, userId: 'u-ph' }, 'TX')

    const form = new FormData()
    form.append('file', new File([new Uint8Array([37, 80, 68, 70])], 'license.pdf', { type: 'application/pdf' }))
    const upload = new NextRequest(new URL('https://app.example/api/x'), { method: 'POST', body: form })
    expect((await document.POST(upload, params({ state: 'tx' }))).status).toBe(200)
    expect(lib.attachLicenseDocument).toHaveBeenCalledWith(service, { pharmacyId: PH, userId: 'u-ph' }, 'tx', expect.objectContaining({ name: 'license.pdf', type: 'application/pdf', size: 4 }))
  })

  it('a document request with no file is 400', async () => {
    asPharmacyAdmin()
    const upload = new NextRequest(new URL('https://app.example/api/x'), { method: 'POST', body: new FormData() })
    expect((await document.POST(upload, params({ state: 'TX' }))).status).toBe(400)
  })
})

describe('the ops API', () => {
  it('ops_admin only; the actor is the caller', async () => {
    asOps()
    expect((await opsInvites.POST(req('POST', { pharmacyName: 'Strive', adminEmail: 'd@s.example' }))).status).toBe(200)
    expect(invites.createInvite).toHaveBeenCalledWith(service, { actor: { userId: 'u-ops', role: 'ops_admin' }, pharmacyName: 'Strive', adminEmail: 'd@s.example' })
    expect((await opsInvites.GET()).status).toBe(200)
    expect((await revoke.POST(req('POST'), params({ inviteId: 'i-1' }))).status).toBe(200)
    expect((await resend.POST(req('POST'), params({ inviteId: 'i-1' }))).status).toBe(200)
    expect((await opsApps.GET()).status).toBe(200)
    expect((await opsApp.GET(req('GET'), params({ applicationId: 'a-1' }))).status).toBe(200)
    expect((await decide.POST(req('POST', { decision: 'verify' }), params({ applicationId: 'a-1', state: 'TX' }))).status).toBe(200)
    expect(review.decideLicense).toHaveBeenCalledWith(service, { actor: { userId: 'u-ops', role: 'ops_admin' }, applicationId: 'a-1', state: 'TX', decision: 'verify', note: null })
    expect((await approve.POST(req('POST'), params({ applicationId: 'a-1' }))).status).toBe(200)
    expect((await sendBack.POST(req('POST', { note: 'Fix CA' }), params({ applicationId: 'a-1' }))).status).toBe(200)
  })

  it('a pharmacy_admin or clinic user is refused (403), signed out 401', async () => {
    for (const set of [asPharmacyAdmin, () => as('clinic_admin')]) {
      set()
      expect((await opsInvites.POST(req('POST', {}))).status).toBe(403)
      expect((await approve.POST(req('POST'), params({ applicationId: 'a-1' }))).status).toBe(403)
    }
    signedOut()
    expect((await opsApps.GET()).status).toBe(401)
    expect(invites.createInvite).not.toHaveBeenCalled()
    expect(review.approveApplication).not.toHaveBeenCalled()
  })

  it('a library refusal keeps its status and message', async () => {
    asOps()
    review.approveApplication!.mockResolvedValueOnce({ ok: false, status: 409, error: 'Verify every license first.' } as never)
    const res = await approve.POST(req('POST'), params({ applicationId: 'a-1' }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual(expect.objectContaining({ error: 'Verify every license first.' }))
  })
})

describe('the invite link API (no session)', () => {
  it('reads and accepts without a session', async () => {
    signedOut()
    expect((await onboard.GET(req('GET'), params({ token: 'tok' }))).status).toBe(200)
    expect((await onboard.POST(req('POST', { fullName: 'Dana', password: 'x' }), params({ token: 'tok' }))).status).toBe(200)
    expect(invites.acceptInvite).toHaveBeenCalledWith(service, { token: 'tok', fullName: 'Dana', password: 'x' })
  })

  it('an unknown link is 404; a cross-site accept is refused', async () => {
    invites.inviteForToken!.mockResolvedValueOnce(null as never)
    expect((await onboard.GET(req('GET'), params({ token: 'tok' }))).status).toBe(404)
    expect((await onboard.POST(req('POST', {}, { 'sec-fetch-site': 'cross-site' }), params({ token: 'tok' }))).status).toBe(403)
  })
})
