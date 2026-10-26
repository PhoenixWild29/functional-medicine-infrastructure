/**
 * The clinic order drawer says why sending an order to the pharmacy
 * failed, in plain words, and what happens next. Known adapter error codes
 * map to plain reasons; anything else gets a safe generic reason. Raw
 * codes, messages, ids and stack traces never reach the text. No em dash.
 */

import { isSubmissionFailure, plainFailureReason, submissionFailureNotice } from '../submission-failure'

describe('isSubmissionFailure', () => {
  it.each(['SUBMISSION_FAILED', 'FAX_FAILED', 'PHARMACY_REJECTED'])('%s is a failed submission', s => {
    expect(isSubmissionFailure(s)).toBe(true)
  })
  it.each(['DRAFT', 'SUBMISSION_PENDING', 'FAX_QUEUED', 'SHIPPED', 'ERROR_PAYMENT_FAILED', 'CANCELLED'])('%s is not', s => {
    expect(isSubmissionFailure(s)).toBe(false)
  })
})

describe('plainFailureReason', () => {
  it.each([
    ['NETWORK_ERROR',          "the pharmacy's system did not respond"],
    ['EXHAUSTED',              "the pharmacy's system did not respond"],
    ['503',                    "the pharmacy's system did not respond"],
    ['circuit_breaker_opened', "the pharmacy's system is temporarily unavailable"],
    ['REJECTED',               'the pharmacy declined the order'],
    ['order_rejected',         'the pharmacy declined the order'],
    ['pharmacy_rejected',      'the pharmacy declined the order'],
    ['DRUG_UNAVAILABLE',       'the pharmacy does not have this medication available'],
    ['pharmacy_not_licensed',  "the pharmacy is not licensed for the patient's state"],
    ['fax_send_failed',        'the fax to the pharmacy did not go through'],
    ['fax_submission_error',   'the fax to the pharmacy did not go through'],
    ['fax_permanently_failed', 'the fax to the pharmacy did not go through'],
    ['portal_automation_error', "the pharmacy's ordering portal had an error"],
    ['422',                    'the pharmacy could not accept the order details'],
    ['401',                    "the pharmacy's system refused the connection"],
  ])('%s → %s', (code, reason) => {
    expect(plainFailureReason(code)).toBe(reason)
  })

  it('an unknown or missing code gets a generic reason, never the code itself', () => {
    expect(plainFailureReason('XYZ_INTERNAL_42')).toBe('the order could not be delivered to the pharmacy')
    expect(plainFailureReason(null)).toBe('the order could not be delivered to the pharmacy')
  })
})

describe('submissionFailureNotice', () => {
  it('says where, why and what happens next', () => {
    expect(submissionFailureNotice({ pharmacyName: 'Strive Pharmacy', plainReason: 'the pharmacy declined the order' }))
      .toBe('Sending to Strive Pharmacy failed: the pharmacy declined the order. CompoundIQ ops has been alerted and will re-route or retry.')
  })
  it('without a pharmacy name it still reads', () => {
    expect(submissionFailureNotice({ pharmacyName: null, plainReason: 'the pharmacy declined the order' }))
      .toBe('Sending to the pharmacy failed: the pharmacy declined the order. CompoundIQ ops has been alerted and will re-route or retry.')
  })
  it('no em dash in any reason or notice', () => {
    const codes = ['NETWORK_ERROR', 'REJECTED', 'DRUG_UNAVAILABLE', 'pharmacy_not_licensed', 'fax_send_failed', 'portal_automation_error', '422', '401', null]
    for (const c of codes) expect(submissionFailureNotice({ pharmacyName: 'P', plainReason: plainFailureReason(c) })).not.toContain('—')
  })
})

describe('B review T6: a refusal that needs a new prescription says so', () => {
  it.each(['allergies_changed', 'signature_mismatch', 'unsigned_order', 'pharmacy_mismatch'])('%s: cancel and prescribe again, not "will retry"', code => {
    const notice = submissionFailureNotice({ pharmacyName: 'Strive Pharmacy', plainReason: plainFailureReason(code), code })
    expect(notice).toContain('Cancel this prescription and prescribe it again')
    expect(notice).not.toContain('will re-route or retry')
    expect(notice).not.toMatch(/—/)
  })

  it('the allergy case reads in full', () => {
    expect(submissionFailureNotice({ pharmacyName: 'Strive Pharmacy', plainReason: plainFailureReason('allergies_changed'), code: 'allergies_changed' }))
      .toBe("Sending to Strive Pharmacy failed: the patient's allergies changed after the prescription was signed. Cancel this prescription and prescribe it again, so the prescriber signs it with the current allergies. CompoundIQ ops has been alerted.")
  })

  it('other codes keep the retry wording', () => {
    expect(submissionFailureNotice({ pharmacyName: null, plainReason: plainFailureReason('fax_send_failed'), code: 'fax_send_failed' }))
      .toContain('will re-route or retry')
  })
})
