/**
 * @jest-environment node
 *
 * HIPAA B7: the signature binds the prescription. The canonical
 * serialisation is stable (field order fixed, object key order and
 * timestamp spelling irrelevant) and any change to signed content, the
 * signature or the time changes the binding.
 */

import {
  CANONICAL_FIELD_NAMES,
  boundSignatureValue,
  canonicalSignedContent,
  parseSignatureValue,
  signatureBinding,
  verifySignatureBinding,
  type SignedOrderRow,
} from '../signature-binding'

const DIGEST = 'a'.repeat(64)
const SIGNED_AT = '2026-10-25T14:03:07.123Z'

function order(over: Partial<SignedOrderRow> = {}): SignedOrderRow {
  return {
    order_id: 'o-1', status: 'SUBMISSION_PENDING', locked_at: SIGNED_AT, provider_signature_hash_snapshot: null,
    patient_id: 'pt-1', provider_npi_snapshot: '1234567893',
    pharmacy_snapshot: { pharmacy_id: 'ph-1', name: 'Strive' },
    medication_snapshot: { medication_name: 'Semaglutide', strength: '2.5 mg/mL', form: 'injection', compounding: { checked_at: SIGNED_AT, ingredients: [{ name: 'Semaglutide', status: 'bulks_list' }] } },
    sig_mode: 'standard', sig_text: 'Inject 0.25 mg weekly', titration_steps: [], cycle_on_days: null, cycle_off_days: null,
    quantity: 1, dispense_quantity: 1, dispense_unit: 'vial', days_supply: 28, refills: 2,
    package_id: null, package_label: null, package_count: 1, syringe_option: 'insulin_29g', substitution_allowed: true,
    shipping_type: 'standard', clinical_difference: 'Patient needs a dose not available commercially',
    diagnosis_code: 'E66.9', diagnosis_text: 'Obesity', special_instructions: 'Keep refrigerated',
    ...over,
  }
}
const SULFA = { allergies: ['Sulfa'], nkda: false }

describe('the canonical serialisation', () => {
  it('names the v2 fields in a fixed order (changing it needs a new version)', () => {
    expect(CANONICAL_FIELD_NAMES).toEqual([
      'patient_id', 'provider_npi', 'pharmacy', 'medication', 'sig_mode', 'sig_text', 'titration_steps',
      'cycle_on_days', 'cycle_off_days', 'quantity', 'dispense_quantity', 'dispense_unit', 'days_supply', 'refills',
      'package_id', 'package_label', 'package_count', 'syringe_option', 'substitution_allowed', 'shipping_type',
      'clinical_difference', 'diagnosis_code', 'diagnosis_text', 'special_instructions', 'allergies',
    ])
    const parsed = JSON.parse(canonicalSignedContent(order(), SULFA)) as Array<[string, unknown]>
    expect(parsed.map(([k]) => k)).toEqual(CANONICAL_FIELD_NAMES)
  })

  it('is the same whatever order the object keys come in, and whether a column is missing or null', () => {
    const a = order()
    const shuffled = Object.fromEntries(Object.entries(a).reverse()) as unknown as SignedOrderRow
    shuffled.medication_snapshot = { compounding: { ingredients: [{ status: 'bulks_list', name: 'Semaglutide' }], checked_at: SIGNED_AT }, form: 'injection', strength: '2.5 mg/mL', medication_name: 'Semaglutide' }
    expect(canonicalSignedContent(shuffled, SULFA)).toBe(canonicalSignedContent(a, SULFA))

    const withoutPackage = order()
    delete withoutPackage.package_id
    expect(canonicalSignedContent(withoutPackage, SULFA)).toBe(canonicalSignedContent(order({ package_id: null }), SULFA))
  })

  it('does not depend on the columns that are not signed content (status, ids of the row, the hash itself)', () => {
    const base = canonicalSignedContent(order(), SULFA)
    expect(canonicalSignedContent(order({ status: 'FAX_QUEUED', provider_signature_hash_snapshot: 'x' }), SULFA)).toBe(base)
  })

  it('a pinned vector: the same content always gives the same binding', () => {
    const content = canonicalSignedContent(order(), SULFA)
    expect(signatureBinding(DIGEST, SIGNED_AT, content)).toBe(signatureBinding(DIGEST, SIGNED_AT, content))
    expect(signatureBinding(DIGEST, SIGNED_AT, content)).toMatch(/^[0-9a-f]{64}$/)
    // Postgres may spell the same instant differently.
    expect(signatureBinding(DIGEST, '2026-10-25 14:03:07.123+00:00', content)).toBe(signatureBinding(DIGEST, SIGNED_AT, content))
  })
})

describe('any change is detected', () => {
  const content = canonicalSignedContent(order(), SULFA)
  const binding = signatureBinding(DIGEST, SIGNED_AT, content)

  const changes: Array<[string, Partial<SignedOrderRow>]> = [
    ['medication', { medication_snapshot: { ...(order().medication_snapshot as object), medication_name: 'Tirzepatide' } }],
    ['strength', { medication_snapshot: { ...(order().medication_snapshot as object), strength: '5 mg/mL' } }],
    ['compounding record', { medication_snapshot: { ...(order().medication_snapshot as object), compounding: { checked_at: SIGNED_AT, ingredients: [] } } }],
    ['dose / sig', { sig_text: 'Inject 2.5 mg weekly' }],
    ['sig mode', { sig_mode: 'titration' }],
    ['titration steps', { titration_steps: [{ dose: '10', unit: 'units', frequency: 'QW', weeks: 4 }] }],
    ['cycling', { cycle_on_days: 5 }],
    ['quantity', { quantity: 2 }],
    ['quantity as a string', { quantity: '1' }],
    ['dispense quantity', { dispense_quantity: 2 }],
    ['dispense unit', { dispense_unit: 'mL' }],
    ['days supply', { days_supply: 56 }],
    ['refills', { refills: 3 }],
    ['package', { package_id: 'pkg-1' }],
    ['package label', { package_label: '3 vials' }],
    ['package count', { package_count: 3 }],
    ['syringes', { syringe_option: 'none' }],
    ['substitution', { substitution_allowed: false }],
    ['shipping type', { shipping_type: 'overnight' }],
    ['clinical difference', { clinical_difference: null }],
    ['diagnosis code', { diagnosis_code: 'E11.9' }],
    ['diagnosis text', { diagnosis_text: 'Type 2 diabetes' }],
    ['special instructions', { special_instructions: null }],
    ['patient', { patient_id: 'pt-2' }],
    ['provider NPI', { provider_npi_snapshot: '1987654321' }],
    ['pharmacy', { pharmacy_snapshot: { pharmacy_id: 'ph-2', name: 'Other' } }],
  ]

  it.each(changes)('%s', (_name, change) => {
    expect(signatureBinding(DIGEST, SIGNED_AT, canonicalSignedContent(order(change), SULFA))).not.toBe(binding)
  })

  it('the allergy status: NKDA, another allergy, nothing recorded', () => {
    for (const p of [{ allergies: [], nkda: true }, { allergies: ['Sulfa', 'Penicillin'], nkda: false }, { allergies: [], nkda: false }, null]) {
      expect(signatureBinding(DIGEST, SIGNED_AT, canonicalSignedContent(order(), p))).not.toBe(binding)
    }
  })

  it('the signature and the signing time', () => {
    expect(signatureBinding('b'.repeat(64), SIGNED_AT, content)).not.toBe(binding)
    expect(signatureBinding(DIGEST, '2026-10-25T14:03:07.124Z', content)).not.toBe(binding)
  })
})

describe('the stored value', () => {
  it('v2:<signature digest>:<binding>, parsed back; a bare 64-hex digest is legacy', () => {
    const v = boundSignatureValue(DIGEST, SIGNED_AT, canonicalSignedContent(order(), SULFA))
    expect(v).toMatch(/^v2:a{64}:[0-9a-f]{64}$/)
    expect(parseSignatureValue(v)).toEqual({ kind: 'bound', signatureDigest: DIGEST, binding: v.slice(68) })
    expect(parseSignatureValue(DIGEST)).toEqual({ kind: 'legacy' })
    expect(parseSignatureValue(null)).toEqual({ kind: 'none' })
    expect(parseSignatureValue('')).toEqual({ kind: 'none' })
    for (const bad of ['v2:abc:def', `v3:${DIGEST}:${DIGEST}`, `v2:${DIGEST}`, 'not a hash']) {
      expect(parseSignatureValue(bad)).toEqual({ kind: 'malformed' })
    }
  })

  it('verifies the order as it is now', () => {
    const value = boundSignatureValue(DIGEST, SIGNED_AT, canonicalSignedContent(order(), SULFA))
    expect(verifySignatureBinding(order({ provider_signature_hash_snapshot: value }), SULFA)).toBe('match')
    expect(verifySignatureBinding(order({ provider_signature_hash_snapshot: value, refills: 5 }), SULFA)).toBe('mismatch')
    expect(verifySignatureBinding(order({ provider_signature_hash_snapshot: value }), { allergies: [], nkda: true })).toBe('mismatch')
    expect(verifySignatureBinding(order({ provider_signature_hash_snapshot: value, locked_at: '2026-10-25T14:03:08.000Z' }), SULFA)).toBe('mismatch')
    expect(verifySignatureBinding(order({ provider_signature_hash_snapshot: DIGEST }), SULFA)).toBe('legacy')
    expect(verifySignatureBinding(order({ provider_signature_hash_snapshot: 'v2:junk' }), SULFA)).toBe('mismatch')
    expect(verifySignatureBinding(order({ provider_signature_hash_snapshot: value, locked_at: null }), SULFA)).toBe('unsigned')
    expect(verifySignatureBinding(order({ provider_signature_hash_snapshot: null }), SULFA)).toBe('unsigned')
  })
})
