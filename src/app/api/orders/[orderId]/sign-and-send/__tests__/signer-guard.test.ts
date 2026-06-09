/**
 * @jest-environment node
 *
 * Regression test for the F-2 signer-identity guard on
 * POST /api/orders/[orderId]/sign-and-send.
 *
 * Audit finding F-2 (HIGH) in docs/audits/role-audit-and-data-model.md:
 * before this guard, ANY clinic-staff session with a matching clinic_id
 * could submit a signed prescription as any provider in the clinic — a
 * medical assistant could sign as Dr. Chen. This test locks the guard
 * in so a future refactor can't silently regress.
 *
 * Contract under test:
 *   - provider.user_id missing (un-linked)          → 403
 *   - provider.user_id !== session.user.id (other)  → 403
 *   - 401 / 403 / 400 paths still work first
 *
 * Full happy-path coverage (CAS transition, SMS dispatch, SLA
 * deadline creation) is out of scope — that flow has zero existing
 * unit-test coverage and adding it would balloon this PR.
 */

import { POST } from '../route'

// ── Helpers ────────────────────────────────────────────────────────

const TEST_ORDER_ID    = '11111111-1111-4111-9111-111111111111'
const TEST_CLINIC_ID   = '22222222-2222-4222-9222-222222222222'
const TEST_PROVIDER_ID = '33333333-3333-4333-9333-333333333333'
const PROVIDER_USER_ID = 'auth-uid-provider-correct'
const MA_USER_ID       = 'auth-uid-medical-assistant'

const VALID_SIG_DATA_URL = 'data:image/png;base64,' + 'A'.repeat(6000)

function makeParams() {
  return { params: Promise.resolve({ orderId: TEST_ORDER_ID }) }
}

function makeRequest(body: unknown): import('next/server').NextRequest {
  return {
    json: async () => body,
  } as unknown as import('next/server').NextRequest
}

// ── Mocks ──────────────────────────────────────────────────────────

const getSessionMock = jest.fn()
const orderFetchMock = jest.fn()
const providerFetchMock = jest.fn()
const pharmacyFetchMock = jest.fn()
const clinicFetchMock = jest.fn()
const licenseFetchMock = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockResolvedValue({
    auth: { getSession: () => getSessionMock() },
  }),
}))

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn().mockReturnValue({
    from: (table: string) => {
      if (table === 'orders') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  is: () => ({
                    maybeSingle: () => orderFetchMock(),
                  }),
                }),
              }),
            }),
          }),
        }
      }
      if (table === 'providers') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  is: () => ({
                    maybeSingle: () => providerFetchMock(),
                  }),
                }),
              }),
            }),
          }),
        }
      }
      if (table === 'pharmacies') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => pharmacyFetchMock(),
            }),
          }),
        }
      }
      if (table === 'clinics') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => clinicFetchMock(),
            }),
          }),
        }
      }
      if (table === 'pharmacy_state_licenses') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () => licenseFetchMock(),
                }),
              }),
            }),
          }),
        }
      }
      throw new Error(`Unexpected table in test: ${table}`)
    },
  }),
}))

// ── Setup ──────────────────────────────────────────────────────────

beforeEach(() => {
  getSessionMock.mockReset()
  orderFetchMock.mockReset()
  providerFetchMock.mockReset()
  pharmacyFetchMock.mockReset()
  clinicFetchMock.mockReset()
  licenseFetchMock.mockReset()
})

function mockClinicSession(userId: string, app_role: string = 'provider') {
  getSessionMock.mockResolvedValue({
    data: {
      session: {
        user: {
          id: userId,
          email: `${userId}@example.test`,
          user_metadata: { app_role, clinic_id: TEST_CLINIC_ID },
        },
      },
    },
  })
}

function mockDraftOrder() {
  orderFetchMock.mockResolvedValue({
    data: {
      order_id: TEST_ORDER_ID,
      status: 'DRAFT',
      clinic_id: TEST_CLINIC_ID,
      patient_id: 'patient-1',
      provider_id: TEST_PROVIDER_ID,
      catalog_item_id: null, // V3-formulation order — bypasses catalog lookup; dea_schedule comes from snapshot
      pharmacy_id: 'pharmacy-1',
      retail_price_snapshot: 100,
      wholesale_price_snapshot: 60,
      shipping_state_snapshot: 'TX',
      medication_snapshot: { dea_schedule: 0 },
      pharmacy_snapshot: { integration_tier: 'TIER_4_FAX' },
    },
    error: null,
  })
}

function mockProvider(user_id: string | null) {
  providerFetchMock.mockResolvedValue({
    data: {
      provider_id: TEST_PROVIDER_ID,
      npi_number: '1234567890',
      signature_hash: null,
      clinic_id: TEST_CLINIC_ID,
      user_id,
    },
    error: null,
  })
}

// ── Tests ──────────────────────────────────────────────────────────

describe('POST /api/orders/[orderId]/sign-and-send — F-2 signer-identity guard', () => {
  it('returns 401 when not authenticated, with no DB calls', async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } })

    const res = await POST(makeRequest({ signatureDataUrl: VALID_SIG_DATA_URL }), makeParams())
    expect(res.status).toBe(401)
    expect(orderFetchMock).not.toHaveBeenCalled()
    expect(providerFetchMock).not.toHaveBeenCalled()
  })

  it('returns 400 when clinic_id missing from session metadata', async () => {
    getSessionMock.mockResolvedValue({
      data: {
        session: {
          user: { id: 'u1', email: 'u1@e.t', user_metadata: { app_role: 'provider' } }, // no clinic_id
        },
      },
    })

    const res = await POST(makeRequest({ signatureDataUrl: VALID_SIG_DATA_URL }), makeParams())
    expect(res.status).toBe(400)
    expect(orderFetchMock).not.toHaveBeenCalled()
  })

  it('returns 403 when provider.user_id is NULL (provider not linked to auth)', async () => {
    mockClinicSession(PROVIDER_USER_ID, 'provider')
    mockDraftOrder()
    mockProvider(null) // un-linked provider
    pharmacyFetchMock.mockResolvedValue({ data: { pharmacy_id: 'pharmacy-1', integration_tier: 'TIER_4_FAX', is_active: true, pharmacy_status: 'ACTIVE', deleted_at: null }, error: null })
    clinicFetchMock.mockResolvedValue({ data: { stripe_connect_status: 'ACTIVE' }, error: null })
    licenseFetchMock.mockResolvedValue({ data: { pharmacy_id: 'pharmacy-1' }, error: null })

    const res = await POST(makeRequest({ signatureDataUrl: VALID_SIG_DATA_URL }), makeParams())
    expect(res.status).toBe(403)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/not linked to a Supabase Auth user/)
  })

  it('returns 403 when calling user is NOT the order provider (MA trying to sign as Dr. Chen)', async () => {
    mockClinicSession(MA_USER_ID, 'medical_assistant') // MA's auth uid
    mockDraftOrder()
    mockProvider(PROVIDER_USER_ID) // provider is Dr. Chen, NOT the MA
    pharmacyFetchMock.mockResolvedValue({ data: { pharmacy_id: 'pharmacy-1', integration_tier: 'TIER_4_FAX', is_active: true, pharmacy_status: 'ACTIVE', deleted_at: null }, error: null })
    clinicFetchMock.mockResolvedValue({ data: { stripe_connect_status: 'ACTIVE' }, error: null })
    licenseFetchMock.mockResolvedValue({ data: { pharmacy_id: 'pharmacy-1' }, error: null })

    const res = await POST(makeRequest({ signatureDataUrl: VALID_SIG_DATA_URL }), makeParams())
    expect(res.status).toBe(403)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/Only the assigned provider can sign/)
  })

  it('returns 400 when signature data is missing or invalid', async () => {
    mockClinicSession(PROVIDER_USER_ID, 'provider')

    // Empty body
    const res = await POST(makeRequest({ signatureDataUrl: '' }), makeParams())
    expect(res.status).toBe(400)
    // Should fail before any DB lookup
    expect(orderFetchMock).not.toHaveBeenCalled()
  })

  // ── Codex Section 4 followup: precedence ───────────────────────
  // Lock in that F-2 fires BEFORE the rest of the compliance lookups.
  // After the followup refactor, provider is fetched first and the
  // signer-identity guard runs before pharmacy/license/clinic lookups.
  // If F-2 didn't fire first, an MA-signs-as-Dr-Chen request with a
  // *separately* failing compliance check (e.g., bad NPI) could return
  // the compliance error instead of the security 403 — muddying the
  // audit trail and potentially leaking which compliance facts the
  // attacker probed.
  it('signer-mismatch precedence: 403 even when provider has a bad NPI that would also fail compliance', async () => {
    mockClinicSession(MA_USER_ID, 'medical_assistant')
    mockDraftOrder()
    // Provider's user_id is Dr. Chen (not the MA caller) AND the NPI
    // is malformed. Without F-2 precedence, the malformed NPI would
    // produce a 422 compliance error. With F-2 precedence (after the
    // refactor: provider fetched first, F-2 guard runs before
    // pharmacy/clinic/license), the 403 fires first.
    providerFetchMock.mockResolvedValue({
      data: {
        provider_id: TEST_PROVIDER_ID,
        npi_number: 'not-a-real-npi',  // would trigger 422 in npiValid check
        signature_hash: null,
        clinic_id: TEST_CLINIC_ID,
        user_id: PROVIDER_USER_ID,  // Dr. Chen, NOT the MA caller
      },
      error: null,
    })
    // Intentionally do NOT mock pharmacy/clinic/license. If F-2
    // precedence is broken, the route will call them and the test
    // will throw on the unexpected calls.

    const res = await POST(makeRequest({ signatureDataUrl: VALID_SIG_DATA_URL }), makeParams())
    expect(res.status).toBe(403)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/Only the assigned provider/)

    expect(pharmacyFetchMock).not.toHaveBeenCalled()
    expect(clinicFetchMock).not.toHaveBeenCalled()
    expect(licenseFetchMock).not.toHaveBeenCalled()
  })

  // Same precedence for the un-linked-provider case.
  it('unlinked-provider precedence: 403 fires before pharmacy/clinic/license lookups', async () => {
    mockClinicSession(PROVIDER_USER_ID, 'provider')
    mockDraftOrder()
    mockProvider(null) // un-linked provider

    const res = await POST(makeRequest({ signatureDataUrl: VALID_SIG_DATA_URL }), makeParams())
    expect(res.status).toBe(403)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/not linked to a Supabase Auth user/)

    expect(pharmacyFetchMock).not.toHaveBeenCalled()
    expect(clinicFetchMock).not.toHaveBeenCalled()
    expect(licenseFetchMock).not.toHaveBeenCalled()
  })

  // Verify the actor trace id (Codex Section 4 log-redaction follow-up)
  // is a short hash, never the raw session.user.id.
  it('logs an actor trace id (hash) instead of raw session.user.id on rejection', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    mockClinicSession(MA_USER_ID, 'medical_assistant')
    mockDraftOrder()
    mockProvider(PROVIDER_USER_ID)

    await POST(makeRequest({ signatureDataUrl: VALID_SIG_DATA_URL }), makeParams())

    const calls = warnSpy.mock.calls.map(args => String(args[0] ?? ''))
    const mismatch = calls.find(s => /signer\/provider mismatch/.test(s))
    expect(mismatch).toBeTruthy()
    // The raw MA UID must NOT appear in the log
    expect(mismatch).not.toContain(MA_USER_ID)
    // The actor trace prefix MUST appear
    expect(mismatch).toMatch(/actor=act_[a-f0-9]{12}/)

    warnSpy.mockRestore()
  })
})
