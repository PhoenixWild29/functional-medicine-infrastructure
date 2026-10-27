/**
 * @jest-environment node
 *
 * Clinic onboarding routing:
 *   - middleware: the invite links (/onboard/clinic/<token>,
 *     /onboard/join/<token>) and the accept API are reachable signed out
 *     (the token is the credential); the wizard (/onboarding) and its APIs
 *     are not, and /onboarding is not mistaken for /onboard/
 *   - self sign-up, pending review: the clinic app no longer holds an
 *     unapproved clinic on /onboarding. Everyone can look around, under a
 *     banner that links to the remaining setup steps; writes are refused
 *     on the server (lib/onboarding/approval-guard). (Updated: this used
 *     to assert the redirect to /onboarding.)
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

  // Self sign-up: /get-started and its API are public (a visitor has no
  // account yet). Nothing else is opened by the prefix.
  // Security B12: POST /api/sign-in (the login page signs in through the server).
  it.each([['/get-started', 'GET'], ['/api/signup', 'POST'], ['/api/sign-in', 'POST']])('%s is reachable signed out', async (path, method) => {
    const res = await middleware(req(path, method))
    expect(location(res)).toBeNull()
  })

  it.each(['/get-started-admin', '/api/signup-admin', '/api/signups', '/api/sign-in/x', '/api/sign-ins'])('%s is not opened by the prefix', async path => {
    expect(location(await middleware(req(path)))).toBe('/login')
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
jest.mock('@/components/pending-review-banner', () => ({ PendingReviewBanner: function PendingReviewBanner() { return null } }))

// The rendered tree, searched for the banner by component name.
function hasBanner(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false
  if (Array.isArray(node)) return node.some(hasBanner)
  const el = node as { type?: unknown; props?: { children?: unknown } }
  if (typeof el.type === 'function' && (el.type as { name?: string }).name === 'PendingReviewBanner') return true
  return hasBanner(el.props?.children)
}

import ClinicAppLayout from '../app/(clinic-app)/layout'

describe('clinic app: pending review (an unapproved clinic looks around under a banner)', () => {
  beforeEach(() => { redirectMock.mockClear(); currentUser = layoutUser })

  it.each(['invited', 'in_progress', 'submitted', 'changes_requested'])('onboarding %s: the app renders, with the banner, no redirect', async status => {
    clinicRow = { practice_dashboard_visible_to_providers: false, onboarding_status: status, is_active: false }
    const tree = await ClinicAppLayout({ children: null })
    expect(redirectMock).not.toHaveBeenCalled()
    expect(hasBanner(tree)).toBe(true)
  })

  it('a provider of an unapproved clinic sees the banner too', async () => {
    currentUser = { ...layoutUser, app_metadata: { app_role: 'provider', clinic_id: layoutUser.app_metadata.clinic_id } }
    clinicRow = { practice_dashboard_visible_to_providers: false, onboarding_status: 'in_progress', is_active: false }
    expect(hasBanner(await ClinicAppLayout({ children: null }))).toBe(true)
    expect(redirectMock).not.toHaveBeenCalled()
  })

  it('approved but switched off: the banner (writes are refused the same way)', async () => {
    clinicRow = { practice_dashboard_visible_to_providers: false, onboarding_status: 'approved', is_active: false }
    expect(hasBanner(await ClinicAppLayout({ children: null }))).toBe(true)
  })

  it('an approved clinic renders the app with no banner', async () => {
    clinicRow = { practice_dashboard_visible_to_providers: false, onboarding_status: 'approved', is_active: true }
    const tree = await ClinicAppLayout({ children: null })
    expect(redirectMock).not.toHaveBeenCalled()
    expect(hasBanner(tree)).toBe(false)
  })
})
