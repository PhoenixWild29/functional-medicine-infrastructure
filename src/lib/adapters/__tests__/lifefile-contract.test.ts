/**
 * @jest-environment node
 *
 * LF-2: Mocked contract test for the LifeFile / ePowerRx adapter pair.
 *
 * The LifeFile transformer + parser are stubbed in the codebase but
 * not yet wired to a real pharmacy_api_configs row (Strive is still
 * TIER_4_FAX pending BAA + API docs + credentials from Lauren).
 *
 * This test locks the contract so that when LifeFile's docs arrive
 * and someone wires a real pharmacy_api_configs row, the existing
 * code shape is known to work — no regression from later refactors,
 * and the registry name strings are documented.
 *
 * Coverage:
 *   1. transformLifeFilePayload — full nested-prescription shape +
 *      all OrderPayload field mappings, including null-coalesce paths
 *      (deaNumber undefined when null, address fields → '' when null).
 *   2. parseLifeFileResponse — accepted (200/201 + status=ACCEPTED),
 *      rejected (400 + status=REJECTED), transient/unknown (5xx,
 *      ambiguous 2xx, malformed body).
 *   3. Registry lookup by string name (the string lives in
 *      pharmacy_api_configs.{payload_transformer,response_parser}).
 *
 * When real LifeFile credentials land, the next steps are:
 *   - Add a recorded sample from the LifeFile sandbox to this file
 *     as a real fixture and assert against the actual response shape.
 *   - Add a PHI-redaction contract test (no PHI in error logs).
 */

import { getTransformer, type OrderPayload } from '@/lib/adapters/transformers'
import { getParser } from '@/lib/adapters/parsers'

// ── Local shape lens ───────────────────────────────────────────────
// Mirrors transformLifeFilePayload's documented nested-prescription
// output so tests can dereference fields without tripping
// `noUncheckedIndexedAccess`. PharmacyPayload is Record<string, unknown>
// which would force every nested access through optional chaining +
// casts — this typed lens is equivalent, more readable, and locks the
// shape contract.

interface LifeFilePayloadShape {
  clientReferenceId: string
  prescription: {
    prescriber: {
      firstName:    string
      lastName:     string
      npiNumber:    string
      deaNumber?:   string
      licenseState: string
    }
    patient: {
      firstName:   string
      lastName:    string
      dateOfBirth: string
      address: {
        street1: string
        street2: string
        city:    string
        state:   string
        zipCode: string
      }
    }
    drug: {
      brandName:  string
      dosageForm: string
      strength:   string
      quantity:   number
      directions: string
    }
    clinic: string
  }
}

// ── Canonical fixture: a well-formed OrderPayload ──────────────────

function makePayload(overrides: Partial<OrderPayload> = {}): OrderPayload {
  return {
    orderId:               'order-uuid-1',
    orderNumber:           'CMP-1001',
    providerFirstName:     'Sarah',
    providerLastName:      'Chen',
    providerNpi:           '1234567890',
    providerDea:           'BC1234563',
    providerLicenseState:  'TX',
    patientFirstName:      'Alex',
    patientLastName:       'Demo',
    patientDateOfBirth:    '1985-06-15',
    patientAddressLine1:   '123 Main St',
    patientAddressLine2:   'Apt 4',
    patientCity:           'Austin',
    patientState:          'TX',
    patientZip:            '78701',
    medicationName:        'Compounded Test Med',
    medicationForm:        'Injectable',
    medicationDose:        '200mg/mL',
    quantity:              30,
    sigText:               'Inject 0.5mL weekly',
    clinicName:            'Sunrise Functional Medicine',
    ...overrides,
  }
}

// ── Transformer contract ───────────────────────────────────────────

describe('transformLifeFilePayload — registry lookup + shape', () => {
  it('is registered under the exact string "transformLifeFilePayload"', () => {
    const fn = getTransformer('transformLifeFilePayload')
    expect(typeof fn).toBe('function')
  })

  it('produces the documented LifeFile nested-prescription shape', () => {
    const transform = getTransformer('transformLifeFilePayload')
    const out = transform(makePayload())

    expect(out).toEqual({
      clientReferenceId: 'order-uuid-1',
      prescription: {
        prescriber: {
          firstName:    'Sarah',
          lastName:     'Chen',
          npiNumber:    '1234567890',
          deaNumber:    'BC1234563',
          licenseState: 'TX',
        },
        patient: {
          firstName:    'Alex',
          lastName:     'Demo',
          dateOfBirth:  '1985-06-15',
          address: {
            street1: '123 Main St',
            street2: 'Apt 4',
            city:    'Austin',
            state:   'TX',
            zipCode: '78701',
          },
        },
        drug: {
          brandName:  'Compounded Test Med',
          dosageForm: 'Injectable',
          strength:   '200mg/mL',
          quantity:   30,
          directions: 'Inject 0.5mL weekly',
        },
        clinic: 'Sunrise Functional Medicine',
      },
    })
  })

  it('omits deaNumber when providerDea is null (non-controlled-substance prescriber)', () => {
    const transform = getTransformer('transformLifeFilePayload')
    const out = transform(makePayload({ providerDea: null })) as unknown as LifeFilePayloadShape
    // deaNumber is set to undefined, which JSON.stringify will drop entirely
    expect(out.prescription.prescriber.deaNumber).toBeUndefined()
  })

  it('null address fields are coerced to empty strings (LifeFile rejects null in address)', () => {
    const transform = getTransformer('transformLifeFilePayload')
    const out = transform(makePayload({
      patientAddressLine1: null,
      patientAddressLine2: null,
      patientCity:         null,
      patientState:        null,
      patientZip:          null,
    })) as unknown as LifeFilePayloadShape
    expect(out.prescription.patient.address).toEqual({
      street1: '',
      street2: '',
      city:    '',
      state:   '',
      zipCode: '',
    })
  })

  it('null sigText becomes empty directions string', () => {
    const transform = getTransformer('transformLifeFilePayload')
    const out = transform(makePayload({ sigText: null })) as unknown as LifeFilePayloadShape
    expect(out.prescription.drug.directions).toBe('')
  })
})

// ── Parser contract ────────────────────────────────────────────────

describe('parseLifeFileResponse — registry lookup + outcome classification', () => {
  it('is registered under the exact string "parseLifeFileResponse"', () => {
    const fn = getParser('parseLifeFileResponse')
    expect(typeof fn).toBe('function')
  })

  it('classifies 200 + status=ACCEPTED as accepted, extracts prescriptionId', () => {
    const parse = getParser('parseLifeFileResponse')
    const result = parse(200, { prescriptionId: 'lf-9876', status: 'ACCEPTED' })

    expect(result).toEqual({
      outcome:         'accepted',
      externalOrderId: 'lf-9876',
      errorCode:       null,
      errorMessage:    null,
    })
  })

  it('classifies 201 + status=ACCEPTED as accepted (created)', () => {
    const parse = getParser('parseLifeFileResponse')
    const result = parse(201, { prescriptionId: 'lf-9877', status: 'ACCEPTED' })
    expect(result.outcome).toBe('accepted')
    expect(result.externalOrderId).toBe('lf-9877')
  })

  it('classifies 400 + status=REJECTED as rejected, extracts code + reason', () => {
    const parse = getParser('parseLifeFileResponse')
    const result = parse(400, {
      status: 'REJECTED',
      code:   'DRUG_NOT_FORMULARY',
      reason: 'Medication not on LifeFile formulary',
    })

    expect(result).toEqual({
      outcome:         'rejected',
      externalOrderId: null,
      errorCode:       'DRUG_NOT_FORMULARY',
      errorMessage:    'Medication not on LifeFile formulary',
    })
  })

  it('falls back to outcome=rejected with default code when 400 has no explicit code', () => {
    const parse = getParser('parseLifeFileResponse')
    const result = parse(400, { status: 'REJECTED' })
    expect(result.outcome).toBe('rejected')
    expect(result.errorCode).toBe('REJECTED')
  })

  it('classifies 5xx as unknown (transient — eligible for retry)', () => {
    const parse = getParser('parseLifeFileResponse')
    const result = parse(503, { reason: 'Upstream timeout' })

    expect(result.outcome).toBe('unknown')
    expect(result.externalOrderId).toBeNull()
    expect(result.errorCode).toBe('503')
    expect(result.errorMessage).toBe('Upstream timeout')
  })

  it('classifies ambiguous 200 (no status field) as unknown', () => {
    const parse = getParser('parseLifeFileResponse')
    const result = parse(200, { prescriptionId: 'lf-orphan' }) // no status

    expect(result.outcome).toBe('unknown')
    // No externalOrderId extracted on the unknown path — only accepted extracts it
    expect(result.externalOrderId).toBeNull()
  })

  it('classifies 200 + status=REJECTED as unknown (not the documented 400 pattern)', () => {
    // The documented pattern is 400+REJECTED. If LifeFile ever sends 200+REJECTED,
    // we treat it as unknown so the cron retries rather than silently dropping.
    const parse = getParser('parseLifeFileResponse')
    const result = parse(200, { status: 'REJECTED' })
    expect(result.outcome).toBe('unknown')
  })

  it('handles a malformed body without throwing', () => {
    const parse = getParser('parseLifeFileResponse')
    const result = parse(200, {} as Record<string, unknown>)
    expect(result.outcome).toBe('unknown')
    expect(result.externalOrderId).toBeNull()
  })

  it('handles 400 without status=REJECTED as unknown', () => {
    const parse = getParser('parseLifeFileResponse')
    const result = parse(400, { error: 'Bad request' })
    expect(result.outcome).toBe('unknown')
    expect(result.errorCode).toBe('400')
  })

  // ── Codex-requested coverage (Section 5): 401/403/408/429 ─────
  // These should all classify as unknown rather than rejected — a
  // 'rejected' outcome means LifeFile explicitly refused the
  // prescription. Auth/timeout/rate-limit are operational issues
  // that should retry, not give up.
  it('401 unauthorized classifies as unknown (operational, not refusal)', () => {
    const parse = getParser('parseLifeFileResponse')
    const result = parse(401, { reason: 'Invalid API key' })
    expect(result.outcome).toBe('unknown')
    expect(result.errorCode).toBe('401')
  })

  it('403 forbidden classifies as unknown (operational, not refusal)', () => {
    const parse = getParser('parseLifeFileResponse')
    const result = parse(403, { reason: 'Account suspended' })
    expect(result.outcome).toBe('unknown')
    expect(result.errorCode).toBe('403')
  })

  it('408 request-timeout classifies as unknown (retryable)', () => {
    const parse = getParser('parseLifeFileResponse')
    const result = parse(408, { reason: 'Request timeout' })
    expect(result.outcome).toBe('unknown')
    expect(result.errorCode).toBe('408')
  })

  it('429 rate-limit classifies as unknown (retryable with backoff)', () => {
    const parse = getParser('parseLifeFileResponse')
    const result = parse(429, { reason: 'Rate limit exceeded' })
    expect(result.outcome).toBe('unknown')
    expect(result.errorCode).toBe('429')
  })
})
