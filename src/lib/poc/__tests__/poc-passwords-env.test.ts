/**
 * @jest-environment node
 *
 * Security B9: no shared account password is in the repo. The POC demo
 * accounts read theirs from env (POC_PASSWORD_ENV) when an account is
 * created or reset, the E2E accounts from E2E_TEST_PASSWORD (or a value
 * derived from the E2E service-role key), and a missing one is an error
 * that names the variable.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  POC_CANONICAL_USERS, POC_PASSWORD_ENV, PocPasswordMissingError, missingPocPasswordEnv, pocPassword,
} from '../canonical-users'
import { syncPocCredentials } from '../sync-credentials'
import { e2ePassword } from '../../../../e2e/fixtures/test-password'

jest.mock('../totp-enrollment', () => ({ enrollDemoProvider: jest.fn().mockResolvedValue({ ok: true }) }))
jest.mock('../refresh-demo-data', () => ({ refreshDemoData: jest.fn().mockResolvedValue({ ok: true }) }))

const ENV_VARS = [...Object.values(POC_PASSWORD_ENV), 'POC_MODE', 'E2E_TEST_PASSWORD', 'E2E_SUPABASE_SERVICE_ROLE_KEY']
const saved = Object.fromEntries(ENV_VARS.map(k => [k, process.env[k]]))
function setAll() {
  process.env['POC_OPS_PASSWORD'] = 'env-ops'
  process.env['POC_CLINIC_ADMIN_PASSWORD'] = 'env-clinic'
  process.env['POC_PROVIDER_PASSWORD'] = 'env-provider'
  process.env['POC_MA_PASSWORD'] = 'env-ma'
}
afterEach(() => {
  for (const k of ENV_VARS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
})

describe('POC account passwords come from env', () => {
  it('the canonical list carries no password', () => {
    for (const user of POC_CANONICAL_USERS) expect(user).not.toHaveProperty('password')
    expect(POC_CANONICAL_USERS.map(u => POC_PASSWORD_ENV[u.label]))
      .toEqual(['POC_OPS_PASSWORD', 'POC_CLINIC_ADMIN_PASSWORD', 'POC_PROVIDER_PASSWORD', 'POC_MA_PASSWORD'])
  })

  it('pocPassword reads each account\'s env var', () => {
    setAll()
    expect(POC_CANONICAL_USERS.map(u => pocPassword(u))).toEqual(['env-ops', 'env-clinic', 'env-provider', 'env-ma'])
  })

  it('a missing variable is an error that names it (and no value)', () => {
    setAll()
    delete process.env['POC_PROVIDER_PASSWORD']
    expect(() => pocPassword({ label: 'provider' })).toThrow(PocPasswordMissingError)
    expect(() => pocPassword({ label: 'provider' })).toThrow(/POC_PROVIDER_PASSWORD is not set/)
    expect(missingPocPasswordEnv()).toEqual(['POC_PROVIDER_PASSWORD'])
  })

  it('an empty variable counts as missing', () => {
    setAll()
    process.env['POC_MA_PASSWORD'] = ''
    expect(missingPocPasswordEnv()).toEqual(['POC_MA_PASSWORD'])
  })
})

describe('syncPocCredentials with the passwords in env', () => {
  const createUser = jest.fn()
  const updateUserById = jest.fn()
  const client = (existing: string[]) => ({
    auth: { admin: {
      listUsers: jest.fn().mockResolvedValue({ data: { users: existing.map((email, i) => ({ id: `u${i}`, email })) }, error: null }),
      createUser, updateUserById,
    } },
  }) as unknown as Parameters<typeof syncPocCredentials>[0]

  beforeEach(() => {
    process.env['POC_MODE'] = 'true'
    createUser.mockReset().mockResolvedValue({ data: {}, error: null })
    updateUserById.mockReset().mockResolvedValue({ data: {}, error: null })
  })

  it('creates a missing account with the password from its env var', async () => {
    setAll()
    const report = await syncPocCredentials(client([]))
    expect(createUser.mock.calls.map(c => (c[0] as { password: string }).password)).toEqual(['env-ops', 'env-clinic', 'env-provider', 'env-ma'])
    expect(report.ok).toBe(true)
  })

  it('without the variable, that account is skipped with an error naming it; the others go ahead', async () => {
    setAll()
    delete process.env['POC_OPS_PASSWORD']
    const report = await syncPocCredentials(client([]))
    expect(createUser).toHaveBeenCalledTimes(3)
    expect(report.ok).toBe(false)
    const ops = report.results.find(r => r.label === 'ops_admin')!
    expect(ops.action).toBe('skipped')
    expect(ops.error).toMatch(/POC_OPS_PASSWORD is not set/)
    expect(JSON.stringify(report)).not.toMatch(/env-clinic|env-provider|env-ma/)
  })

  it('a metadata-only sync of existing accounts needs no password env at all', async () => {
    const report = await syncPocCredentials(client(POC_CANONICAL_USERS.map(u => u.email)))
    expect(updateUserById).toHaveBeenCalledTimes(4)
    for (const call of updateUserById.mock.calls) expect(call[1]).not.toHaveProperty('password')
    expect(report.ok).toBe(true)
  })

  it('a reset sends each account its env value', async () => {
    setAll()
    await syncPocCredentials(client(POC_CANONICAL_USERS.map(u => u.email)), { resetPasswords: true })
    expect(updateUserById.mock.calls.map(c => (c[1] as { password: string }).password)).toEqual(['env-ops', 'env-clinic', 'env-provider', 'env-ma'])
  })
})

describe('E2E account password (e2e/fixtures/test-password)', () => {
  it('uses E2E_TEST_PASSWORD when it is set', () => {
    process.env['E2E_TEST_PASSWORD'] = 'explicit-e2e-value'
    expect(e2ePassword()).toBe('explicit-e2e-value')
  })

  it('otherwise derives a stable value of at least 12 characters from the E2E service-role key', () => {
    delete process.env['E2E_TEST_PASSWORD']
    process.env['E2E_SUPABASE_SERVICE_ROLE_KEY'] = 'key-one'
    const one = e2ePassword()
    expect(e2ePassword()).toBe(one)
    expect(one.length).toBeGreaterThanOrEqual(12)
    expect(one).not.toContain('key-one')
    process.env['E2E_SUPABASE_SERVICE_ROLE_KEY'] = 'key-two'
    expect(e2ePassword()).not.toBe(one)
  })

  it('with neither set, the error names both variables', () => {
    delete process.env['E2E_TEST_PASSWORD']
    delete process.env['E2E_SUPABASE_SERVICE_ROLE_KEY']
    expect(() => e2ePassword()).toThrow(/E2E_TEST_PASSWORD.*E2E_SUPABASE_SERVICE_ROLE_KEY/)
  })
})

describe('static guard: no password literal in the seed and fixture sources', () => {
  // A password assigned as a string literal (password: '...', PASSWORD =
  // '...', { password: "..." }) in the files that create accounts.
  const LITERAL = /\bpassword\b\s*[:=]\s*['"`][^'"`\s]/i
  const ROOT = join(__dirname, '../../../..')
  const FILES = [
    'src/lib/poc/canonical-users.ts', 'src/lib/poc/sync-credentials.ts', 'scripts/seed-poc.ts', 'scripts/fix-rls.ts',
    'e2e/fixtures/seed.ts', 'e2e/global-setup.ts', 'e2e/rbac.spec.ts', 'e2e/accessibility.spec.ts',
    'e2e/upload-size-limit.spec.ts', 'e2e/pharmacy-onboarding-a11y.spec.ts', 'e2e/clinic-onboarding-status.spec.ts',
    'e2e/nav-after-redirect.spec.ts', 'e2e/self-serve-signup.spec.ts', 'e2e/team-invites.spec.ts',
  ]

  it.each(FILES)('%s', (file) => {
    const offending = readFileSync(join(ROOT, file), 'utf8').split('\n')
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => LITERAL.test(line) && !line.trim().startsWith('//'))
      .map(({ n }) => `${file}:${n}`)
    expect(offending).toEqual([])
  })
})
