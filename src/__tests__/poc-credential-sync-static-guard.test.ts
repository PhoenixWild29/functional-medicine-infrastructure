/**
 * @jest-environment node
 *
 * Static + behavioural guards for the 2026-09-11 silent-logout root cause.
 *
 * A Supabase admin user update that includes `password` revokes every
 * existing session for that user, even when the value is unchanged.
 * /api/cron/poc-credential-sync ran every 10 minutes and did exactly that
 * for all four POC accounts, so every signed-in demo user was logged out
 * within 10 minutes. The fix has two halves and both are locked in here:
 *
 *   1. vercel.json must NOT schedule poc-credential-sync (or any cron that
 *      would reach syncPocCredentials on a timer).
 *   2. syncPocCredentials() must NOT send `password` to updateUserById for
 *      an existing user unless the caller passes { resetPasswords: true }.
 *      New-user creation may still set the password (no session exists).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { syncPocCredentials } from '@/lib/poc/sync-credentials'

const read = (rel: string): string =>
  readFileSync(join(process.cwd(), rel), 'utf8')

// ── 1. Static: no scheduled credential sync ────────────────────────

describe('vercel.json has no poc-credential-sync cron', () => {
  const vercel = JSON.parse(read('vercel.json')) as { crons?: Array<{ path: string; schedule: string }> }

  it('does not schedule /api/cron/poc-credential-sync', () => {
    const crons = vercel.crons ?? []
    expect(crons.length).toBeGreaterThan(0)
    expect(crons.filter(c => c.path.includes('poc-credential-sync'))).toEqual([])
  })

  it('the cron route itself never requests a password reset', () => {
    const routeSrc = read('src/app/api/cron/poc-credential-sync/route.ts')
    expect(routeSrc).not.toMatch(/resetPasswords\s*:\s*true/)
  })
})

// ── 2. Behavioural: metadata-only by default ──────────────────────

jest.mock('@/lib/poc/totp-enrollment', () => ({
  enrollDemoProvider: jest.fn().mockResolvedValue({ ok: true, action: 'skipped' }),
}))

jest.mock('@/lib/poc/refresh-demo-data', () => ({
  refreshDemoData: jest.fn().mockResolvedValue({ ok: true }),
}))

const updateUserByIdMock = jest.fn()
const createUserMock     = jest.fn()

const EXISTING_EMAILS = [
  'ops@compoundiq-poc.com',
  'admin@sunrise-clinic.com',
  'dr.chen@sunrise-clinic.com',
  'ma@sunrise-clinic.com',
]

const mockSupabase = {
  auth: {
    admin: {
      listUsers: jest.fn().mockResolvedValue({
        data: { users: EXISTING_EMAILS.map((email, i) => ({ id: `user-${i}`, email })) },
        error: null,
      }),
      updateUserById: (...args: unknown[]) => updateUserByIdMock(...args),
      createUser:     (...args: unknown[]) => createUserMock(...args),
    },
  },
} as unknown as Parameters<typeof syncPocCredentials>[0]

const ORIGINAL_POC_MODE = process.env['POC_MODE']

beforeEach(() => {
  updateUserByIdMock.mockReset().mockResolvedValue({ data: {}, error: null })
  createUserMock.mockReset().mockResolvedValue({ data: {}, error: null })
  process.env['POC_MODE'] = 'true'
})

afterAll(() => {
  if (ORIGINAL_POC_MODE === undefined) {
    delete process.env['POC_MODE']
  } else {
    process.env['POC_MODE'] = ORIGINAL_POC_MODE
  }
})

describe('syncPocCredentials session safety', () => {
  it('never sends password for existing users by default (sessions survive)', async () => {
    const report = await syncPocCredentials(mockSupabase)

    expect(updateUserByIdMock).toHaveBeenCalledTimes(EXISTING_EMAILS.length)
    for (const call of updateUserByIdMock.mock.calls) {
      const attributes = call[1] as Record<string, unknown>
      expect(attributes).not.toHaveProperty('password')
      expect(attributes).toHaveProperty('user_metadata')
    }
    expect(createUserMock).not.toHaveBeenCalled()
    expect(report.ok).toBe(true)
    expect(report.passwords_reset).toBe(false)
  })

  it('sends password for existing users ONLY with the explicit resetPasswords flag', async () => {
    const report = await syncPocCredentials(mockSupabase, { resetPasswords: true })

    expect(updateUserByIdMock).toHaveBeenCalledTimes(EXISTING_EMAILS.length)
    for (const call of updateUserByIdMock.mock.calls) {
      const attributes = call[1] as Record<string, unknown>
      expect(typeof attributes['password']).toBe('string')
    }
    expect(report.passwords_reset).toBe(true)
  })

  it('treats resetPasswords: false the same as omitted', async () => {
    await syncPocCredentials(mockSupabase, { resetPasswords: false })

    for (const call of updateUserByIdMock.mock.calls) {
      expect(call[1] as Record<string, unknown>).not.toHaveProperty('password')
    }
  })
})
