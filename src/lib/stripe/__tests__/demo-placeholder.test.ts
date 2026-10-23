/**
 * @jest-environment node
 *
 * The demo payout placeholder is unique per clinic: clinics.
 * stripe_connect_account_id has a UNIQUE constraint and Sunrise already
 * holds 'poc_placeholder', so an approved clinic gets
 * 'poc_placeholder_<clinic_id>'. Everywhere the app recognises the demo
 * placeholder accepts both the exact 'poc_placeholder' and the
 * 'poc_placeholder_' prefix: checkout and payment groups skip Connect
 * routing for both, and Settings shows both as "Demo payout account". A
 * real acct_ id is unchanged.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isDemoPayoutPlaceholder, payoutAccountLabel } from '../demo-account'

const CLINIC = 'c1000000-0000-4000-8000-000000000001'

it.each([
  ['poc_placeholder', true],
  [`poc_placeholder_${CLINIC}`, true],
  ['acct_1PqRsTuVwXyZ0123', false],
  ['acct_poc_blue_cedar_demo', false],
  ['poc_placeholderx', false],
  ['', false],
  [null, false],
])('isDemoPayoutPlaceholder(%j) is %s', (id, expected) => {
  expect(isDemoPayoutPlaceholder(id as string | null)).toBe(expected)
})

it('Settings shows the per-clinic placeholder as "Demo payout account"; a real id as it is', () => {
  expect(payoutAccountLabel(`poc_placeholder_${CLINIC}`)).toBe('Demo payout account')
  expect(payoutAccountLabel('acct_1PqRsTuVwXyZ0123')).toBe('acct_1PqRsTuVwXyZ0123')
})

it.each([
  'src/app/api/checkout/payment-intent/route.ts',
  'src/lib/payment-group/create-group.ts',
])('%s recognises the placeholder through the one helper, never by exact match', file => {
  const src = readFileSync(join(process.cwd(), file), 'utf8')
  expect(src).toContain('isDemoPayoutPlaceholder(')
  expect(src).not.toMatch(/===\s*'poc_placeholder'/)
})
