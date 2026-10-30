/**
 * @jest-environment node
 *
 * Pharmacy onboarding: the pharmacy_admin role.
 *
 *   - Role and pharmacy come from app_metadata only (claims.ts), like
 *     app_role and clinic_id. user_metadata is never read.
 *   - A pharmacy_admin reaches only /pharmacy/* (pages) and
 *     /api/pharmacy/* (its APIs), plus /mfa and /unauthorized. Every clinic
 *     and ops page and API sends it to /unauthorized (pages) or 403 (APIs).
 *   - Nobody else reaches /pharmacy/* or /api/pharmacy/*.
 *   - MFA follows the same rule as every other role: required only when
 *     REQUIRE_MFA is on (or the email is in MFA_ENFORCED_EMAILS). A
 *     pharmacy_admin with a verified factor is still challenged at AAL1.
 *   - Its landing page is the onboarding wizard.
 *   - The public invite link (/onboard/pharmacy/<token>, /api/onboard/*)
 *     needs no session.
 */

import { NextRequest } from 'next/server'
import { getUserPharmacyId, getUserRole, appMetadataFor } from '@/lib/auth/claims'
import { defaultLandingRoute } from '@/lib/auth/landing-route'
import { isMfaRole, mfaEnforcedFor } from '@/lib/auth/mfa'

const getUserMock = jest.fn()
const getClaimsMock = jest.fn()
jest.mock('@supabase/ssr', () => ({
  createServerClient: jest.fn(() => ({ auth: { getUser: () => getUserMock(), getClaims: () => getClaimsMock() } })),
}))
process.env['NEXT_PUBLIC_SUPABASE_URL'] = 'http://localhost'
process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] = 'anon'

import { proxy } from '../proxy'

const PHARMACY = 'a4000000-0000-4000-8000-0000000000aa'
const pharmacyAdmin = (factors: unknown[] = [{ factor_type: 'totp', status: 'verified' }]) => ({
  data: { user: { id: 'u-ph', email: 'admin@pharmacy.example', app_metadata: { app_role: 'pharmacy_admin', pharmacy_id: PHARMACY }, factors } },
})
const session = (role: string) => ({ data: { user: { id: `u-${role}`, app_metadata: { app_role: role, clinic_id: role === 'ops_admin' ? null : 'c-1' } } } })

const req = (path: string) => new NextRequest(new URL(`http://localhost${path}`), { method: 'GET' })
const location = (res: Response) => res.headers.get('location') ?? ''

beforeEach(() => {
  getUserMock.mockReset()
  getClaimsMock.mockReset().mockResolvedValue({ data: { claims: { aal: 'aal2' } } })
  delete process.env['REQUIRE_MFA']
})

describe('claims', () => {
  it('pharmacy_id comes from app_metadata only', () => {
    expect(getUserPharmacyId({ app_metadata: { pharmacy_id: PHARMACY } })).toBe(PHARMACY)
    expect(getUserPharmacyId({ app_metadata: {}, user_metadata: { pharmacy_id: PHARMACY } } as never)).toBeUndefined()
    expect(getUserRole({ app_metadata: { app_role: 'pharmacy_admin' } })).toBe('pharmacy_admin')
  })

  it('appMetadataFor sets pharmacy_id for a pharmacy_admin and no clinic', () => {
    expect(appMetadataFor({ role: 'pharmacy_admin', clinicId: null, pharmacyId: PHARMACY })).toEqual({ app_role: 'pharmacy_admin', clinic_id: null, pharmacy_id: PHARMACY })
    expect(appMetadataFor({ role: 'provider', clinicId: 'c-1' })).toEqual({ app_role: 'provider', clinic_id: 'c-1' })
  })
})

describe('MFA and landing', () => {
  it('pharmacy_admin is an MFA role, not enforced unless REQUIRE_MFA is on', () => {
    expect(isMfaRole('pharmacy_admin')).toBe(true)
    expect(mfaEnforcedFor('admin@pharmacy.example')).toBe(false)
    process.env['REQUIRE_MFA'] = 'true'
    expect(mfaEnforcedFor('admin@pharmacy.example')).toBe(true)
  })

  it('lands on the onboarding wizard', () => {
    expect(defaultLandingRoute('pharmacy_admin')).toBe('/pharmacy/onboarding')
  })
})

describe('middleware', () => {
  it('a pharmacy_admin reaches /pharmacy/* and /api/pharmacy/*', async () => {
    for (const path of ['/pharmacy/onboarding', '/api/pharmacy/onboarding']) {
      getUserMock.mockResolvedValue(pharmacyAdmin())
      const res = await proxy(req(path))
      expect(location(res)).toBe('')
    }
  })

  it('a pharmacy_admin is refused every clinic and ops page and API', async () => {
    for (const path of ['/dashboard', '/new-prescription/search', '/patients', '/practice', '/settings', '/refill', '/ops/pipeline', '/ops/onboarding/pharmacies']) {
      getUserMock.mockResolvedValue(pharmacyAdmin())
      const res = await proxy(req(path))
      expect([path, location(res)]).toEqual([path, expect.stringContaining('/unauthorized')])
    }
    for (const path of ['/api/orders', '/api/patients/x/allergies', '/api/formulations', '/api/ops/catalog', '/api/ops/onboarding/pharmacy-invites']) {
      getUserMock.mockResolvedValue(pharmacyAdmin())
      const res = await proxy(req(path))
      expect([path, res.status]).toEqual([path, 403])
    }
  })

  it('MFA pages stay reachable for a pharmacy_admin', async () => {
    getUserMock.mockResolvedValue(pharmacyAdmin([]))
    getClaimsMock.mockResolvedValue({ data: { claims: { aal: 'aal1' } } })
    expect(location(await proxy(req('/mfa/enroll')))).toBe('')
  })

  it('with REQUIRE_MFA off, no factor passes at AAL1 and an enrolled factor is still challenged', async () => {
    getClaimsMock.mockResolvedValue({ data: { claims: { aal: 'aal1' } } })
    getUserMock.mockResolvedValue(pharmacyAdmin([]))
    expect(location(await proxy(req('/pharmacy/onboarding')))).toBe('')
    getUserMock.mockResolvedValue(pharmacyAdmin([]))
    expect((await proxy(req('/api/pharmacy/onboarding'))).status).not.toBe(401)
    getUserMock.mockResolvedValue(pharmacyAdmin())
    expect(location(await proxy(req('/pharmacy/onboarding')))).toContain('/mfa/challenge')
    getUserMock.mockResolvedValue(pharmacyAdmin())
    expect((await proxy(req('/api/pharmacy/onboarding'))).status).toBe(401)
  })

  it('with REQUIRE_MFA on, a pharmacy_admin with no factor is sent to enroll like any role', async () => {
    process.env['REQUIRE_MFA'] = 'true'
    getClaimsMock.mockResolvedValue({ data: { claims: { aal: 'aal1' } } })
    getUserMock.mockResolvedValue(pharmacyAdmin([]))
    expect(location(await proxy(req('/pharmacy/onboarding')))).toContain('/mfa/enroll')
  })

  it('no other role reaches the pharmacy portal', async () => {
    for (const role of ['ops_admin', 'clinic_admin', 'provider', 'medical_assistant']) {
      getUserMock.mockResolvedValue(session(role))
      expect([role, location(await proxy(req('/pharmacy/onboarding')))]).toEqual([role, expect.stringContaining('/unauthorized')])
      getUserMock.mockResolvedValue(session(role))
      expect([role, (await proxy(req('/api/pharmacy/onboarding'))).status]).toEqual([role, 403])
    }
  })

  it('the invite link and its API need no session', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } })
    for (const path of ['/onboard/pharmacy/abc', '/api/onboard/pharmacy/abc']) {
      const res = await proxy(req(path))
      expect([path, location(res)]).toEqual([path, ''])
    }
  })

  it('a signed-out visit to the portal goes to /login', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } })
    expect(location(await proxy(req('/pharmacy/onboarding')))).toContain('/login')
  })
})
