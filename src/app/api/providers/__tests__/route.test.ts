/**
 * @jest-environment node
 *
 * Tests for POST /api/providers — the production-grade replacement
 * for the seed-script's linkProviderToAuthUser() convention.
 *
 * Critical paths under test:
 *   - Role gating: only clinic_admin (own clinic) + ops_admin (any clinic)
 *   - Cross-tenancy: clinic_admin cannot plant a provider in another clinic
 *   - Input validation: email, password ≥12, NPI 10 digits, valid US state
 *   - Pre-checks: duplicate NPI → 409
 *   - Auth user collision: email already exists → 409
 *   - Atomicity rollback: if providers.insert fails, auth user is deleted
 */

import { POST } from '../route'

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
    password:      'a-strong-password-123',
    firstName:     'Test',
    lastName:      'Provider',
    npiNumber:     '9876543210',
    licenseState:  'TX',
    licenseNumber: 'TX-MD-9999',
    deaNumber:     null,
    ...overrides,
  }
}

// ── Mocks ──────────────────────────────────────────────────────────

const getSessionMock     = jest.fn()
const npiCheckMock       = jest.fn()
const createUserMock     = jest.fn()
const providerInsertMock = jest.fn()
const deleteUserMock     = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockResolvedValue({
    auth: { getSession: () => getSessionMock() },
  }),
}))

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
  npiCheckMock.mockReset()
  createUserMock.mockReset()
  providerInsertMock.mockReset()
  deleteUserMock.mockReset()

  // Default happy-path mock state — individual tests override
  npiCheckMock.mockResolvedValue({ data: null, error: null })
  createUserMock.mockResolvedValue({ data: { user: { id: NEW_PROVIDER_USER_ID } }, error: null })
  providerInsertMock.mockResolvedValue({
    data: {
      provider_id:    'provider-uuid-new',
      user_id:        NEW_PROVIDER_USER_ID,
      clinic_id:      TEST_CLINIC_ID,
      first_name:     'Test',
      last_name:      'Provider',
      npi_number:     '9876543210',
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
          user_metadata: {
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

  it('returns 400 when password is too short', async () => {
    const res = await POST(makeRequest(validBody({ password: 'short' })))
    expect(res.status).toBe(400)
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

  it('returns 409 when the email is already registered (createUser returns "already")', async () => {
    createUserMock.mockResolvedValue({
      data: { user: null },
      error: { message: 'A user with this email address has already been registered' },
    })

    const res = await POST(makeRequest(validBody()))
    expect(res.status).toBe(409)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/already/i)
    expect(providerInsertMock).not.toHaveBeenCalled()
  })
})

// ── Atomicity rollback ─────────────────────────────────────────────

describe('POST /api/providers — rollback on providers.insert failure', () => {
  beforeEach(() => mockSession('clinic_admin', TEST_CLINIC_ID))

  it('deletes the auth user when providers.insert fails', async () => {
    providerInsertMock.mockResolvedValue({
      data: null,
      error: { message: 'simulated DB error' },
    })
    deleteUserMock.mockResolvedValue({ error: null })

    const res = await POST(makeRequest(validBody()))
    expect(res.status).toBe(500)
    expect(deleteUserMock).toHaveBeenCalledTimes(1)
    expect(deleteUserMock).toHaveBeenCalledWith(NEW_PROVIDER_USER_ID)
  })

  it('still returns 500 (no retry signal) when even the rollback delete fails', async () => {
    // CRITICAL double-fault path: providers.insert failed AND we couldn't clean
    // up the auth user. The caller still gets 500 — the orphan identity is a
    // logged operational issue requiring manual cleanup, not a retry signal.
    providerInsertMock.mockResolvedValue({
      data: null,
      error: { message: 'simulated DB error' },
    })
    deleteUserMock.mockResolvedValue({ error: { message: 'simulated rollback failure' } })

    const res = await POST(makeRequest(validBody()))
    expect(res.status).toBe(500)
    expect(deleteUserMock).toHaveBeenCalledTimes(1)
  })
})

// ── Happy path ─────────────────────────────────────────────────────

describe('POST /api/providers — happy path', () => {
  it('creates auth user + provider row for clinic_admin in own clinic, returns 201', async () => {
    mockSession('clinic_admin', TEST_CLINIC_ID)

    const res = await POST(makeRequest(validBody()))
    expect(res.status).toBe(201)

    const body = await res.json() as {
      providerId: string; userId: string; clinicId: string
      firstName: string; lastName: string; npiNumber: string
    }
    expect(body.providerId).toBe('provider-uuid-new')
    expect(body.userId).toBe(NEW_PROVIDER_USER_ID)
    expect(body.clinicId).toBe(TEST_CLINIC_ID)
    expect(body.firstName).toBe('Test')
    expect(body.lastName).toBe('Provider')

    // Auth user created with provider role + clinic_id metadata
    expect(createUserMock).toHaveBeenCalledWith(expect.objectContaining({
      email:         'new.provider@clinic.test',
      email_confirm: true,
      user_metadata: { app_role: 'provider', clinic_id: TEST_CLINIC_ID },
    }))
    // No rollback called on the happy path
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
        npi_number:     '9876543210',
        license_state:  'TX',
        license_number: 'TX-MD-9999',
        dea_number:     null,
      },
      error: null,
    })

    const res = await POST(makeRequest(validBody({ clinicId: OTHER_CLINIC_ID })))
    expect(res.status).toBe(201)
    expect(createUserMock).toHaveBeenCalledWith(expect.objectContaining({
      user_metadata: { app_role: 'provider', clinic_id: OTHER_CLINIC_ID },
    }))
  })
})
