/**
 * @jest-environment node
 *
 *   - "Ordering opens at launch" shows only for a portal clinic with no
 *     active payout account: the dashboard and Settings both decide it as
 *     (status is not ACTIVE) AND (portal clinic).
 *   - scripts/demo/2026-10-23-portal-clinic-payouts.sql: one transaction,
 *     idempotent; sets the demo placeholder and ACTIVE for approved portal
 *     clinics (self sign-up or a clinic-admin invite) with no Connect
 *     account, never overwriting a real one; ends with a check query.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

it('the dashboard and Settings show the launch copy only without an active payout account', () => {
  for (const page of ['src/app/(clinic-app)/dashboard/page.tsx', 'src/app/(clinic-app)/settings/page.tsx']) {
    expect(read(page)).toMatch(/payoutsAtLaunch = \w*\.?stripe_connect_status !== 'ACTIVE' && await isPortalOnboardedClinic|payoutsAtLaunch = stripeConnectStatus !== 'ACTIVE' && await isPortalOnboardedClinic/)
  }
})

describe('the demo payouts script', () => {
  const FILE = 'scripts/demo/2026-10-23-portal-clinic-payouts.sql'
  const sql = () => (existsSync(join(process.cwd(), FILE)) ? read(FILE) : '').replace(/\r\n/g, '\n')
  const flat = () => sql().replace(/--.*$/gm, '').replace(/\s+/g, ' ').toLowerCase()

  it('exists, in one transaction', () => {
    expect(flat()).toMatch(/^\s*begin;/)
    expect(flat()).toContain('commit;')
  })

  it('sets the placeholder and ACTIVE only for approved, live portal clinics with no Connect account', () => {
    const f = flat()
    expect(f).toMatch(/update clinics c set stripe_connect_account_id = 'poc_placeholder_' \|\| c\.clinic_id, stripe_connect_status = 'active'/)
    expect(f).toContain("c.onboarding_status = 'approved'")
    expect(f).toContain('c.deleted_at is null')
    expect(f).toMatch(/\(c\.stripe_connect_account_id is null or c\.stripe_connect_account_id = ''\)/)
    expect(f).toMatch(/c\.signup_source = 'self_serve' or exists \(select 1 from onboarding_invites i where i\.clinic_id = c\.clinic_id and i\.kind = 'clinic_admin'\)/)
  })

  it('touches nothing else: one update, no insert or delete', () => {
    const f = flat()
    expect(f.match(/\bupdate\b/g)).toHaveLength(1)
    expect(f).not.toMatch(/\binsert\b|\bdelete\b|\bdrop\b/)
  })

  it('ends with a check query after COMMIT', () => {
    const f = flat()
    expect(f.lastIndexOf('select')).toBeGreaterThan(f.indexOf('commit;'))
  })
})
