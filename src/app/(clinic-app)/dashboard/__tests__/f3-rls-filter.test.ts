/**
 * @jest-environment node
 *
 * F-3 (audit role-audit-and-data-model.md §F-3): role-aware dashboard
 * RLS filter on `orders`. The DB-level policy enforcement is exercised
 * by integration smoke against a Supabase test project — we don't have
 * a pg_tap runner in this repo. This Jest test locks in the two things
 * that, if they regress, would silently defeat the policy at the
 * application tier:
 *
 *   1. The SSR dashboard query goes through the session-scoped client
 *      (createServerClient) — NOT the service-role client, which would
 *      bypass RLS. A regression to createServiceClient here would make
 *      the policy invisible on first paint.
 *
 *   2. The migration file itself encodes the four-role visibility
 *      matrix from the audit:
 *        - ops_admin: cross-clinic SELECT
 *        - clinic_admin / medical_assistant: per-clinic SELECT
 *        - provider: per-clinic SELECT, only their own orders (matched
 *          via providers.user_id = auth.uid())
 *      …plus cross-clinic isolation is absolute (the provider-branch
 *      EXISTS clause checks the providers row's clinic_id AGAINST the
 *      JWT clinic_id, not just the auth.uid match).
 *
 * Full RLS verification happens during deploy:
 *   supabase db push staging
 *   psql staging -c "set role authenticated; … select … from orders …"
 * with each role's JWT pasted in. See the F-3 resolution memo at the
 * bottom of docs/audits/role-audit-and-data-model.md.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ── 1. SSR uses the session client (not service-role) ──────────────

const fromSpy = jest.fn()
const getSessionMock = jest.fn()

jest.mock('next/navigation', () => ({
  redirect: (_url: string) => { throw new Error('REDIRECT') },
}))

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockResolvedValue({
    auth: { getSession: () => getSessionMock() },
    from: (...args: unknown[]) => fromSpy(...args),
  }),
}))

// If the dashboard imports the service client, that's a regression.
// We mock it to a thrower so any usage explodes loudly in the test.
const serviceClientShouldNeverBeCalled = jest.fn(() => {
  throw new Error(
    'createServiceClient() was called from the dashboard SSR — ' +
    'F-3 regression. The dashboard must use createServerClient() so ' +
    'the role-aware RLS policy on `orders` is honored.',
  )
})
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: serviceClientShouldNeverBeCalled,
}))

beforeEach(() => {
  fromSpy.mockReset()
  getSessionMock.mockReset()
  serviceClientShouldNeverBeCalled.mockClear()
})

describe('F-3 SSR client wiring', () => {
  it('dashboard page uses session-scoped client, not service-role', async () => {
    // Arrange: a clinic_admin session, supabase.from() returns a chain
    // that yields empty results so the page can render.
    getSessionMock.mockResolvedValue({
      data: {
        session: {
          user: {
            id: 'auth-uid-clinic-admin',
            user_metadata: {
              clinic_id: 'a1000000-0000-0000-0000-000000000001',
              app_role:  'clinic_admin',
            },
          },
        },
      },
    })

    // Chainable stub mirroring the supabase-js query builder shape.
    const chain: Record<string, jest.Mock> = {}
    const yieldEmpty = { data: [], error: null }
    const yieldClinic = { data: { stripe_connect_status: 'ACTIVE' }, error: null }
    chain['select']      = jest.fn().mockReturnValue(chain)
    chain['eq']          = jest.fn().mockReturnValue(chain)
    chain['is']          = jest.fn().mockReturnValue(chain)
    chain['gte']         = jest.fn().mockReturnValue(chain)
    chain['lt']          = jest.fn().mockReturnValue(chain)
    chain['order']       = jest.fn().mockResolvedValue(yieldEmpty)
    chain['maybeSingle'] = jest.fn().mockResolvedValue(yieldClinic)

    fromSpy.mockReturnValue(chain)

    // Act: render the server component.
    // (Dynamic import so the mocks are in place before the module loads.)
    const mod = await import('../page')
    await mod.default()

    // Assert: the dashboard pulled from `orders` and `clinics` via the
    // session client (fromSpy was called) and NEVER reached for the
    // service-role client.
    expect(serviceClientShouldNeverBeCalled).not.toHaveBeenCalled()
    const tables = fromSpy.mock.calls.map(c => c[0] as string)
    expect(tables).toEqual(expect.arrayContaining(['orders', 'clinics']))
  })
})

// ── 2. Migration content encodes the visibility matrix ─────────────

describe('F-3 migration: 20260611000004_f3_dashboard_rls_filter.sql', () => {
  const migrationPath = join(
    process.cwd(),
    'supabase',
    'migrations',
    '20260611000004_f3_dashboard_rls_filter.sql',
  )
  const sql = readFileSync(migrationPath, 'utf8')

  it('is idempotent — drops the old + new policy before creating', () => {
    expect(sql).toMatch(/DROP POLICY IF EXISTS orders_clinic_user_select ON orders;/)
    expect(sql).toMatch(/DROP POLICY IF EXISTS orders_role_aware_select\s+ON orders;/)
    expect(sql).toMatch(/CREATE POLICY orders_role_aware_select ON orders/)
  })

  it('grants ops_admin cross-clinic SELECT', () => {
    expect(sql).toMatch(/'app_role'\)\s*=\s*'ops_admin'/)
  })

  it('grants clinic_admin and medical_assistant per-clinic SELECT', () => {
    // Both roles named explicitly in an IN(...) clause.
    expect(sql).toMatch(
      /IN\s*\(\s*'clinic_admin'\s*,\s*'medical_assistant'\s*\)/,
    )
    // And paired with a clinic_id check.
    expect(sql).toMatch(
      /clinic_id\s*=\s*\(auth\.jwt\(\)\s*->\s*'user_metadata'\s*->>\s*'clinic_id'\)::UUID/,
    )
  })

  it('restricts provider role to their own orders via providers.user_id link', () => {
    // The provider branch must:
    //   - check app_role = 'provider'
    //   - filter by clinic_id (cross-clinic isolation)
    //   - EXISTS providers WHERE provider_id matches orders.provider_id
    //     AND user_id = auth.uid()
    //     AND clinic_id matches the JWT clinic_id (defence-in-depth)
    expect(sql).toMatch(/'app_role'\)\s*=\s*'provider'/)
    expect(sql).toMatch(/EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+providers\s+p/i)
    expect(sql).toMatch(/p\.provider_id\s*=\s*orders\.provider_id/)
    expect(sql).toMatch(/p\.user_id\s*=\s*auth\.uid\(\)/)
    // Cross-clinic isolation: the providers row's clinic must also
    // match the JWT — even if a stale link existed across clinics, the
    // policy refuses to honor it.
    expect(sql).toMatch(/p\.clinic_id\s*=\s*\(auth\.jwt\(\)\s*->\s*'user_metadata'\s*->>\s*'clinic_id'\)::UUID/)
    expect(sql).toMatch(/p\.deleted_at\s+IS\s+NULL/)
  })

  it('uses the user_metadata JWT path convention (not top-level claims)', () => {
    // Existing convention from 20260329000001 / 20260329000002.
    // Top-level auth.jwt() ->> 'clinic_id' would return NULL for our
    // browser sessions and silently lock everyone out.
    expect(sql).not.toMatch(/auth\.jwt\(\)\s*->>\s*'clinic_id'/)
    expect(sql).not.toMatch(/auth\.jwt\(\)\s*->>\s*'app_role'/)
  })

  it('replaces the SELECT policy only — INSERT/UPDATE untouched', () => {
    // F-3 is read-side. Write-side is owned by F-2 (signer identity)
    // plus the existing clinic_id check on INSERT/UPDATE policies.
    expect(sql).not.toMatch(/CREATE POLICY orders_clinic_user_insert/)
    expect(sql).not.toMatch(/CREATE POLICY orders_clinic_user_update/)
    expect(sql).not.toMatch(/FOR\s+(INSERT|UPDATE|DELETE)/i)
  })
})
