/**
 * @jest-environment node
 *
 * Regression test for the POC_MODE gate on /ops/demo-tools
 * (audit X-1, docs/audits/ops-dashboard-gap-list.md).
 *
 * The page renders plaintext POC credentials and a destructive
 * "Refresh Demo Data" button. It MUST NOT be reachable in any
 * non-POC deployment (e.g., once a real clinic is onboarded).
 *
 * Contract under test:
 *   - process.env.POC_MODE !== 'true'  → notFound() throws (404)
 *   - process.env.POC_MODE === 'true'  → component renders normally
 *
 * The check uses an exact string compare (no truthy coercion),
 * mirroring src/app/api/admin/refresh-demo-data/route.ts.
 */

import DemoToolsPage from '../page'

// ── Mocks ────────────────────────────────────────────────────

// next/navigation: capture notFound() invocations. The real
// implementation throws a special NEXT_NOT_FOUND error; our mock
// just throws a sentinel we can assert on.
const notFoundMock = jest.fn(() => {
  throw new Error('NEXT_NOT_FOUND')
})

jest.mock('next/navigation', () => ({
  notFound: () => notFoundMock(),
}))

// Stub the canonical-users module so the test doesn't need to
// import real POC passwords (and so the module is import-safe in
// the jest environment, with no Supabase client side effects).
jest.mock('@/lib/poc/canonical-users', () => ({
  POC_CANONICAL_USERS: [
    { label: 'ops_admin',    email: 'ops@example.com',     password: 'pw-ops' },
    { label: 'clinic_admin', email: 'admin@example.com',   password: 'pw-clinic' },
    { label: 'provider',     email: 'provider@example.com', password: 'pw-provider' },
    { label: 'ma',           email: 'ma@example.com',       password: 'pw-ma' },
  ],
}))

// Stub the client component children — we only care that the
// gate fires before anything renders, not that the cards work.
jest.mock('../_components/reset-credentials-card', () => ({
  ResetCredentialsCard: () => null,
}))

jest.mock('../_components/refresh-demo-data-card', () => ({
  RefreshDemoDataCard: () => null,
}))

// ── Helpers ──────────────────────────────────────────────────

const ORIGINAL_POC_MODE = process.env['POC_MODE']

beforeEach(() => {
  notFoundMock.mockClear()
})

afterAll(() => {
  if (ORIGINAL_POC_MODE === undefined) {
    delete process.env['POC_MODE']
  } else {
    process.env['POC_MODE'] = ORIGINAL_POC_MODE
  }
})

// ── Import-time smoke ────────────────────────────────────────
// The env check is request-time, not module-load-time. Importing
// the page must not throw regardless of POC_MODE state.

describe('/ops/demo-tools page module', () => {
  it('imports without throwing', () => {
    expect(typeof DemoToolsPage).toBe('function')
  })
})

// ── POC_MODE gate (audit X-1) ────────────────────────────────

describe('/ops/demo-tools — POC_MODE gate (audit X-1)', () => {
  it('calls notFound() when POC_MODE is unset', () => {
    delete process.env['POC_MODE']
    expect(() => DemoToolsPage()).toThrow('NEXT_NOT_FOUND')
    expect(notFoundMock).toHaveBeenCalledTimes(1)
  })

  it('calls notFound() when POC_MODE is empty string', () => {
    process.env['POC_MODE'] = ''
    expect(() => DemoToolsPage()).toThrow('NEXT_NOT_FOUND')
    expect(notFoundMock).toHaveBeenCalledTimes(1)
  })

  it('calls notFound() when POC_MODE is "false"', () => {
    process.env['POC_MODE'] = 'false'
    expect(() => DemoToolsPage()).toThrow('NEXT_NOT_FOUND')
    expect(notFoundMock).toHaveBeenCalledTimes(1)
  })

  it('calls notFound() when POC_MODE is "1" (no truthy coercion)', () => {
    // Guards against a future refactor that loosens the check to
    // a truthy compare. The route handler uses an exact string
    // compare; this page must too.
    process.env['POC_MODE'] = '1'
    expect(() => DemoToolsPage()).toThrow('NEXT_NOT_FOUND')
    expect(notFoundMock).toHaveBeenCalledTimes(1)
  })

  it('calls notFound() when POC_MODE is "TRUE" (case-sensitive)', () => {
    process.env['POC_MODE'] = 'TRUE'
    expect(() => DemoToolsPage()).toThrow('NEXT_NOT_FOUND')
    expect(notFoundMock).toHaveBeenCalledTimes(1)
  })

  it('renders normally when POC_MODE === "true"', () => {
    process.env['POC_MODE'] = 'true'
    expect(() => DemoToolsPage()).not.toThrow()
    expect(notFoundMock).not.toHaveBeenCalled()
  })
})
