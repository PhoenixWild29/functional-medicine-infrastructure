/**
 * @jest-environment node
 *
 * Tests for POST /api/providers — the production-grade replacement
 * for the seed-script's linkProviderToAuthUser() convention.
 *
 * Critical paths under test:
 *   - Role gating: only clinic_admin (own clinic) + ops_admin (any clinic)
 *   - Cross-tenancy: clinic_admin cannot plant a provider in another clinic
 *   - Input validation: email, NPI 10 digits, valid US state
 *   - Pre-checks: duplicate NPI → 409
 *   - B10 (technical-safeguards-evidence-2026-10-25.md): no admin-chosen
 *     password. The route makes the provider record and a provider invite
 *     (the Team invite flow); the provider sets their own password from
 *     the one-time link, which links their login. No auth user is created
 *     here, and a password in the body is refused.
 */

import { POST } from '../route'
import { userFromSession, withForgedSession } from '@/__tests__/helpers/auth-from-session'

// ── Helpers ────────────────────────────────────────────────────────

const TEST_CLINIC_ID       = 'aaaaaaaa-aaaa-4aaa-9aaa-aaaaaaaaaaaa'
const OTHER_CLINIC_ID      = 'bbbbbbbb-bbbb-4bbb-9bbb-bbbbbbbbbbbb'
const NEW_PROVIDER_USER_ID = 'new-auth-user-id-1234'

function makeRequest(body: unknown): import('next/server').NextRequest {
  return {
    json: async () => body,
  } as unknown as import('next/server').NextRequest
}

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    email:         'new.provider@clinic.test',
    firstName:     'Test',
    lastName:      'Provider',
    npiNumber:     '1987654328',
    licenseState:  'TX',
    licenseNumber: 'TX-MD-9999',
    deaNumber:     null,
    ...overrides,
  }
}

// ── Mocks ──────────────────────────────────────────────────────────

const getSessionMock     = jest.fn()
const npiCheckMock       = jest.fn()
const clinicCheckMock    = jest.fn()
const createUserMock     = jest.fn()
const providerInsertMock = jest.fn()
const deleteUserMock     = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockResolvedValue({
    auth: { getSession: () => getSessionMock(), getUser: () => userFromSession(getSessionMock()) },
  }),
}))

// Compliance C4: the NPPES check after the save is mocked (no network).
const runNpiCheckMock = jest.fn()
jest.mock('@/lib/providers/verify-npi', () => ({ runNpiCheck: (...a: unknown[]) => runNpiCheckMock(...a) }))

// B10: the provider invite (the Team invite flow) is mocked.
const createInviteMock = jest.fn()
jest.mock('@/lib/onboarding/invite-actions', () => ({ createInvite: (...a: unknown[]) => createInviteMock(...a) }))

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn().mockReturnValue({
    from: (table: string) => {
      if (table === 'providers') {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                maybeSingle: () => npiCheckMock(),
              }),
            }),
          }),
          insert: () => ({
            select: () => ({
              single: () => providerInsertMock(),
            }),
          }),
        }
      }
      if (table === 'clinics') {
        // Codex post-review sweep: providers route now verifies clinic exists.
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                maybeSingle: () => clinicCheckMock(),
              }),
            }),
          }),
        }
      }
      throw new Error(`Unexpected table in test: ${table}`)
    },
    auth: {
      admin: {
        createUser: (...args: unknown[]) => createUserMock(...args),
        deleteUser: (...args: unknown[]) => deleteUserMock(...args),
      },
    },
  }),
}))

beforeEach(() => {
  getSessionMock.mockReset()
  runNpiCheckMock.mockReset().mockResolvedValue({ ok: true, lookup: { status: 'verified' }, checkedAt: '2026-10-08T00:00:00Z' })
  npiCheckMock.mockReset()
  clinicCheckMock.mockReset()
  createUserMock.mockReset()
  providerInsertMock.mockReset()
  deleteUserMock.mockReset()
  createInviteMock.mockReset().mockResolvedValue({ ok: true, inviteId: 'invite-1', link: 'https://app.test/onboard/join/tok', expiresAt: '2026-11-01T00:00:00Z' })

  // Default happy-path mock state — individual tests override
  npiCheckMock.mockResolvedValue({ data: null, error: null })
  clinicCheckMock.mockResolvedValue({ data: { clinic_id: TEST_CLINIC_ID, is_active: true }, error: null })
  createUserMock.mockResolvedValue({ data: { user: { id: NEW_PROVIDER_USER_ID } }, error: null })
  providerInsertMock.mockResolvedValue({
    data: {
      provider_id:    'provider-uuid-new',
      user_id:        null,
      clinic_id:      TEST_CLINIC_ID,
      first_name:     'Test',
      last_name:      'Provider',
      npi_number:     '1987654328',
      license_state:  'TX',
      license_number: 'TX-MD-9999',
      dea_number:     null,
    },
    error: null,
  })
})

function mockSession(role: string | undefined, clinicId?: string) {
  getSessionMock.mockResolvedValue({
    data: {
      session: {
        user: {
          id: 'caller-uid',
          email: 'caller@e.test',
          app_metadata: {
            ...(role        ? { app_role:  role        } : {}),
            ...(clinicId    ? { clinic_id: clinicId    } : {}),
          },
        },
      },
    },
  })
}

// ── Auth + role gating ─────────────────────────────────────────────

describe('POST /api/providers — auth gating', () => {
  it('returns 401 when not authenticated', async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } })

    const res = await POST(makeRequest(validBody()))
    expect(res.status).toBe(401)
    expect(npiCheckMock).not.toHaveBeenCalled()
    expect(createUserMock).not.toHaveBeenCalled()
  })

  it('returns 403 for a provider session (cannot self-create)', async () => {
    mockSession('provider', TEST_CLINIC_ID)

    const res = await POST(makeRequest(validBody()))
    expect(res.status).toBe(403)
    expect(createUserMock).not.toHaveBeenCalled()
  })

  it('returns 403 for a medical_assistant session', async () => {
    mockSession('medical_assistant', TEST_CLINIC_ID)

    const res = await POST(makeRequest(validBody()))
    expect(res.status).toBe(403)
    expect(createUserMock).not.toHaveBeenCalled()
  })
})

// ── Input validation ───────────────────────────────────────────────

describe('POST /api/providers — input validation', () => {
  beforeEach(() => mockSession('clinic_admin', TEST_CLINIC_ID))

  it('returns 400 for invalid JSON body', async () => {
    const badRequest = {
      json: async () => { throw new Error('bad json') },
    } as unknown as import('next/server').NextRequest

    const res = await POST(badRequest)
    expect(res.status).toBe(400)
  })

  it('returns 400 when NPI is not 10 digits', async () => {
    const res = await POST(makeRequest(validBody({ npiNumber: '12345' })))
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string; details: string[] }
    expect(body.details).toEqual(expect.arrayContaining([expect.stringMatching(/npiNumber/)]))
    expect(createUserMock).not.toHaveBeenCalled()
  })

  it('returns 400 for invalid licenseState', async () => {
    const res = await POST(makeRequest(validBody({ licenseState: 'ZZ' })))
    expect(res.status).toBe(400)
    expect(createUserMock).not.toHaveBeenCalled()
  })

  it('B10: a password in the body is refused; the provider sets their own from the invite', async () => {
    const res = await POST(makeRequest(validBody({ password: 'a-strong-password-123' })))
    expect(res.status).toBe(400)
    const body = await res.json() as { details: string[] }
    expect(body.details).toEqual(expect.arrayContaining(['password is not accepted: the provider sets their own password from the invite link']))
    expect(providerInsertMock).not.toHaveBeenCalled()
    expect(createUserMock).not.toHaveBeenCalled()
  })
})

// ── Cross-tenancy enforcement ──────────────────────────────────────

describe('POST /api/providers — cross-tenancy enforcement', () => {
  it('rejects clinic_admin trying to create a provider in a different clinic', async () => {
    mockSession('clinic_admin', TEST_CLINIC_ID)

    const res = await POST(makeRequest(validBody({ clinicId: OTHER_CLINIC_ID })))
    expect(res.status).toBe(403)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/own clinic/)
    expect(createUserMock).not.toHaveBeenCalled()
  })

  it('returns 400 if clinic_admin session has no clinic_id', async () => {
    mockSession('clinic_admin') // no clinic_id

    const res = await POST(makeRequest(validBody()))
    expect(res.status).toBe(400)
    expect(createUserMock).not.toHaveBeenCalled()
  })

  it('returns 400 if ops_admin omits clinicId from body', async () => {
    mockSession('ops_admin')

    const res = await POST(makeRequest(validBody()))
    expect(res.status).toBe(400)
    expect(createUserMock).not.toHaveBeenCalled()
  })

  it('returns 400 if ops_admin provides a malformed clinicId', async () => {
    mockSession('ops_admin')

    const res = await POST(makeRequest(validBody({ clinicId: 'not-a-uuid' })))
    expect(res.status).toBe(400)
    expect(createUserMock).not.toHaveBeenCalled()
  })
})

// ── Pre-checks + collisions ────────────────────────────────────────

describe('POST /api/providers — collision handling', () => {
  beforeEach(() => mockSession('clinic_admin', TEST_CLINIC_ID))

  it('returns 409 when the NPI is already registered', async () => {
    npiCheckMock.mockResolvedValue({ data: { provider_id: 'existing-provider' }, error: null })

    const res = await POST(makeRequest(validBody()))
    expect(res.status).toBe(409)
    expect(createUserMock).not.toHaveBeenCalled()
  })

})

// ── Atomicity rollback ─────────────────────────────────────────────

describe('POST /api/providers — providers.insert failure', () => {
  beforeEach(() => mockSession('clinic_admin', TEST_CLINIC_ID))

  it('is a 500 with no invite made and no login to roll back', async () => {
    providerInsertMock.mockResolvedValue({
      data: null,
      error: { message: 'simulated DB error' },
    })

    const res = await POST(makeRequest(validBody()))
    expect(res.status).toBe(500)
    expect(createInviteMock).not.toHaveBeenCalled()
    expect(createUserMock).not.toHaveBeenCalled()
    expect(deleteUserMock).not.toHaveBeenCalled()
  })

  it('a failed invite still saves the provider: 201 and an instruction to resend', async () => {
    createInviteMock.mockResolvedValue({ ok: false, error: 'The invite could not be created. Try again.' })
    const res = await POST(makeRequest(validBody()))
    expect(res.status).toBe(201)
    const body = await res.json() as { providerId: string; inviteLink: string | null; error: string }
    expect(body.providerId).toBe('provider-uuid-new')
    expect(body.inviteLink).toBeNull()
    expect(body.error).toBe('The provider was added, but their invite could not be created. Resend it from Settings, Team, Pending invites.')
  })
})

// ── Happy path ─────────────────────────────────────────────────────

describe('POST /api/providers — happy path', () => {
  it('creates the provider row and a provider invite for clinic_admin in own clinic; no login, no password', async () => {
    mockSession('clinic_admin', TEST_CLINIC_ID)

    const res = await POST(makeRequest(validBody()))
    expect(res.status).toBe(201)

    const body = await res.json() as {
      providerId: string; userId: string | null; clinicId: string
      firstName: string; lastName: string; npiNumber: string
      inviteLink: string; inviteExpiresAt: string
    }
    expect(body.providerId).toBe('provider-uuid-new')
    expect(body.userId).toBeNull()
    expect(body.clinicId).toBe(TEST_CLINIC_ID)
    expect(body.firstName).toBe('Test')
    expect(body.lastName).toBe('Provider')
    // The one-time link the admin copies; the provider sets their own password there.
    expect(body.inviteLink).toBe('https://app.test/onboard/join/tok')
    expect(body.inviteExpiresAt).toBe('2026-11-01T00:00:00Z')

    expect(createInviteMock).toHaveBeenCalledWith(expect.anything(), {
      kind: 'provider', clinicId: TEST_CLINIC_ID, email: 'new.provider@clinic.test',
      providerId: 'provider-uuid-new', createdBy: 'caller-uid', actorRole: 'clinic_admin',
    })
    // B10: no auth user is created with an admin-known password.
    expect(createUserMock).not.toHaveBeenCalled()
    expect(deleteUserMock).not.toHaveBeenCalled()
  })

  it('creates provider in the explicitly-specified clinicId when caller is ops_admin', async () => {
    mockSession('ops_admin')
    // ops_admin's "target" provider is created in OTHER_CLINIC_ID (cross-clinic privilege)
    providerInsertMock.mockResolvedValue({
      data: {
        provider_id:    'provider-uuid-new',
        user_id:        NEW_PROVIDER_USER_ID,
        clinic_id:      OTHER_CLINIC_ID,
        first_name:     'Test',
        last_name:      'Provider',
        npi_number:     '1987654328',
        license_state:  'TX',
        license_number: 'TX-MD-9999',
        dea_number:     null,
      },
      error: null,
    })

    const res = await POST(makeRequest(validBody({ clinicId: OTHER_CLINIC_ID })))
    expect(res.status).toBe(201)
    expect(createInviteMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      kind: 'provider', clinicId: OTHER_CLINIC_ID, actorRole: 'ops_admin',
    }))
    expect(createUserMock).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────
// Codex post-review sweep — clinic existence pre-check
// Fails fast (no auth user created) when targetClinicId doesn't resolve.
// ─────────────────────────────────────────────────────────────────────

describe('POST /api/providers — clinic existence pre-check', () => {
  it('returns 404 when ops_admin targets a non-existent clinic (no auth user created)', async () => {
    mockSession('ops_admin')
    clinicCheckMock.mockResolvedValue({ data: null, error: null })

    const res = await POST(makeRequest(validBody({ clinicId: OTHER_CLINIC_ID })))
    expect(res.status).toBe(404)
    // Critical: failed BEFORE auth.admin.createUser was called → no orphan to roll back
    expect(createUserMock).not.toHaveBeenCalled()
    expect(npiCheckMock).not.toHaveBeenCalled()  // NPI check is AFTER clinic check
  })

  it('returns 409 when the target clinic is inactive (no auth user created)', async () => {
    mockSession('ops_admin')
    clinicCheckMock.mockResolvedValue({
      data: { clinic_id: OTHER_CLINIC_ID, is_active: false },
      error: null,
    })

    const res = await POST(makeRequest(validBody({ clinicId: OTHER_CLINIC_ID })))
    expect(res.status).toBe(409)
    expect(createUserMock).not.toHaveBeenCalled()
  })

  it('still hits clinic check for clinic_admin (own clinic) before creating auth user', async () => {
    mockSession('clinic_admin', TEST_CLINIC_ID)
    clinicCheckMock.mockResolvedValue({ data: null, error: null })  // simulate the clinic was just soft-deleted

    const res = await POST(makeRequest(validBody()))
    expect(res.status).toBe(404)
    expect(createUserMock).not.toHaveBeenCalled()
  })
})

// ── Compliance C4: the NPI is checked on save ─────────────────────
describe('NPI verification on save', () => {
  beforeEach(() => {
    getSessionMock.mockResolvedValue({ data: { session: { user: { id: 'admin-user', app_metadata: { app_role: 'clinic_admin', clinic_id: TEST_CLINIC_ID } } } } })
    npiCheckMock.mockResolvedValue({ data: null, error: null })
    clinicCheckMock.mockResolvedValue({ data: { clinic_id: TEST_CLINIC_ID, is_active: true }, error: null })
    createUserMock.mockResolvedValue({ data: { user: { id: 'new-auth-user' } }, error: null })
    providerInsertMock.mockResolvedValue({ data: { provider_id: 'new-provider', clinic_id: TEST_CLINIC_ID, user_id: 'new-auth-user', first_name: 'Ada', last_name: 'Lovelace', npi_number: '1987654328', license_state: 'TX', license_number: 'TX-1', dea_number: null }, error: null })
  })

  it('an NPI whose check digit is wrong is refused (400) before anything is created', async () => {
    const res = await POST(makeRequest(validBody({ npiNumber: '1987654321' })))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.details).toEqual(expect.arrayContaining(['npiNumber is not a valid NPI (the check digit does not match)']))
    expect(createUserMock).not.toHaveBeenCalled()
  })

  it('after the save the NPI is checked against the registry and the result returned', async () => {
    const res = await POST(makeRequest(validBody()))
    expect(res.status).toBe(201)
    expect(runNpiCheckMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ provider_id: 'new-provider', npi_number: '1987654328' }), 'admin-user')
    expect((await res.json()).npiStatus).toBe('verified')
  })

  it('a registry that cannot be reached never blocks the save: 201, unverified', async () => {
    runNpiCheckMock.mockResolvedValue({ ok: true, lookup: { status: 'unverified' }, checkedAt: 'x' })
    const res = await POST(makeRequest(validBody()))
    expect(res.status).toBe(201)
    expect((await res.json()).npiStatus).toBe('unverified')
  })

  it('a session whose token does not verify is 401', async () => {
    expect((await withForgedSession(() => POST(makeRequest(validBody())))).status).toBe(401)
    expect(createUserMock).not.toHaveBeenCalled()
  })
})

// ── Input validation (body shape, bounds, ids) ─────────────────────

describe('POST /api/providers — input validation', () => {
  beforeEach(() => mockSession('clinic_admin', TEST_CLINIC_ID))

  it('a body that is JSON null is 400, not a thrown 500', async () => {
    const res = await POST(makeRequest(null))
    expect(res.status).toBe(400)
    expect(createUserMock).not.toHaveBeenCalled()
  })

  it.each([
    ['firstName', { firstName: 'x'.repeat(201) }],
    ['lastName', { lastName: 'x'.repeat(201) }],
    ['email', { email: `${'x'.repeat(250)}@clinic.test` }],
    ['licenseNumber', { licenseNumber: 'x'.repeat(201) }],
    ['deaNumber', { deaNumber: 'x'.repeat(201) }],
    ['password', { password: 'x'.repeat(73) }],
  ])('an oversize %s is 400 with the field named; nothing created', async (field, over) => {
    const res = await POST(makeRequest(validBody(over)))
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string; details: string[] }
    expect(body.error).toBe('Validation failed')
    expect(body.details).toEqual(expect.arrayContaining([expect.stringContaining(field)]))
    expect(clinicCheckMock).not.toHaveBeenCalled()
    expect(createUserMock).not.toHaveBeenCalled()
  })

  it.each([
    ['npiNumber', { npiNumber: 1987654328 }],
    ['deaNumber', { deaNumber: 12345 }],
    ['licenseState', { licenseState: ['TX'] }],
  ])('a %s of the wrong type is 400 (was a thrown 500 or a coerced value)', async (_f, over) => {
    const res = await POST(makeRequest(validBody(over)))
    expect(res.status).toBe(400)
    expect(createUserMock).not.toHaveBeenCalled()
  })

  it('ops_admin: a seeded (non-v4) clinic id is accepted and checked against clinics', async () => {
    mockSession('ops_admin')
    const SEEDED = 'a1000000-0000-0000-0000-000000000001'
    const res = await POST(makeRequest(validBody({ clinicId: SEEDED })))
    expect(res.status).toBe(201)
    expect(clinicCheckMock).toHaveBeenCalled()
  })
})
