/**
 * @jest-environment node
 *
 * F-3 follow-up (audit role-audit-and-data-model.md §F-3): provider
 * opt-in clinic view toggle.
 *
 * The follow-up adds a second, ADDITIVE SELECT policy on `orders` that
 * a provider can activate per-request by sending the header
 *   x-provider-view-mode: clinic
 * The base F-3 policy (migration 20260611000004) is unchanged.
 *
 * What this Jest suite locks in:
 *
 *   1. Migration 20260614000003 includes the second policy and gates
 *      it on the per-request header via current_setting('request.headers').
 *   2. The migration NEVER weakens cross-clinic isolation — the new
 *      policy still scopes by JWT clinic_id.
 *   3. The dashboard SSR forwards `x-provider-view-mode: clinic` to the
 *      Supabase client when `?view=clinic` is on the URL AND the
 *      session is a provider — and NOT otherwise.
 *
 * The full RLS verification (does the policy actually broaden visibility
 * in Supabase?) happens at deploy time against staging.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ── 1. Migration content ───────────────────────────────────────────

describe('F-3 follow-up migration: 20260614000003_f3_provider_clinic_view_opt_in.sql', () => {
  const migrationPath = join(
    process.cwd(),
    'supabase',
    'migrations',
    '20260614000003_f3_provider_clinic_view_opt_in.sql',
  )
  const sql = readFileSync(migrationPath, 'utf8')

  it('is idempotent — drops the policy before creating', () => {
    expect(sql).toMatch(
      /DROP POLICY IF EXISTS orders_provider_clinic_optin_select ON orders;/,
    )
    expect(sql).toMatch(
      /CREATE POLICY orders_provider_clinic_optin_select ON orders/,
    )
  })

  it('is an additive SELECT policy — no DROP or CREATE of the base F-3 policy', () => {
    // Migration 20260611000004 owns orders_role_aware_select. This
    // follow-up MUST NOT touch it; doing so would risk losing the
    // four-role visibility matrix on a partial replay. Comments are
    // free to reference the policy by name — only DDL is forbidden.
    expect(sql).not.toMatch(/DROP\s+POLICY[^;]*orders_role_aware_select/i)
    expect(sql).not.toMatch(/CREATE\s+POLICY\s+orders_role_aware_select/i)
    expect(sql).not.toMatch(/ALTER\s+POLICY\s+orders_role_aware_select/i)
    expect(sql).not.toMatch(/DROP\s+POLICY[^;]*orders_clinic_user_select/i)
    expect(sql).not.toMatch(/CREATE\s+POLICY\s+orders_clinic_user_select/i)
  })

  it('grants SELECT (not INSERT / UPDATE / DELETE)', () => {
    expect(sql).toMatch(/FOR SELECT TO authenticated/)
    expect(sql).not.toMatch(/FOR\s+(INSERT|UPDATE|DELETE)/i)
  })

  it('is gated on the provider role', () => {
    expect(sql).toMatch(
      /\(auth\.jwt\(\)\s*->\s*'user_metadata'\s*->>\s*'app_role'\)\s*=\s*'provider'/,
    )
  })

  it('reads the per-request header via current_setting(request.headers)', () => {
    // The exact idiom: current_setting('request.headers', true) returns
    // a JSON string when set by PostgREST. nullif handles the empty case.
    expect(sql).toMatch(/current_setting\(\s*'request\.headers'\s*,\s*true\s*\)/)
    expect(sql).toMatch(/->>\s*'x-provider-view-mode'/)
    expect(sql).toMatch(/=\s*'clinic'/)
  })

  it('preserves absolute cross-clinic isolation — JWT clinic_id check', () => {
    // The new policy MUST still scope to the provider's clinic. A
    // provider opting into clinic view sees ALL of THEIR clinic — never
    // another clinic's.
    expect(sql).toMatch(
      /clinic_id\s*=\s*\(auth\.jwt\(\)\s*->\s*'user_metadata'\s*->>\s*'clinic_id'\)::UUID/,
    )
  })

  it('uses the user_metadata JWT path convention (not top-level claims)', () => {
    // Same convention as 20260329000001 / 20260329000002 /
    // 20260611000004. Top-level auth.jwt() ->> 'clinic_id' silently
    // returns NULL for browser sessions.
    expect(sql).not.toMatch(/auth\.jwt\(\)\s*->>\s*'clinic_id'/)
    expect(sql).not.toMatch(/auth\.jwt\(\)\s*->>\s*'app_role'/)
  })
})

// ── 2. SSR header forwarding ──────────────────────────────────────

const fromSpy = jest.fn()
const getSessionMock = jest.fn()
const createServerClientMock = jest.fn()

jest.mock('next/navigation', () => ({
  redirect: (_url: string) => { throw new Error('REDIRECT') },
}))

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: (...args: unknown[]) => createServerClientMock(...args),
}))

// Defence against accidental service-role usage — same as the base
// F-3 test. If the page ever reaches for createServiceClient it's a
// regression.
const serviceClientShouldNeverBeCalled = jest.fn(() => {
  throw new Error('createServiceClient() must not be called from the dashboard SSR.')
})
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: serviceClientShouldNeverBeCalled,
}))

function makeChain() {
  const yieldEmpty  = { data: [], error: null }
  const yieldClinic = { data: { stripe_connect_status: 'ACTIVE' }, error: null }
  const chain: Record<string, jest.Mock> = {}
  chain['select']      = jest.fn().mockReturnValue(chain)
  chain['eq']          = jest.fn().mockReturnValue(chain)
  chain['is']          = jest.fn().mockReturnValue(chain)
  chain['gte']         = jest.fn().mockReturnValue(chain)
  chain['lt']          = jest.fn().mockReturnValue(chain)
  chain['order']       = jest.fn().mockResolvedValue(yieldEmpty)
  chain['maybeSingle'] = jest.fn().mockResolvedValue(yieldClinic)
  return chain
}

function makeSupabaseStub() {
  return {
    auth: { getSession: () => getSessionMock() },
    from: (...args: unknown[]) => fromSpy(...args),
  }
}

beforeEach(() => {
  fromSpy.mockReset()
  getSessionMock.mockReset()
  createServerClientMock.mockReset()
  serviceClientShouldNeverBeCalled.mockClear()

  // Default chain — each call to createServerClient returns its own
  // stub so we can assert how many distinct clients were minted.
  fromSpy.mockImplementation(() => makeChain())
  createServerClientMock.mockImplementation(() =>
    Promise.resolve(makeSupabaseStub()),
  )
})

describe('F-3 follow-up SSR: ?view=clinic forwards the opt-in header', () => {
  it('provider session + ?view=clinic mints a second client with x-provider-view-mode header', async () => {
    getSessionMock.mockResolvedValue({
      data: {
        session: {
          user: {
            id: 'auth-uid-provider',
            user_metadata: {
              clinic_id: 'a1000000-0000-0000-0000-000000000001',
              app_role:  'provider',
            },
          },
        },
      },
    })

    const mod = await import('../page')
    await mod.default({
      searchParams: Promise.resolve({ view: 'clinic' }),
    })

    // First call: bare client used for getSession() (no extraHeaders).
    // Second call: opt-in client with the x-provider-view-mode header.
    expect(createServerClientMock.mock.calls.length).toBeGreaterThanOrEqual(2)
    const firstArgs  = createServerClientMock.mock.calls[0]?.[0]
    const secondArgs = createServerClientMock.mock.calls[1]?.[0]
    expect(firstArgs).toBeUndefined()
    expect(secondArgs).toEqual({
      extraHeaders: { 'x-provider-view-mode': 'clinic' },
    })

    expect(serviceClientShouldNeverBeCalled).not.toHaveBeenCalled()
  })

  it('provider session WITHOUT ?view=clinic does NOT send the header', async () => {
    getSessionMock.mockResolvedValue({
      data: {
        session: {
          user: {
            id: 'auth-uid-provider',
            user_metadata: {
              clinic_id: 'a1000000-0000-0000-0000-000000000001',
              app_role:  'provider',
            },
          },
        },
      },
    })

    const mod = await import('../page')
    await mod.default({ searchParams: Promise.resolve({}) })

    // Only the bare client should be created — no opt-in client.
    const optInCall = createServerClientMock.mock.calls.find(
      (call) => {
        const arg = call[0] as { extraHeaders?: Record<string, string> } | undefined
        return arg?.extraHeaders?.['x-provider-view-mode'] === 'clinic'
      },
    )
    expect(optInCall).toBeUndefined()
  })

  it('non-provider session with ?view=clinic does NOT forward the header (URL param is a no-op)', async () => {
    // A clinic_admin / MA / ops_admin already sees their own scope and
    // doesn't need the opt-in. Silently ignoring the query string on
    // those roles avoids creating a privilege confusion if a URL is
    // shared. (The RLS policy itself also requires app_role='provider'
    // — this is defence-in-depth at the app tier.)
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

    const mod = await import('../page')
    await mod.default({ searchParams: Promise.resolve({ view: 'clinic' }) })

    const optInCall = createServerClientMock.mock.calls.find(
      (call) => {
        const arg = call[0] as { extraHeaders?: Record<string, string> } | undefined
        return arg?.extraHeaders?.['x-provider-view-mode'] === 'clinic'
      },
    )
    expect(optInCall).toBeUndefined()
  })
})
