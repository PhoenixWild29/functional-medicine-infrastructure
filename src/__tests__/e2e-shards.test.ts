/**
 * @jest-environment node
 *
 * E2E shards (e2e/fixtures/shard.ts): two Playwright shards run at the same
 * time against the one E2E Supabase project, each with its own clinic,
 * providers, patients and logins.
 *
 *   - Shard 1 keeps every id, email, NPI, slug and prefix E2E has always
 *     used (the single-shard PR run is unchanged).
 *   - Shard 2's are valid, distinct from shard 1's, and never caught by a
 *     shard-1 cleanup that sweeps an email prefix with startsWith.
 *   - ci.yml: e2e-sharded-trial is manual only, holds the shared E2E
 *     concurrency group, runs --shard=1/2 and --shard=2/2 together, and
 *     enforces MFA for both shards' MFA users; the PR e2e job skips that
 *     manual mode and is otherwise unchanged.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { shardEmail, shardId, shardName, shardNpi, shardPhone, shardPrefix, shardSlug } from '../../e2e/fixtures/shard'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const SEEDED = [
  'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000003',
  'aaaaaaaa-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000005', 'aaaaaaaa-0000-0000-0000-0000000000a1',
  'aaaaaaaa-0000-0000-0000-0000000000b1', 'aaaaaaaa-0000-0000-0000-0000000000c1', 'bbbbbbbb-0000-0000-0000-000000000001',
]

describe('shard 1 is the E2E data of today', () => {
  it.each(SEEDED)('%s unchanged', id => expect(shardId(id, 1)).toBe(id))
  it('emails, NPIs, names, slugs, phones and prefixes unchanged', () => {
    expect(shardEmail('test-provider@compoundiq.test', 1)).toBe('test-provider@compoundiq.test')
    expect(shardNpi('1234567890', 1)).toBe('1234567890')
    expect(shardName('Test Clinic E2E', 1)).toBe('Test Clinic E2E')
    expect(shardSlug('upload-limit-pharmacy', 1)).toBe('upload-limit-pharmacy')
    expect(shardPhone('+15550000001', 1)).toBe('+15550000001')
    expect(shardPrefix('e2e-signup-', 1)).toBe('e2e-signup-')
  })
})

describe('shard 2 has its own', () => {
  it('ids: valid UUIDs, all different from shard 1 and from each other', () => {
    const two = SEEDED.map(id => shardId(id, 2))
    for (const id of two) expect(id).toMatch(UUID)
    expect(new Set([...SEEDED, ...two]).size).toBe(SEEDED.length * 2)
    expect(shardId('aaaaaaaa-0000-0000-0000-000000000001', 2)).toBe('5aaaaaa2-0000-0000-0000-000000000001')
  })

  it('NPIs stay 10 digits and differ from shard 1 and from each other (providers_npi_number_unique)', () => {
    const npis = ['1234567890', '1987654321'].flatMap(n => [n, shardNpi(n, 2)])
    for (const n of npis) expect(n).toMatch(/^\d{10}$/)
    expect(new Set(npis).size).toBe(4)
  })

  it('emails, slugs and the placeholder-style values differ; an email stays an address', () => {
    expect(shardEmail('test-mfa-admin@compoundiq.test', 2)).toBe('test-mfa-admin+s2@compoundiq.test')
    expect(shardSlug('a11y-onboarding-pharmacy', 2)).toBe('a11y-onboarding-pharmacy-s2')
    expect(shardPhone('+15550000001', 2)).toMatch(/^\+1\d{10}$/)
    expect(shardPhone('+15550000001', 2)).not.toBe('+15550000001')
  })

  it.each(['e2e-signup-', 'nav-e2e-', 'e2e-onboarding-status-'])('a shard-1 cleanup sweeping %s never matches shard 2\'s accounts', prefix => {
    const twos = `${shardPrefix(prefix, 2)}clinic-abc@compoundiq.test`
    expect(twos.startsWith(prefix)).toBe(false)
    expect(twos.startsWith(shardPrefix(prefix, 2))).toBe(true)
  })
})

describe('ci.yml', () => {
  const ci = readFileSync(join(process.cwd(), '.github', 'workflows', 'ci.yml'), 'utf8').replace(/\r\n/g, '\n')
  const block = (name: string) => {
    const at = ci.indexOf(`\n  ${name}:\n`)
    const next = ci.slice(at + 1).search(/\n {2}[a-z0-9-]+:\n {4}name:/)
    return next < 0 ? ci.slice(at) : ci.slice(at, at + 1 + next)
  }
  const trial = block('e2e-sharded-trial')
  const e2e = block('e2e')

  it('the trial is manual only, in the shared E2E group, never cancelling a running E2E', () => {
    expect(ci).toContain('options: [single, sharded-trial]')
    expect(ci).toContain('default: single')
    expect(trial).toContain("if: github.event_name == 'workflow_dispatch' && inputs.e2e == 'sharded-trial'")
    expect(trial).toMatch(/concurrency:\n\s+group: e2e-shared-supabase-project\n\s+cancel-in-progress: false/)
  })

  it("runs both shards at once and enforces MFA for both shards' MFA users", () => {
    expect(trial).toMatch(/npx playwright test --shard=1\/2[^\n]*&\n/)
    expect(trial).toMatch(/npx playwright test --shard=2\/2[^\n]*&\n/)
    expect(trial).toContain("MFA_ENFORCED_EMAILS: 'test-mfa-admin@compoundiq.test,test-mfa-admin+s2@compoundiq.test'")
  })

  it('the PR E2E job still runs for PRs, the nightly run and manual "single" runs', () => {
    expect(e2e).toContain("github.event_name == 'pull_request'")
    expect(e2e).toContain("|| github.event_name == 'schedule'")
    expect(e2e).toContain("|| (github.event_name == 'workflow_dispatch' && inputs.e2e != 'sharded-trial')")
    expect(e2e).toContain('run: npm run test:e2e')
    expect(e2e).toContain("MFA_ENFORCED_EMAILS: 'test-mfa-admin@compoundiq.test'\n")
    expect(e2e).toMatch(/group: e2e-shared-supabase-project/)
  })
})

describe('patient protocol choice (#268) is shard-safe', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

  it('the proposals fixture reads and writes only this shard\'s clinic and patient', () => {
    const src = read('e2e/fixtures/proposals.ts')
    expect(src).toContain("from './seed'")
    for (const fn of ['closeTestProposals', 'latestTestProposal']) {
      const body = src.slice(src.indexOf(`export async function ${fn}`))
      const end = body.indexOf('\n}\n')
      expect(body.slice(0, end)).toMatch(/\.eq\('clinic_id', TEST_IDS\.clinic\)/)
      expect(body.slice(0, end)).toMatch(/\.eq\('patient_id', TEST_IDS\.patient\)/)
    }
    expect(src).not.toMatch(/'aaaaaaaa-|@compoundiq\.test/)
  })

  it('the spec signs in through TEST_USERS and writes no shared catalog or table-wide RPC', () => {
    const spec = read('e2e/patient-protocol-choice.spec.ts')
    expect(spec).toContain('TEST_USERS.provider.email')
    expect(spec).not.toMatch(/'aaaaaaaa-|@compoundiq\.test|Test Clinic E2E/)
    expect(spec).not.toMatch(/\.rpc\(|from\('(pharmacy_formulations|pharmacies|formulations|ingredients|catalog)'\)\.(insert|update|upsert|delete)/)
  })
})
