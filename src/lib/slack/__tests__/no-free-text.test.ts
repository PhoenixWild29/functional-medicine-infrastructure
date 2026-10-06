/**
 * @jest-environment node
 *
 * Owner decision: pharmacy rejection reasons, notes, fax text and error
 * messages are free text that can carry patient details, so they never go
 * to Slack. Every Slack alert is built by one helper, buildOpsAlert, which
 * keeps only an allow-list: the alert type (and its fixed title), order
 * ID, pharmacy, status, a link to the ops order page, and named details
 * whose values are numbers or single machine tokens (codes, ids, counts).
 * Anything else is dropped, so free text cannot reach Slack even when a
 * caller passes it.
 */

import { buildOpsAlert, opsOrderUrl } from '../ops-alert'
import {
  buildAdapterFailureAlert,
  buildSubmissionFailedAlert,
  buildStatusHistoryWriteFailedAlert,
  buildSlaBreachAlert,
} from '../client'

process.env['APP_BASE_URL'] = 'https://app.test'

const ORDER = 'd1000000-0000-4000-8000-000000000001'

/** Patient details and pharmacy free text that must never appear. */
export const PHI_SENTINELS = ['Jane', 'Doe', '1980-01-02', '555-867-5309', '8675309', '42 Elm', 'Semaglutide', 'allergic', 'sulfa']
const FREE_TEXT = 'Patient Jane Doe DOB 1980-01-02, 42 Elm Street, phone 555-867-5309, allergic to sulfa; Semaglutide 5mg'

function expectNoPhi(payload: unknown) {
  const text = JSON.stringify(payload)
  for (const s of PHI_SENTINELS) expect(text).not.toContain(s)
}

describe('buildOpsAlert: the one allow-list', () => {
  it('sends the type title, order ID, pharmacy, status and the ops order link', () => {
    const text = JSON.stringify(buildOpsAlert({ type: 'pharmacy_rejected', orderId: ORDER, pharmacy: 'Portal Plus Pharmacy', status: 'PHARMACY_REJECTED' }))
    expect(text).toContain('Pharmacy rejected an order')
    expect(text).toContain(ORDER)
    expect(text).toContain('Portal Plus Pharmacy')
    expect(text).toContain('PHARMACY_REJECTED')
    expect(text).toContain(opsOrderUrl(ORDER))
    expect(opsOrderUrl(ORDER)).toBe(`https://app.test/ops/pipeline?order=${ORDER}`)
  })

  it('drops a detail whose value is free text, keeps machine tokens and numbers', () => {
    const payload = buildOpsAlert({
      type: 'adapter_failure', orderId: ORDER, pharmacy: 'strive', status: 'SUBMISSION_FAILED',
      details: { code: 'fax_send_failed', attempts: 3, reason: FREE_TEXT } as never,
    })
    expectNoPhi(payload)
    const text = JSON.stringify(payload)
    expect(text).toContain('fax_send_failed')
    expect(text).toContain('3')
  })

  it('drops a detail key that is not on the allow-list, whatever its value', () => {
    const text = JSON.stringify(buildOpsAlert({ type: 'adapter_failure', orderId: ORDER, details: { patient_name: 'x1' } as never }))
    expect(text).not.toContain('patient_name')
    expect(text).not.toContain('x1')
  })

  it('a status that is not an enum, or an order ID that is not a single token, is dropped', () => {
    const payload = buildOpsAlert({ type: 'adapter_failure', orderId: FREE_TEXT, status: FREE_TEXT })
    expectNoPhi(payload)
  })

  it('a pharmacy value that reads like free text is dropped', () => {
    expectNoPhi(buildOpsAlert({ type: 'adapter_failure', orderId: ORDER, pharmacy: FREE_TEXT }))
  })
})

describe('the alert builders keep their names and apply the allow-list', () => {
  it('adapter failure: an error code that is free text (a pharmacy rejection reason) is dropped', () => {
    const payload = buildAdapterFailureAlert({ orderId: ORDER, pharmacySlug: 'portal-plus', integrationTier: 'TIER_1_API', errorCode: FREE_TEXT })
    expectNoPhi(payload)
    expect(JSON.stringify(payload)).toContain(opsOrderUrl(ORDER))
  })

  it('submission failed: a cascade history that echoes an adapter error is dropped', () => {
    expectNoPhi(buildSubmissionFailedAlert({ orderId: ORDER, pharmacySlug: 'strive', cascadeHistory: `TIER_1_API: ${FREE_TEXT}` } as never))
  })

  it('status history write failed: the database error text is not sent', () => {
    const payload = buildStatusHistoryWriteFailedAlert({
      orderId: ORDER, oldStatus: 'AWAITING_PAYMENT', newStatus: 'PAID_PROCESSING', actor: 'stripe_webhook',
      source: 'casTransition', failedAt: '2026-10-06T12:00:00.000Z', error: `Failing row contains (${FREE_TEXT})`,
    })
    expectNoPhi(payload)
    const text = JSON.stringify(payload)
    expect(text).toContain('PAID_PROCESSING')
    expect(text).toContain('stripe_webhook')
  })

  it('SLA breach: still carries the SLA context as tokens, and the ops link', () => {
    const text = JSON.stringify(buildSlaBreachAlert({
      orderId: ORDER, slaType: 'PHARMACY_ACKNOWLEDGE', deadlineAt: new Date(Date.now() - 90 * 60_000).toISOString(),
      orderStatus: 'FAX_DELIVERED', pharmacySlug: 'strive', integrationTier: 'TIER_4_FAX', escalationTier: 1,
    }))
    for (const s of ['PHARMACY_ACKNOWLEDGE', 'FAX_DELIVERED', 'strive', 'TIER_4_FAX', opsOrderUrl(ORDER)]) expect(text).toContain(s)
  })
})
