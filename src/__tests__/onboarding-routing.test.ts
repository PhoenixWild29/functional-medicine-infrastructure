/**
 * @jest-environment node
 *
 * Clinic onboarding routing:
 *   - middleware: the invite links (/onboard/clinic/<token>,
 *     /onboard/join/<token>) and the accept API are reachable signed out
 *     (the token is the credential); the wizard (/onboarding) and its APIs
 *     are not, and /onboarding is not mistaken for /onboard/
 *   - the clinic app sends any user of a clinic that ops has not approved
 *     to /onboarding; an approved clinic is unchanged
 */

import { NextRequest } from 'next/server'

// ── middleware ───────────────────────────────────────────────
const getUserMock = jest.fn()
jest.mock('@supabase/ssr', () => ({
  createServerClient: jest.fn(() => ({ auth: { getUser: () => getUserMock(), getClaims: async () => ({ data: { claims: { aal: 'aal1' } }, error: null }) } })),
}))
jest.mock('@/lib/auth/checkout-token', () => ({ verifyCheckoutToken: jest.fn() }))
process.env['NEXT_PUBLIC_SUPABASE_URL'] = 'http://localhost'
process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] = 'anon'

import { middleware } from '../middleware'

const location = (res: Response) => (res.headers.get('location') ? new URL(res.headers.get('location')!).pathname : null)
const req = (path: string, method = 'GET') => new NextRequest(new URL(`http://localhost${path}`), { method })

describe('middleware: who can reach onboarding', () => {
  beforeEach(() => getUserMock.mockReset().mockResolvedValue({ data: { user: null } }))

  it.each(['/onboard/clinic/abc123', '/onboard/join/abc123'])('%s is reachable signed out', async path => {
    const res = await middleware(req(path))
    expect(location(res)).toBeNull()
  })

  it('the accept API is reachable signed out', async () => {
    const res = await middleware(req('/api/onboarding/invite/accept', 'POST'))
    expect(location(res)).toBeNull()
  })

  it.each(['/onboarding', '/api/onboarding/practice', '/api/ops/onboarding'])('%s needs a signed-in user', async path => {
    const res = await middleware(req(path))
    expect(location(res)).toBe('/login')
  })
})

// ── clinic-app layout ────────────────────────────────────────
const redirectMock = jest.fn((url: string) => { throw new Error(`NEXT_REDIRECT:${url}`) })
jest.mock('next/navigation', () => ({ redirect: (url: string) => redirectMock(url) }))

let clinicRow: unknown = null
const layoutUser = { id: 'u1', email: 'x@clinic.test', app_metadata: { app_role: 'clinic_admin', clinic_id: '11111111-1111-4111-8111-111111111111' } }
let currentUser: unknown = layoutUser
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: currentUser } }) },
    from: () => {
      const q: Record<string, unknown> = {}
      q['select'] = () => q
      q['eq'] = () => q
      q['maybeSingle'] = async () => ({ data: clinicRow, error: null })
      return q
    },
  }),
}))
jest.mock('@/lib/env', () => ({ serverEnv: { idleTimeoutMinutes: () => 15, requireMfa: () => false, mfaEnforcedEmails: () => [] } }))
jest.mock('@/components/providers', () => ({ Providers: ({ children }: { children: unknown }) => children }))
jest.mock('@/components/sidebar-nav', () => ({ SidebarNav: () => null }))
jest.mock('@/components/main-content-offset', () => ({ MainContentOffset: ({ children }: { children: unknown }) => children }))
jest.mock('@/components/clinic-error-boundary', () => ({ ClinicErrorBoundary: ({ children }: { children: unknown }) => children }))
jest.mock('@/components/bfcache-guard', () => ({ BfcacheGuard: () => null }))
jest.mock('@/components/hipaa-timeout', () => ({ HipaaTimeout: () => null }))

import ClinicAppLayout from '../app/(clinic-app)/layout'

describe('clinic app: an unapproved clinic goes to onboarding', () => {
  beforeEach(() => { redirectMock.mockClear(); currentUser = layoutUser })

  it.each(['invited', 'in_progress', 'submitted', 'changes_requested'])('onboarding %s: redirected to /onboarding', async status => {
    clinicRow = { practice_dashboard_visible_to_providers: false, onboarding_status: status, is_active: false }
    await expect(ClinicAppLayout({ children: null })).rejects.toThrow('NEXT_REDIRECT:/onboarding')
  })

  it('a provider of an unapproved clinic is redirected too', async () => {
    currentUser = { ...layoutUser, app_metadata: { app_role: 'provider', clinic_id: layoutUser.app_metadata.clinic_id } }
    clinicRow = { practice_dashboard_visible_to_providers: false, onboarding_status: 'in_progress', is_active: false }
    await expect(ClinicAppLayout({ children: null })).rejects.toThrow('NEXT_REDIRECT:/onboarding')
  })

  it('an approved clinic renders the app', async () => {
    clinicRow = { practice_dashboard_visible_to_providers: false, onboarding_status: 'approved', is_active: true }
    await expect(ClinicAppLayout({ children: null })).resolves.toBeTruthy()
    expect(redirectMock).not.toHaveBeenCalled()
  })
})
