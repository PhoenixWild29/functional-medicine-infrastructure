/**
 * @jest-environment node
 *
 * #195: the Slack "Code" field of an adapter-failure alert carries one of
 * OUR fixed codes, never pharmacy text. A single-token pharmacy rejection
 * code ("RX_DENIED_PATIENT_JOHN") passed the old token check and reached
 * Slack. Now errorCode is a closed type and anything outside the list is
 * sent as "unknown"; a caller's details cannot override the code.
 */

import { buildAdapterFailureAlert, ADAPTER_ERROR_CODES, type AdapterErrorCode } from '../client'

const base = { orderId: 'a1000000-0000-4000-8000-000000000001', pharmacySlug: 'acme', integrationTier: 'TIER_1_API' }
const codeField = (p: unknown) => {
  const blocks = (p as { blocks: Array<{ fields?: Array<{ text: string }> }> }).blocks
  const field = blocks.flatMap(b => b.fields ?? []).find(f => f.text.startsWith('*Code:*'))
  return field?.text.split('\n')[1]
}

it('a pharmacy-supplied code never reaches Slack', () => {
  const p = buildAdapterFailureAlert({ ...base, errorCode: 'RX_DENIED_PATIENT_JOHN' as AdapterErrorCode })
  expect(JSON.stringify(p)).not.toContain('RX_DENIED_PATIENT_JOHN')
  expect(codeField(p)).toBe('unknown')
})

it('details cannot smuggle a code past the list', () => {
  const details = { code: 'PATIENT_DOB_19800101' } as unknown as Parameters<typeof buildAdapterFailureAlert>[0]['details']
  const p = buildAdapterFailureAlert({ ...base, errorCode: 'order_rejected', details })
  expect(JSON.stringify(p)).not.toContain('PATIENT_DOB_19800101')
  expect(codeField(p)).toBe('order_rejected')
})

it.each([
  'order_rejected', 'pharmacy_rejected', 'fax_send_failed', 'circuit_breaker_opened', 'fax_sent_status_not_updated',
  'pharmacy_not_licensed', 'fax_permanently_failed', 'stripe_dispute', 'stripe_dispute_group', 'stripe_transfer_failed',
] as const)('our code %s is sent as is', code => {
  expect(ADAPTER_ERROR_CODES).toContain(code)
  expect(codeField(buildAdapterFailureAlert({ ...base, errorCode: code }))).toBe(code)
})

it('the type refuses free text at compile time', () => {
  // @ts-expect-error a string that is not one of our codes
  const p = buildAdapterFailureAlert({ ...base, errorCode: 'anything' })
  expect(codeField(p)).toBe('unknown')
})
