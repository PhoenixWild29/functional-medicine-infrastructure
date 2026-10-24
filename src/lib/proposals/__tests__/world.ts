// A clinic, two providers, a patient and the catalog rows batch sign
// reads, in the fake database (as lib/orders/__tests__/batch-sign.test.ts
// builds them), plus the proposal tables. Shared by the proposal tests;
// not a test file itself.

import { fakeDb } from '@/lib/orders/__tests__/fake-db'

export const CLINIC = 'c0000000-0000-4000-8000-000000000001'
export const USER_CHEN = 'u-chen'
export const USER_PATEL = 'u-patel'
export const USER_ADMIN = 'u-admin'
export const USER_MA = 'u-ma'
export const CHEN = 'p-chen'
export const PATEL = 'p-patel'
export const P1 = 'pat-1'
export const P2 = 'pat-2'
export const id = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`

export const CALLERS = {
  chen:  { userId: USER_CHEN,  role: 'provider' },
  patel: { userId: USER_PATEL, role: 'provider' },
  admin: { userId: USER_ADMIN, role: 'clinic_admin' },
  ma:    { userId: USER_MA,    role: 'medical_assistant' },
} as const

export function draft(n: number, over: Record<string, unknown> = {}) {
  return {
    order_id: id(n), status: 'DRAFT', clinic_id: CLINIC, is_active: true, deleted_at: null,
    patient_id: P1, provider_id: CHEN, catalog_item_id: null, formulation_id: 'f-plain',
    pharmacy_id: 'ph-strive', retail_price_snapshot: 200, wholesale_price_snapshot: 100,
    shipping_state_snapshot: 'TX',
    medication_snapshot: { medication_name: `Plain compound ${n}`, dea_schedule: 0 },
    package_id: null, package_count: 1, refills: 0, substitution_allowed: true,
    syringe_option: 'none', shipping_type: 'standard', clinical_difference: null,
    diagnosis_code: null, diagnosis_text: null, special_instructions: null,
    days_supply: 30, dispense_quantity: 1, dispense_unit: 'vial',
    sig_mode: 'standard', titration_steps: [], refill_of_order_id: null, payment_group_id: null,
    proposal_option_id: null, proposal_required: null,
    ...over,
  }
}

/** C8: a compoundable, reviewed ingredient unless told otherwise. */
export function ingredient(name: string, over: Record<string, unknown> = {}) {
  return {
    common_name: name, dea_schedule: null, compounding_status: 'approved_drug_component',
    commercial_equivalent: false, on_fda_shortage: false,
    compounding_status_source: 'FDA, 2026-10-01', compounding_status_reviewed_at: '2026-10-01T00:00:00.000Z',
    ...over,
  }
}

export type World = ReturnType<typeof fakeDb>
export type WorldOverrides = Partial<Record<string, Array<Record<string, unknown>>>>

export function world(orders: Array<Record<string, unknown>>, over: WorldOverrides = {}, clinicOver: Record<string, unknown> = {}): World {
  return fakeDb({
    orders,
    providers: [
      { provider_id: CHEN, user_id: USER_CHEN, clinic_id: CLINIC, is_active: true, deleted_at: null, first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890' },
      { provider_id: PATEL, user_id: USER_PATEL, clinic_id: CLINIC, is_active: true, deleted_at: null, first_name: 'Raj', last_name: 'Patel', npi_number: '1987654321' },
    ],
    clinics: [{ clinic_id: CLINIC, name: 'Sunrise Weight Loss Clinic', stripe_connect_status: 'ACTIVE', is_active: true, onboarding_status: 'approved', ...clinicOver }],
    pharmacies: [
      { pharmacy_id: 'ph-strive', name: 'Strive', integration_tier: 'TIER_2_PORTAL', is_active: true, pharmacy_status: 'ACTIVE', deleted_at: null },
    ],
    pharmacy_state_licenses: [
      { pharmacy_id: 'ph-strive', state_code: 'TX', is_active: true, deleted_at: null, expiration_date: '2099-12-31', sterile_compounding: true },
    ],
    catalog: [],
    formulations: [
      { formulation_id: 'f-plain', requires_clinical_difference: false, salt_forms: { ingredients: ingredient('Plain') } },
      { formulation_id: 'f-inj', requires_clinical_difference: false, dosage_forms: { is_sterile: true }, salt_forms: { ingredients: ingredient('Plain') } },
      { formulation_id: 'f-glp1', requires_clinical_difference: true, salt_forms: { ingredients: ingredient('Semaglutide', { commercial_equivalent: true }) } },
      { formulation_id: 'f-testo', requires_clinical_difference: false, salt_forms: { ingredients: ingredient('Testosterone', { dea_schedule: 3 }) }, formulation_ingredients: [] },
      { formulation_id: 'f-nad', requires_clinical_difference: false, salt_forms: { ingredients: ingredient('NAD+', { compounding_status: 'unverified', compounding_status_source: null, compounding_status_reviewed_at: null }) } },
      { formulation_id: 'f-cat2', requires_clinical_difference: false, salt_forms: { ingredients: ingredient('Peptide X', { compounding_status: 'category_2' }) } },
    ],
    patients: [
      { patient_id: P1, clinic_id: CLINIC, first_name: 'Jordan', last_name: 'Lee', phone_e164: '+15125550123', sms_opt_in: true, allergies: ['sulfa'], nkda: false },
      { patient_id: P2, clinic_id: CLINIC, first_name: 'Ana', last_name: 'Ruiz', phone_e164: null, sms_opt_in: false, allergies: [], nkda: true },
    ],
    drug_interactions: [],
    provider_npi_verifications: [
      { provider_id: CHEN, npi: '1234567890', status: 'verified' },
      { provider_id: PATEL, npi: '1987654321', status: 'verified' },
    ],
    provider_state_licenses: [
      { provider_id: CHEN, state: 'TX', license_number: 'TX-MD-001234', expires_on: '2099-12-31' },
      { provider_id: PATEL, state: 'TX', license_number: 'TX-MD-002345', expires_on: '2099-12-31' },
    ],
    treatment_proposals: [],
    treatment_proposal_options: [],
    treatment_proposal_events: [],
    sms_log: [],
    ...over,
  })
}

/** One option, every line required, sent: the common case. */
export function oneOption(orderIds: string[], over: Record<string, unknown> = {}) {
  return {
    patientId: P1, providerId: CHEN, send: true,
    options: [{ label: 'Foundation plan', protocolId: null, lines: orderIds.map(orderId => ({ orderId, required: true })) }],
    ...over,
  }
}
