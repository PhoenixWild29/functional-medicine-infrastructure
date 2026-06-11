/**
 * @jest-environment node
 *
 * PHI Redactor tests — Option B contract.
 *
 * Locks the behavior described in
 * `docs/audits/phi-policy-adapter-submissions.md`:
 *   - patient name / DOB / address / contact → redacted
 *   - medication name / form / dose / sig / quantity → redacted
 *   - provider DEA → redacted
 *   - non-PHI structural keys (orderId, transformer, url, NPI, clinic) → kept
 *   - fingerprint stable for identical input, distinct for distinct input
 *   - null / empty / deeply nested edge cases handled
 *
 * If a future pharmacy transformer adds a new PHI key shape, ADD a test
 * here and extend the PHI_KEY_PATTERNS list in the source.
 */

import {
  redactAdapterRequestPayload,
  computePayloadFingerprint,
  __TEST_ONLY__,
} from '@/lib/phi/redact-adapter-payload'

const { REDACTED_TOKEN } = __TEST_ONLY__

// ── Representative pharmacy payload (mirrors transformViosPayload output) ──
function buildViosLikePayload() {
  return {
    external_reference: 'ord_abc123',
    order_number:       'ORD-2026-0001',
    prescriber: {
      first_name:    'Sarah',
      last_name:     'Chen',
      npi:           '1234567890',
      dea:           'AB1234567',
      license_state: 'CA',
    },
    patient: {
      first_name:    'Jane',
      last_name:     'Doe',
      date_of_birth: '1985-04-12',
      address_line1: '123 Main St',
      address_line2: 'Apt 4B',
      city:          'San Francisco',
      state:         'CA',
      zip:           '94110',
    },
    medication: {
      name:     'Compounded Cream',
      form:     'cream',
      dose:     '5%',
      quantity: 30,
      sig:      'Apply twice daily to affected area',
    },
    clinic_name: 'CompoundIQ Clinic',
  }
}

describe('redactAdapterRequestPayload — PHI fields are stripped', () => {
  it('redacts patient identifiers (name, DOB, address, city, state, zip)', () => {
    const { redactedPayload } = redactAdapterRequestPayload(buildViosLikePayload())
    const patient = redactedPayload.patient as Record<string, unknown>

    expect(patient.first_name).toBe(REDACTED_TOKEN)
    expect(patient.last_name).toBe(REDACTED_TOKEN)
    expect(patient.date_of_birth).toBe(REDACTED_TOKEN)
    expect(patient.address_line1).toBe(REDACTED_TOKEN)
    expect(patient.address_line2).toBe(REDACTED_TOKEN)
    expect(patient.city).toBe(REDACTED_TOKEN)
    expect(patient.patient_state ?? patient.state).toBe(REDACTED_TOKEN)
    expect(patient.zip).toBe(REDACTED_TOKEN)
  })

  it('redacts medication detail (name, form, dose, sig, quantity)', () => {
    const { redactedPayload } = redactAdapterRequestPayload(buildViosLikePayload())
    const med = redactedPayload.medication as Record<string, unknown>

    expect(med.name).toBe(REDACTED_TOKEN)
    expect(med.form).toBe(REDACTED_TOKEN)
    expect(med.dose).toBe(REDACTED_TOKEN)
    expect(med.sig).toBe(REDACTED_TOKEN)
    expect(med.quantity).toBe(REDACTED_TOKEN)
  })

  it('redacts provider DEA but keeps NPI + license_state (non-PHI structural)', () => {
    const { redactedPayload } = redactAdapterRequestPayload(buildViosLikePayload())
    const prescriber = redactedPayload.prescriber as Record<string, unknown>

    expect(prescriber.dea).toBe(REDACTED_TOKEN)
    // NPI is a provider business identifier, not PHI under §164.514
    expect(prescriber.npi).toBe('1234567890')
    expect(prescriber.license_state).toBe('CA')
    // First/last name in a prescriber container are PHI by precaution
    // (a prescription identifies the prescriber, which when linked to
    // the patient becomes PHI). Confirm they are also stripped.
    expect(prescriber.first_name).toBe(REDACTED_TOKEN)
    expect(prescriber.last_name).toBe(REDACTED_TOKEN)
  })

  it('keeps non-PHI structural keys (orderId, order_number, clinic) intact', () => {
    const { redactedPayload } = redactAdapterRequestPayload(buildViosLikePayload())

    expect(redactedPayload.external_reference).toBe('ord_abc123')
    expect(redactedPayload.order_number).toBe('ORD-2026-0001')
    expect(redactedPayload.clinic_name).toBe('CompoundIQ Clinic')
  })

  it('redacts a flat (non-nested) payload that uses snake_case patient keys', () => {
    const flat = {
      external_reference:    'ord_xyz',
      patient_first_name:    'John',
      patient_last_name:     'Smith',
      patient_date_of_birth: '1970-01-01',
      patient_address_line1: '500 Market St',
      patient_zip:           '94105',
      medication_name:       'Test Compound',
      sig_text:              'Take 1 capsule daily',
    }
    const { redactedPayload } = redactAdapterRequestPayload(flat)

    expect(redactedPayload.external_reference).toBe('ord_xyz')
    expect(redactedPayload.patient_first_name).toBe(REDACTED_TOKEN)
    expect(redactedPayload.patient_last_name).toBe(REDACTED_TOKEN)
    expect(redactedPayload.patient_date_of_birth).toBe(REDACTED_TOKEN)
    expect(redactedPayload.patient_address_line1).toBe(REDACTED_TOKEN)
    expect(redactedPayload.patient_zip).toBe(REDACTED_TOKEN)
    expect(redactedPayload.medication_name).toBe(REDACTED_TOKEN)
    expect(redactedPayload.sig_text).toBe(REDACTED_TOKEN)
  })

  it('redacts camelCase variants (dateOfBirth, firstName, addressLine1, etc.)', () => {
    const camel = {
      orderId:       'ord_1',
      firstName:     'Alice',
      lastName:      'Lee',
      dateOfBirth:   '1992-08-15',
      addressLine1:  '99 Elm St',
      addressLine2:  null,
      city:          'Berkeley',
      zip:           '94704',
      sigText:       'Apply nightly',
      drugName:      'Tretinoin 0.05%',
      phoneNumber:   '555-0100',
      email:         'alice@example.com',
    }
    const { redactedPayload } = redactAdapterRequestPayload(camel)

    expect(redactedPayload.orderId).toBe('ord_1')
    expect(redactedPayload.firstName).toBe(REDACTED_TOKEN)
    expect(redactedPayload.lastName).toBe(REDACTED_TOKEN)
    expect(redactedPayload.dateOfBirth).toBe(REDACTED_TOKEN)
    expect(redactedPayload.addressLine1).toBe(REDACTED_TOKEN)
    expect(redactedPayload.addressLine2).toBe(REDACTED_TOKEN)
    expect(redactedPayload.city).toBe(REDACTED_TOKEN)
    expect(redactedPayload.zip).toBe(REDACTED_TOKEN)
    expect(redactedPayload.sigText).toBe(REDACTED_TOKEN)
    expect(redactedPayload.drugName).toBe(REDACTED_TOKEN)
    expect(redactedPayload.phoneNumber).toBe(REDACTED_TOKEN)
    expect(redactedPayload.email).toBe(REDACTED_TOKEN)
  })

  it('redacts inside a `body` container (the tier1-api shape wraps the pharmacy payload in `body`)', () => {
    const wrapped = {
      url:         'https://api.pharmacy.example/orders',
      method:      'POST',
      transformer: 'transformViosPayload',
      body:        buildViosLikePayload(),
    }
    const { redactedPayload } = redactAdapterRequestPayload(wrapped)

    expect(redactedPayload.url).toBe('https://api.pharmacy.example/orders')
    expect(redactedPayload.method).toBe('POST')
    expect(redactedPayload.transformer).toBe('transformViosPayload')

    const body = redactedPayload.body as Record<string, unknown>
    const patient = body.patient as Record<string, unknown>
    expect(patient.first_name).toBe(REDACTED_TOKEN)
    expect(patient.date_of_birth).toBe(REDACTED_TOKEN)
  })

  it('strips MRN, SSN, and other gov identifiers', () => {
    const { redactedPayload } = redactAdapterRequestPayload({
      orderId: 'ord_2',
      ssn: '123-45-6789',
      mrn: 'MRN-998877',
      patient: { medical_record_number: 'MRN-X' },
    })

    expect(redactedPayload.ssn).toBe(REDACTED_TOKEN)
    expect(redactedPayload.mrn).toBe(REDACTED_TOKEN)
    const patient = redactedPayload.patient as Record<string, unknown>
    expect(patient.medical_record_number).toBe(REDACTED_TOKEN)
  })
})

describe('redactAdapterRequestPayload — fingerprint behavior', () => {
  it('produces a stable fingerprint for two runs with identical payload', () => {
    const a = redactAdapterRequestPayload(buildViosLikePayload())
    const b = redactAdapterRequestPayload(buildViosLikePayload())
    expect(a.fingerprint).toBe(b.fingerprint)
    expect(a.fingerprint).toMatch(/^[0-9a-f]{64}$/) // SHA-256 hex
  })

  it('fingerprint is independent of key ORDER (canonicalization)', () => {
    const a = redactAdapterRequestPayload({ a: 1, b: 2, patient: { first_name: 'X', last_name: 'Y' } })
    const b = redactAdapterRequestPayload({ patient: { last_name: 'Y', first_name: 'X' }, b: 2, a: 1 })
    expect(a.fingerprint).toBe(b.fingerprint)
  })

  it('produces a DIFFERENT fingerprint when the payload differs', () => {
    const p1 = buildViosLikePayload()
    const p2 = buildViosLikePayload()
    ;(p2.patient as Record<string, unknown>).first_name = 'Jane2'

    const a = redactAdapterRequestPayload(p1)
    const b = redactAdapterRequestPayload(p2)
    expect(a.fingerprint).not.toBe(b.fingerprint)
  })

  it('exposes a standalone computePayloadFingerprint that matches the redactor result', () => {
    const payload = buildViosLikePayload()
    const direct = computePayloadFingerprint(payload)
    const { fingerprint } = redactAdapterRequestPayload(payload)
    expect(direct).toBe(fingerprint)
  })
})

describe('redactAdapterRequestPayload — edge cases', () => {
  it('handles null input gracefully', () => {
    const { redactedPayload, fingerprint } = redactAdapterRequestPayload(null)
    expect(redactedPayload).toEqual({})
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/)
  })

  it('handles undefined input gracefully', () => {
    const { redactedPayload, fingerprint } = redactAdapterRequestPayload(undefined)
    expect(redactedPayload).toEqual({})
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/)
  })

  it('handles an empty object', () => {
    const { redactedPayload, fingerprint } = redactAdapterRequestPayload({})
    expect(redactedPayload).toEqual({})
    // Empty object MUST hash to a stable, repeatable value
    expect(fingerprint).toBe(computePayloadFingerprint({}))
  })

  it('handles deeply nested PHI (4 levels deep)', () => {
    const deep = {
      level1: {
        level2: {
          level3: {
            patient: {
              first_name:    'Deep',
              last_name:     'Nested',
              date_of_birth: '2000-01-01',
            },
          },
        },
      },
    }
    const { redactedPayload } = redactAdapterRequestPayload(deep)
    const buried =
      ((((redactedPayload.level1 as Record<string, unknown>).level2 as Record<string, unknown>).level3 as Record<string, unknown>).patient as Record<string, unknown>)
    expect(buried.first_name).toBe(REDACTED_TOKEN)
    expect(buried.last_name).toBe(REDACTED_TOKEN)
    expect(buried.date_of_birth).toBe(REDACTED_TOKEN)
  })

  it('handles arrays of objects (e.g. multi-fill prescription line items)', () => {
    const withArray = {
      orderId: 'ord_3',
      line_items: [
        { drug_name: 'Cream A', dose: '1%', quantity: 30 },
        { drug_name: 'Cream B', dose: '2%', quantity: 60 },
      ],
    }
    const { redactedPayload } = redactAdapterRequestPayload(withArray)
    const items = redactedPayload.line_items as Array<Record<string, unknown>>
    expect(items).toHaveLength(2)
    expect(items[0]!.drug_name).toBe(REDACTED_TOKEN)
    expect(items[0]!.dose).toBe(REDACTED_TOKEN)
    expect(items[0]!.quantity).toBe(REDACTED_TOKEN)
    expect(items[1]!.drug_name).toBe(REDACTED_TOKEN)
  })

  it('passes primitives through when they are not PHI keys', () => {
    const { redactedPayload } = redactAdapterRequestPayload({
      url:         'https://example.com',
      method:      'POST',
      timeout_ms:  30000,
      is_active:   true,
      api_version: 'v1',
      tags:        ['a', 'b', 'c'],
    })

    expect(redactedPayload.url).toBe('https://example.com')
    expect(redactedPayload.method).toBe('POST')
    expect(redactedPayload.timeout_ms).toBe(30000)
    expect(redactedPayload.is_active).toBe(true)
    expect(redactedPayload.api_version).toBe('v1')
    expect(redactedPayload.tags).toEqual(['a', 'b', 'c'])
  })

  it('never returns the original PHI string anywhere in the redacted output', () => {
    const payload = buildViosLikePayload()
    const { redactedPayload } = redactAdapterRequestPayload(payload)
    const serialized = JSON.stringify(redactedPayload)

    // The most-distinctive PHI tokens in our fixture
    expect(serialized).not.toContain('Jane')
    expect(serialized).not.toContain('Doe')
    expect(serialized).not.toContain('1985-04-12')
    expect(serialized).not.toContain('123 Main St')
    expect(serialized).not.toContain('Apply twice daily')
    expect(serialized).not.toContain('AB1234567') // DEA
  })
})
