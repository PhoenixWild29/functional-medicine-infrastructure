/**
 * @jest-environment node
 *
 * Patient Intake PR 3: POST /api/settings/signup-link, the clinic admin
 * managing the clinic's standing sign-up link.
 *
 *   { action: 'create' }   Make a new link: the old one stops working.
 *   { action: 'disable' }  Turn off (patients who open it are told it is
 *                          no longer active).
 *   { action: 'enable' }   Turn back on.
 *
 * Clinic admin only: medical assistants see the link read-only, providers
 * and ops are refused (403). The clinic comes from the caller's claims
 * (claims.ts), never the request. getUser(), never getSession(). A
 * cross-site request is refused.
 */

const CLINIC_ID = 'aaaaaaaa-aaaa-4aaa-9aaa-aaaaaaaaaaaa'
const OTHER_CLINIC = 'bbbbbbbb-bbbb-4bbb-9bbb-bbbbbbbbbbbb'

const getUserMock = jest.fn()
const getSessionMock = jest.fn()
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn(async () => ({ auth: { getUser: () => getUserMock(), getSession: () => getSessionMock() } })),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ service: true }) }))

const LINK = { linkId: 'l1', enabled: true, useCount: 0, lastUsedAt: null, createdAt: '2026-10-14T10:00:00Z', url: 'https://app.test/join/T' }
const createMock = jest.fn()
const enableMock = jest.fn()
jest.mock('@/lib/intake/signup-links', () => ({
  createSignupLink: (...a: unknown[]) => createMock(...a),
  setSignupLinkEnabled: (...a: unknown[]) => enableMock(...a),
}))

// Self sign-up: the approval guard (lib/onboarding/approval-guard). The
// clinic is approved unless a test says otherwise.
const approvalMock = jest.fn()
jest.mock('@/lib/onboarding/approval-guard', () => ({
  ...jest.requireActual('@/lib/onboarding/approval-guard'),
  refuseUnlessApproved: (...a: unknown[]) => approvalMock(...a),
}))

import { POST } from '../route'

const BANNER = "We're verifying your licenses. You can look around; ordering opens once you're approved."
/** A clinic row as the real guard reads it. */
const clinicDb = (row: Record<string, unknown>) => ({
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) }),
})
function notApproved() {
  const actual = jest.requireActual('@/lib/onboarding/approval-guard') as typeof import('@/lib/onboarding/approval-guard')
  approvalMock.mockImplementation((_db: unknown, clinicId: string) =>
    actual.refuseUnlessApproved(clinicDb({ onboarding_status: 'submitted', is_active: false }) as never, clinicId))
}

function signedIn(role: string, clinicId: string | null = CLINIC_ID) {
  getUserMock.mockResolvedValue({ data: { user: { id: 'user-1', app_metadata: { app_role: role, ...(clinicId ? { clinic_id: clinicId } : {}) } } }, error: null })
}
const req = (body: unknown, headers: Record<string, string> = {}) => new Request('https://app.test/api/settings/signup-link', {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
}) as unknown as import('next/server').NextRequest

beforeEach(() => {
  getUserMock.mockReset()
  getSessionMock.mockReset()
  createMock.mockReset().mockResolvedValue({ ok: true, link: LINK })
  enableMock.mockReset().mockResolvedValue({ ok: true, link: { ...LINK, enabled: false } })
  approvalMock.mockReset().mockResolvedValue(null)
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe('a clinic that is not approved', () => {
  it.each([['create', 'make a new link (or the first one)'], ['enable', 'turn it on']])('%s (%s): 403 with the banner wording, nothing changed', async action => {
    signedIn('clinic_admin')
    notApproved()
    const res = await POST(req({ action }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: BANNER, code: 'CLINIC_PENDING_REVIEW' })
    expect(createMock).not.toHaveBeenCalled()
    expect(enableMock).not.toHaveBeenCalled()
    // The caller's clinic, from the claims.
    expect(approvalMock).toHaveBeenCalledWith(expect.anything(), CLINIC_ID)
  })

  it('turning a link off is still allowed', async () => {
    signedIn('clinic_admin')
    notApproved()
    expect((await POST(req({ action: 'disable' }))).status).toBe(200)
    expect(enableMock).toHaveBeenCalledWith(expect.anything(), { clinicId: CLINIC_ID, enabled: false })
  })
})

describe('who may', () => {
  it('no session: 401', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
    expect((await POST(req({ action: 'create' }))).status).toBe(401)
    expect(createMock).not.toHaveBeenCalled()
  })

  it.each(['medical_assistant', 'provider', 'ops_admin', 'pharmacy_admin'])('%s: 403, nothing changed', async role => {
    signedIn(role)
    const res = await POST(req({ action: 'create' }))
    expect(res.status).toBe(403)
    expect(createMock).not.toHaveBeenCalled()
    expect(enableMock).not.toHaveBeenCalled()
  })

  it('a clinic admin with no clinic in the claims: 400', async () => {
    signedIn('clinic_admin', null)
    expect((await POST(req({ action: 'create' }))).status).toBe(400)
  })

  it('a cross-site request: 403', async () => {
    signedIn('clinic_admin')
    expect((await POST(req({ action: 'create' }, { 'sec-fetch-site': 'cross-site' }))).status).toBe(403)
    expect(createMock).not.toHaveBeenCalled()
  })

  it('uses getUser, never getSession', async () => {
    signedIn('clinic_admin')
    await POST(req({ action: 'create' }))
    expect(getUserMock).toHaveBeenCalled()
    expect(getSessionMock).not.toHaveBeenCalled()
  })
})

describe('the clinic admin', () => {
  beforeEach(() => signedIn('clinic_admin'))

  it('make a new link: in the caller’s clinic from claims, never the body; by this user', async () => {
    const res = await POST(req({ action: 'create', clinicId: OTHER_CLINIC }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ link: LINK })
    expect(createMock).toHaveBeenCalledWith({ service: true }, { clinicId: CLINIC_ID, createdBy: 'user-1' })
  })

  it('turn off and turn on, in the caller’s clinic', async () => {
    expect((await POST(req({ action: 'disable', clinicId: OTHER_CLINIC }))).status).toBe(200)
    expect(enableMock).toHaveBeenLastCalledWith({ service: true }, { clinicId: CLINIC_ID, enabled: false })
    await POST(req({ action: 'enable' }))
    expect(enableMock).toHaveBeenLastCalledWith({ service: true }, { clinicId: CLINIC_ID, enabled: true })
  })

  it('turn off with no link yet: 404', async () => {
    enableMock.mockResolvedValue({ ok: false, error: 'none' })
    expect((await POST(req({ action: 'disable' }))).status).toBe(404)
  })

  it('a database error: 500', async () => {
    createMock.mockResolvedValue({ ok: false })
    expect((await POST(req({ action: 'create' }))).status).toBe(500)
  })

  it.each([{}, { action: 'delete' }, { action: 1 }])('an unknown action %j: 400', async body => {
    expect((await POST(req(body))).status).toBe(400)
  })
})
