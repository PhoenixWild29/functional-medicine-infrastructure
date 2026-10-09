/**
 * @jest-environment node
 *
 * A signed-in user can rewrite their own user_metadata with
 * supabase.auth.updateUser(). Middleware must give that edit nothing:
 * the role comes from app_metadata (set only with the service role).
 *
 *   - no /ops for a provider who wrote app_role = ops_admin
 *   - no Practice for a medical assistant who wrote app_role = clinic_admin
 *   - no signing page for a clinic admin who wrote app_role = provider
 *   - a user with a role only in user_metadata is no staff role at all
 *   - MFA: a provider who wrote a non-staff app_role is still gated
 */

import { middleware } from '../middleware'
import { NextRequest } from 'next/server'

const getUserMock   = jest.fn()
const getClaimsMock = jest.fn()

jest.mock('@/lib/auth/checkout-token', () => ({ verifyCheckoutToken: jest.fn() }))
jest.mock('@supabase/ssr', () => ({
  createServerClient: jest.fn(() => ({
    auth: { getUser: () => getUserMock(), getClaims: () => getClaimsMock() },
  })),
}))

process.env['NEXT_PUBLIC_SUPABASE_URL'] = 'http://localhost'
process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] = 'anon'

const CLINIC = '11111111-1111-4111-8111-111111111111'
const req = (pathname: string) => new NextRequest(new URL(`http://localhost${pathname}`), { method: 'GET' })
const location = (res: Response) => res.headers.get('location') ? new URL(res.headers.get('location')!).pathname : null

function signedIn(appRole: string | undefined, userMetadataRole: string) {
  return {
    data: {
      user: {
        id: 'u-1',
        email: 'someone@clinic.test',
        app_metadata:  appRole ? { app_role: appRole, clinic_id: CLINIC } : {},
        user_metadata: { app_role: userMetadataRole, clinic_id: CLINIC },
        factors: [],
      },
    },
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env['REQUIRE_MFA']
  delete process.env['MFA_ENFORCED_EMAILS']
  getClaimsMock.mockResolvedValue({ data: { claims: { aal: 'aal1', sub: 'u-1' } }, error: null })
})

describe('self-edited user_metadata grants nothing in middleware', () => {
  it('provider who wrote app_role=ops_admin does not reach /ops', async () => {
    getUserMock.mockResolvedValue(signedIn('provider', 'ops_admin'))
    expect(location(await middleware(req('/ops/pipeline')))).toBe('/unauthorized')
  })

  it('medical assistant who wrote app_role=clinic_admin does not reach Practice', async () => {
    getUserMock.mockResolvedValue(signedIn('medical_assistant', 'clinic_admin'))
    expect(location(await middleware(req('/practice')))).toBe('/unauthorized')
  })

  it('clinic admin who wrote app_role=provider does not reach the signing page', async () => {
    getUserMock.mockResolvedValue(signedIn('clinic_admin', 'provider'))
    expect(location(await middleware(req('/new-prescription/sign')))).toBe('/unauthorized')
  })

  it('a role that exists only in user_metadata is not a role: no Practice', async () => {
    getUserMock.mockResolvedValue(signedIn(undefined, 'clinic_admin'))
    expect(location(await middleware(req('/practice')))).toBe('/unauthorized')
  })

  it('control: the real clinic admin (app_metadata) reaches Practice', async () => {
    getUserMock.mockResolvedValue(signedIn('clinic_admin', 'clinic_admin'))
    const res = await middleware(req('/practice'))
    expect(res.status).toBe(200)
    expect(location(res)).toBeNull()
  })

  it('MFA: a provider who wrote a non-staff app_role is still sent to enroll', async () => {
    process.env['REQUIRE_MFA'] = 'true'
    getUserMock.mockResolvedValue(signedIn('provider', 'patient'))
    expect(location(await middleware(req('/dashboard')))).toBe('/mfa/enroll')
  })

  it('MFA: a user who wrote app_role=provider into user_metadata alone is not treated as staff', async () => {
    process.env['REQUIRE_MFA'] = 'true'
    getUserMock.mockResolvedValue(signedIn('ops_admin', 'provider'))
    // Gated as ops_admin (the real role), on the ops pipeline.
    expect(location(await middleware(req('/ops/pipeline')))).toBe('/mfa/enroll')
  })
})
