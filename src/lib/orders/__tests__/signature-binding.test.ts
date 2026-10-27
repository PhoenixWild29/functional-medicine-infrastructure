/**
 * @jest-environment node
 *
 * HIPAA B7, after B's review (T1, T2, T6): the signature binds the
 * prescription as the pharmacy receives it, under a server-held key.
 *
 * - v3 binding is HMAC-SHA256 keyed by RX_BINDING_SECRET: without the key a
 *   value cannot be computed, so a forged one is refused.
 * - The canonical serialisation is stable (field order fixed, object key
 *   order and timestamp spelling irrelevant) and any change to the bound
 *   content (patient name, DOB, allergy status, prescriber, ship-to,
 *   pharmacy, the Rx) changes the binding.
 * - "Legacy" (a bare 64-hex digest) is accepted only with the signing
 *   history row the service wrote before the cutoff; never for any 64-hex.
 * - A pharmacy change is accepted only with the ops reroute's keyed proof.
 * - With no key in production, binding throws (fail closed).
 */

import {
  CANONICAL_FIELD_NAMES,
  SIGNATURE_BINDING_VERSION,
  boundSignatureValue,
  canonicalSignedContent,
  legacySignatureProven,
  legacySigningCutoff,
  parseSignatureValue,
  patientSnapshotFor,
  prescriberSnapshotFor,
  rerouteBinding,
  rerouteProven,
  rxBindingKeyConfigured,
  bindingKeyRequired,
  signatureBinding,
  verifySignatureBinding,
  type SignedOrderRow,
} from '../signature-binding'

const DIGEST = 'a'.repeat(64)
const SIGNED_AT = '2026-10-25T14:03:07.123Z'
const env = process.env as Record<string, string | undefined>

const LEGACY_CUTOFF = '2026-11-01T00:00:00.000Z'
beforeEach(() => {
  env['RX_BINDING_SECRET'] = 'test-binding-secret-0123456789abcdef'
  env['RX_LEGACY_CUTOFF'] = LEGACY_CUTOFF
  delete env['RX_BINDING_SECRET_PREVIOUS']
  delete env['VERCEL_ENV']
  delete env['VERCEL']
})
afterAll(() => { delete env['RX_BINDING_SECRET']; delete env['RX_BINDING_SECRET_PREVIOUS'] })

const PATIENT = { first_name: 'Alex', last_name: 'Demo', date_of_birth: '1985-06-15', allergies: ['Sulfa'], nkda: false }
const PRESCRIBER = { provider_id: 'pr-1', first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567893', dea_number: 'BC1234563', license_state: 'TX' }

function order(over: Partial<SignedOrderRow> = {}): SignedOrderRow {
  return {
    order_id: 'o-1', status: 'SUBMISSION_PENDING', locked_at: SIGNED_AT, provider_signature_hash_snapshot: null,
    patient_id: 'pt-1', provider_npi_snapshot: '1234567893', pharmacy_id: 'ph-1', reroute_count: 0,
    patient_snapshot: patientSnapshotFor(PATIENT), prescriber_snapshot: prescriberSnapshotFor(PRESCRIBER),
    pharmacy_snapshot: { pharmacy_id: 'ph-1', name: 'Strive' },
    medication_snapshot: { medication_name: 'Semaglutide', strength: '2.5 mg/mL', form: 'injection', compounding: { checked_at: SIGNED_AT, ingredients: [{ name: 'Semaglutide', status: 'bulks_list' }] } },
    sig_mode: 'standard', sig_text: 'Inject 0.25 mg weekly', titration_steps: [], cycle_on_days: null, cycle_off_days: null,
    quantity: 1, dispense_quantity: 1, dispense_unit: 'vial', days_supply: 28, refills: 2,
    package_id: null, package_label: null, package_count: 1, syringe_option: 'insulin_29g', substitution_allowed: true,
    shipping_type: 'standard',
    shipping_address_line1_snapshot: '1 Main St', shipping_address_line2_snapshot: null, shipping_city_snapshot: 'Austin',
    shipping_zip_snapshot: '78701', shipping_state_snapshot: 'TX',
    clinical_difference: 'Patient needs a dose not available commercially',
    diagnosis_code: 'E66.9', diagnosis_text: 'Obesity', special_instructions: 'Keep refrigerated',
    ...over,
  }
}
const signed = (over: Partial<SignedOrderRow> = {}) => {
  const o = order(over)
  return { ...o, provider_signature_hash_snapshot: boundSignatureValue(DIGEST, SIGNED_AT, canonicalSignedContent(o)) }
}

describe('the snapshots taken at signing', () => {
  it('patient: name, date of birth and the allergy status the provider saw', () => {
    expect(patientSnapshotFor(PATIENT)).toEqual({
      first_name: 'Alex', last_name: 'Demo', date_of_birth: '1985-06-15', allergy_status: { kind: 'recorded', allergies: ['Sulfa'] },
    })
    expect(patientSnapshotFor({ ...PATIENT, allergies: [], nkda: true }).allergy_status).toEqual({ kind: 'nkda' })
  })

  it('prescriber: name, NPI, DEA and license state', () => {
    expect(prescriberSnapshotFor(PRESCRIBER)).toEqual({
      provider_id: 'pr-1', first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567893', dea_number: 'BC1234563', license_state: 'TX',
    })
  })
})

describe('the canonical serialisation (v3)', () => {
  it('names the v3 fields in a fixed order (changing it needs a new version)', () => {
    expect(SIGNATURE_BINDING_VERSION).toBe('v3')
    expect(CANONICAL_FIELD_NAMES).toEqual([
      'patient_id', 'patient', 'prescriber', 'provider_npi', 'pharmacy', 'medication', 'sig_mode', 'sig_text', 'titration_steps',
      'cycle_on_days', 'cycle_off_days', 'quantity', 'dispense_quantity', 'dispense_unit', 'days_supply', 'refills',
      'package_id', 'package_label', 'package_count', 'syringe_option', 'substitution_allowed', 'shipping_type', 'ship_to',
      'clinical_difference', 'diagnosis_code', 'diagnosis_text', 'special_instructions',
    ])
    const parsed = JSON.parse(canonicalSignedContent(order())) as Array<[string, unknown]>
    expect(parsed.map(([k]) => k)).toEqual(CANONICAL_FIELD_NAMES)
  })

  it('is the same whatever order the object keys come in, and whether a column is missing or null', () => {
    const a = order()
    const shuffled = Object.fromEntries(Object.entries(a).reverse()) as unknown as SignedOrderRow
    shuffled.patient_snapshot = Object.fromEntries(Object.entries(a.patient_snapshot as object).reverse())
    expect(canonicalSignedContent(shuffled)).toBe(canonicalSignedContent(a))
    const without = order()
    delete without.package_id
    expect(canonicalSignedContent(without)).toBe(canonicalSignedContent(order({ package_id: null })))
  })

  it('does not depend on status, the live pharmacy_id, reroute_count or the hash itself', () => {
    const base = canonicalSignedContent(order())
    expect(canonicalSignedContent(order({ status: 'FAX_QUEUED', pharmacy_id: 'ph-2', reroute_count: 1, provider_signature_hash_snapshot: 'x' }))).toBe(base)
  })
})

describe('the binding is keyed (T1)', () => {
  const content = canonicalSignedContent(order())

  it('HMAC-SHA256: 64 hex, stable, and different under another key', () => {
    const b = signatureBinding(DIGEST, SIGNED_AT, content)
    expect(b).toMatch(/^[0-9a-f]{64}$/)
    expect(signatureBinding(DIGEST, '2026-10-25 14:03:07.123+00:00', content)).toBe(b)
    env['RX_BINDING_SECRET'] = 'another-secret-entirely-0123456789'
    expect(signatureBinding(DIGEST, SIGNED_AT, content)).not.toBe(b)
  })

  it('is not the unkeyed SHA-256 a client could compute', () => {
    const { createHash } = jest.requireActual('node:crypto') as typeof import('node:crypto')
    const unkeyed = createHash('sha256').update(`compoundiq/rx-signature-binding/v3\n${DIGEST}\n${SIGNED_AT}\n${content}`).digest('hex')
    expect(signatureBinding(DIGEST, SIGNED_AT, content)).not.toBe(unkeyed)
  })

  it('a value computed under a guessed key is a mismatch', () => {
    const real = signed()
    env['RX_BINDING_SECRET'] = 'attacker-guess-0000000000000000000'
    const forged = { ...order({ sig_text: 'Inject 2.5 mg daily', refills: 11 }) }
    forged.provider_signature_hash_snapshot = boundSignatureValue(DIGEST, SIGNED_AT, canonicalSignedContent(forged))
    env['RX_BINDING_SECRET'] = 'test-binding-secret-0123456789abcdef'
    expect(verifySignatureBinding(real)).toBe('match')
    expect(verifySignatureBinding(forged)).toBe('mismatch')
  })

  it("D's finding 2: the development key only under NODE_ENV test or development, and never on a Vercel deployment", () => {
    delete env['RX_BINDING_SECRET']
    expect(rxBindingKeyConfigured()).toBe(false)
    // jest: NODE_ENV=test, not on Vercel.
    expect(bindingKeyRequired()).toBe(false)
    expect(() => signatureBinding(DIGEST, SIGNED_AT, content)).not.toThrow()
    const missing = expect.objectContaining({ name: 'BindingKeyMissingError' })
    for (const vercel of [{ VERCEL_ENV: 'production' }, { VERCEL_ENV: 'preview' }, { VERCEL: '1' }]) {
      Object.assign(env, vercel)
      expect(bindingKeyRequired()).toBe(true)
      expect(() => signatureBinding(DIGEST, SIGNED_AT, content)).toThrow(missing)
      expect(() => rerouteBinding('o-1', 'v3:x', 'ph-2', 1)).toThrow(missing)
      delete env['VERCEL_ENV']; delete env['VERCEL']
    }
    // Any other NODE_ENV (next start, a non-Vercel host): required too.
    const was = env['NODE_ENV']
    env['NODE_ENV'] = 'production'
    try {
      expect(bindingKeyRequired()).toBe(true)
      expect(() => signatureBinding(DIGEST, SIGNED_AT, content)).toThrow(missing)
    } finally { env['NODE_ENV'] = was }
    env['RX_BINDING_SECRET'] = 'set-again-0123456789abcdef0123456789'
    env['VERCEL_ENV'] = 'preview'
    expect(rxBindingKeyConfigured()).toBe(true)
    expect(() => signatureBinding(DIGEST, SIGNED_AT, content)).not.toThrow()
  })
})

describe('any change is detected', () => {
  const binding = signatureBinding(DIGEST, SIGNED_AT, canonicalSignedContent(order()))
  const changes: Array<[string, Partial<SignedOrderRow>]> = [
    ['patient first name', { patient_snapshot: { ...patientSnapshotFor(PATIENT), first_name: 'Alexa' } }],
    ['patient date of birth', { patient_snapshot: { ...patientSnapshotFor(PATIENT), date_of_birth: '1985-06-16' } }],
    ['allergy status', { patient_snapshot: patientSnapshotFor({ ...PATIENT, allergies: [], nkda: true }) }],
    ['prescriber name', { prescriber_snapshot: { ...prescriberSnapshotFor(PRESCRIBER), last_name: 'Patel' } }],
    ['prescriber DEA', { prescriber_snapshot: { ...prescriberSnapshotFor(PRESCRIBER), dea_number: null } }],
    ['prescriber license state', { prescriber_snapshot: { ...prescriberSnapshotFor(PRESCRIBER), license_state: 'CA' } }],
    ['medication', { medication_snapshot: { ...(order().medication_snapshot as object), medication_name: 'Tirzepatide' } }],
    ['strength', { medication_snapshot: { ...(order().medication_snapshot as object), strength: '5 mg/mL' } }],
    ['dose / sig', { sig_text: 'Inject 2.5 mg weekly' }],
    ['titration steps', { titration_steps: [{ dose: '10', unit: 'units', frequency: 'QW', weeks: 4 }] }],
    ['quantity', { quantity: 2 }],
    ['dispense unit', { dispense_unit: 'mL' }],
    ['days supply', { days_supply: 56 }],
    ['refills', { refills: 3 }],
    ['syringes', { syringe_option: 'none' }],
    ['shipping type', { shipping_type: 'overnight' }],
    ['ship-to street', { shipping_address_line1_snapshot: '2 Main St' }],
    ['ship-to state', { shipping_state_snapshot: 'CA' }],
    ['clinical difference', { clinical_difference: null }],
    ['diagnosis', { diagnosis_code: 'E11.9' }],
    ['special instructions', { special_instructions: null }],
    ['patient', { patient_id: 'pt-2' }],
    ['provider NPI', { provider_npi_snapshot: '1987654321' }],
    ['signed pharmacy', { pharmacy_snapshot: { pharmacy_id: 'ph-2', name: 'Other' } }],
  ]
  it.each(changes)('%s', (_n, change) => {
    expect(signatureBinding(DIGEST, SIGNED_AT, canonicalSignedContent(order(change)))).not.toBe(binding)
  })
})

describe('the stored value', () => {
  it('v3:<digest>:<hmac>; a bare digest parses as legacy; v2 and anything else is malformed', () => {
    const v = boundSignatureValue(DIGEST, SIGNED_AT, canonicalSignedContent(order()))
    expect(v).toMatch(/^v3:a{64}:[0-9a-f]{64}$/)
    expect(parseSignatureValue(v)).toEqual({ kind: 'bound', signatureDigest: DIGEST, binding: v.slice(68) })
    expect(parseSignatureValue(DIGEST)).toEqual({ kind: 'legacy' })
    expect(parseSignatureValue(null)).toEqual({ kind: 'none' })
    for (const bad of [`v2:${DIGEST}:${DIGEST}`, 'v3:abc:def', `v3:${DIGEST}`, 'not a hash']) expect(parseSignatureValue(bad)).toEqual({ kind: 'malformed' })
  })

  it('verifies the order as it is now', () => {
    const s = signed()
    expect(verifySignatureBinding(s)).toBe('match')
    expect(verifySignatureBinding({ ...s, refills: 5 })).toBe('mismatch')
    expect(verifySignatureBinding({ ...s, locked_at: '2026-10-25T14:03:08.000Z' })).toBe('mismatch')
    expect(verifySignatureBinding({ ...s, provider_signature_hash_snapshot: DIGEST })).toBe('legacy')
    expect(verifySignatureBinding({ ...s, provider_signature_hash_snapshot: 'v3:junk' })).toBe('mismatch')
    expect(verifySignatureBinding({ ...s, locked_at: null })).toBe('unsigned')
    expect(verifySignatureBinding({ ...s, provider_signature_hash_snapshot: null })).toBe('unsigned')
  })
})

describe('legacy only by the rule (T1)', () => {
  const before = new Date(Date.parse(LEGACY_CUTOFF) - 86_400_000).toISOString()
  const after  = new Date(Date.parse(LEGACY_CUTOFF) + 1_000).toISOString()
  const legacy = (signedAt = before, hash = DIGEST) => ({ provider_signature_hash_snapshot: hash, locked_at: signedAt })
  const batchRow = (over: Record<string, unknown> = {}, at = before) => ({
    old_status: 'DRAFT', new_status: 'AWAITING_PAYMENT', created_at: at,
    metadata: { actor: 'provider_batch_sign', signed_at: at, signature_hash: DIGEST, ...over },
  })
  const signAndSendRow = (over: Record<string, unknown> = {}, at = before) => ({
    old_status: 'DRAFT', new_status: 'AWAITING_PAYMENT', created_at: at,
    metadata: { actor: 'provider_sign_and_send', signed_at: at, ...over },
  })

  it('a bare digest with the matching batch-sign history row from before the cutoff is legacy', () => {
    expect(legacySignatureProven(legacy(), [batchRow()])).toBe(true)
  })

  it("D's finding 7: the older sign-and-send row is tied to this signing by its signed_at (it never recorded a digest), and by its digest when it has one", () => {
    expect(legacySignatureProven(legacy(), [signAndSendRow()])).toBe(true)
    // Another signing time: not this order's signature.
    expect(legacySignatureProven(legacy(), [signAndSendRow({ signed_at: after })])).toBe(false)
    expect(legacySignatureProven(legacy(), [signAndSendRow({ signed_at: undefined })])).toBe(false)
    // A row that does carry a digest must carry this one.
    expect(legacySignatureProven(legacy(), [signAndSendRow({ signature_hash: DIGEST })])).toBe(true)
    expect(legacySignatureProven(legacy('', '0'.repeat(64)), [signAndSendRow({ signature_hash: DIGEST })])).toBe(false)
    expect(legacySignatureProven(legacy(before, '0'.repeat(64)), [signAndSendRow({ signature_hash: DIGEST })])).toBe(false)
  })

  it('is refused for any other 64-hex: no row, another hash, another signing time, after the cutoff, a binding marker, or another actor', () => {
    expect(legacySignatureProven(legacy(before, '0'.repeat(64)), [])).toBe(false)
    expect(legacySignatureProven(legacy(before, '0'.repeat(64)), [batchRow()])).toBe(false)
    expect(legacySignatureProven(legacy(), [batchRow({ signed_at: after })])).toBe(false)
    expect(legacySignatureProven(legacy(after), [batchRow({}, after)])).toBe(false)
    expect(legacySignatureProven(legacy(), [batchRow({ signature_binding: 'v3' })])).toBe(false)
    expect(legacySignatureProven(legacy(), [batchRow({ actor: 'clinic_user' })])).toBe(false)
    expect(legacySignatureProven(legacy(), [{ ...batchRow(), new_status: 'PAID_PROCESSING' }])).toBe(false)
  })

  it("D's finding 4: the cutoff comes from RX_LEGACY_CUTOFF; unset or not a date means no legacy at all", () => {
    expect(legacySigningCutoff()).toBe(Date.parse(LEGACY_CUTOFF))
    delete env['RX_LEGACY_CUTOFF']
    expect(legacySigningCutoff()).toBeNull()
    expect(legacySignatureProven(legacy(), [batchRow()])).toBe(false)
    env['RX_LEGACY_CUTOFF'] = 'not a date'
    expect(legacySigningCutoff()).toBeNull()
    expect(legacySignatureProven(legacy(), [batchRow()])).toBe(false)
    env['RX_LEGACY_CUTOFF'] = '2020-01-01T00:00:00Z'
    expect(legacySignatureProven(legacy(), [batchRow()])).toBe(false)
  })
})

describe("D's finding 3: key rotation", () => {
  const OLD = 'old-binding-secret-0123456789abcdef0'
  const NEW = 'new-binding-secret-0123456789abcdef0'

  it('an order signed under the previous key still verifies; new bindings use the current key only', () => {
    env['RX_BINDING_SECRET'] = OLD
    const signedUnderOld = signed()
    const oldBinding = signedUnderOld.provider_signature_hash_snapshot!.split(':')[2]
    env['RX_BINDING_SECRET'] = NEW
    expect(verifySignatureBinding(signedUnderOld)).toBe('mismatch')
    env['RX_BINDING_SECRET_PREVIOUS'] = OLD
    expect(verifySignatureBinding(signedUnderOld)).toBe('match')
    // Altered content under the previous key is still a mismatch.
    expect(verifySignatureBinding({ ...signedUnderOld, refills: 9 })).toBe('mismatch')
    // A new binding is made with the current key, never the previous one.
    expect(signatureBinding(DIGEST, SIGNED_AT, canonicalSignedContent(order()))).not.toBe(oldBinding)
    expect(verifySignatureBinding(signed())).toBe('match')
  })

  it('a reroute proof made under the previous key is accepted too; never under a third key', () => {
    env['RX_BINDING_SECRET'] = OLD
    const s = { ...signed(), pharmacy_id: 'ph-2', reroute_count: 1 }
    const row = { old_status: 'FAX_FAILED', new_status: 'REROUTE_PENDING', created_at: '2026-10-26T10:00:00Z',
      metadata: { reason: 'ops_reroute', reroute_count: 1, new_pharmacy_id: 'ph-2', reroute_binding: rerouteBinding('o-1', s.provider_signature_hash_snapshot!, 'ph-2', 1) } }
    env['RX_BINDING_SECRET'] = NEW
    expect(rerouteProven(s, [row])).toBe(false)
    env['RX_BINDING_SECRET_PREVIOUS'] = OLD
    expect(rerouteProven(s, [row])).toBe(true)
    env['RX_BINDING_SECRET_PREVIOUS'] = 'some-third-key-0123456789abcdef01234'
    expect(rerouteProven(s, [row])).toBe(false)
  })
})

describe('a pharmacy change only through the ops reroute (T2)', () => {
  const s = { ...signed(), pharmacy_id: 'ph-2', reroute_count: 1 }
  const row = (over: Record<string, unknown> = {}, at = '2026-10-26T10:00:00.000Z') => ({
    old_status: 'FAX_FAILED', new_status: 'REROUTE_PENDING', created_at: at,
    metadata: {
      reason: 'ops_reroute', reroute_count: 1, new_pharmacy_id: 'ph-2',
      reroute_binding: rerouteBinding('o-1', s.provider_signature_hash_snapshot!, 'ph-2', 1), ...over,
    },
  })

  it("the reroute's keyed proof for the current pharmacy is accepted", () => {
    expect(rerouteProven(s, [row()])).toBe(true)
  })

  it('refused: no proof, a forged proof, a proof for another pharmacy, or a later reroute elsewhere', () => {
    expect(rerouteProven(s, [])).toBe(false)
    expect(rerouteProven(s, [row({ reroute_binding: 'f'.repeat(64) })])).toBe(false)
    expect(rerouteProven(s, [row({ new_pharmacy_id: 'ph-3' })])).toBe(false)
    expect(rerouteProven(s, [row(), row({ new_pharmacy_id: 'ph-3', reroute_binding: rerouteBinding('o-1', s.provider_signature_hash_snapshot!, 'ph-3', 2), reroute_count: 2 }, '2026-10-26T11:00:00.000Z')])).toBe(false)
  })

  it('the proof is bound to this order and its signature', () => {
    expect(rerouteBinding('o-1', 'v3:a', 'ph-2', 1)).not.toBe(rerouteBinding('o-2', 'v3:a', 'ph-2', 1))
    expect(rerouteBinding('o-1', 'v3:a', 'ph-2', 1)).not.toBe(rerouteBinding('o-1', 'v3:b', 'ph-2', 1))
  })
})
