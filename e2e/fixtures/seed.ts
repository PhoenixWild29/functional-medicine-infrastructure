// ============================================================
// E2E Test Data Seeding & Cleanup — WO-42
// ============================================================
//
// Seeds deterministic test data for E2E runs.
// Uses service_role client to bypass RLS.
//
// Design decisions:
//   - Clinic/pharmacy/catalog rows are created once and reused across tests.
//   - Orders and related rows are soft-deleted between tests.
//   - All test rows have deterministic UUIDs to allow idempotent seeding.
//
// HIPAA: All test data uses obviously fake values (no real patient data).

import { createClient } from '@supabase/supabase-js'
import { encryptSecret } from '../../src/lib/epcs/crypto'
import { DEMO_TOTP_SECRET } from '../../src/lib/poc/totp-enrollment'
import { packageRowsFor } from '../../src/lib/catalog/packages'

// E2E tests MUST run against an isolated Supabase project — never production.
// If these env vars are missing, fail loudly rather than silently falling back
// to any ambient SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY that could point at prod.
const E2E_SUPABASE_URL = process.env['E2E_SUPABASE_URL']
const E2E_SUPABASE_SERVICE_ROLE_KEY = process.env['E2E_SUPABASE_SERVICE_ROLE_KEY']

if (!E2E_SUPABASE_URL || !E2E_SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    'E2E_SUPABASE_URL and E2E_SUPABASE_SERVICE_ROLE_KEY must be set. ' +
    'E2E tests require an isolated Supabase project to avoid corrupting production data. ' +
    'Locally: set these in .env.test.local. CI: populated from GitHub repo secrets.'
  )
}

const supabase = createClient(E2E_SUPABASE_URL, E2E_SUPABASE_SERVICE_ROLE_KEY)

// ── Deterministic test UUIDs ──────────────────────────────────
export const TEST_IDS = {
  clinic:        'aaaaaaaa-0000-0000-0000-000000000001',
  provider:      'aaaaaaaa-0000-0000-0000-000000000002',
  // WO-100: a second provider row with NO auth login, seeded ONLY by the
  // WO-100 describe block (seedSecondProvider / retireSecondProvider) so
  // the shared clinic keeps a single active provider for every other spec.
  providerB:     'aaaaaaaa-0000-0000-0000-000000000004',
  patient:       'aaaaaaaa-0000-0000-0000-000000000003',
  // WO-97: one patient per allergy chip state. `patient` above is the
  // "not recorded" case (amber chip + non-blocking Review notice); these
  // two mirror the demo seed (Alex Demo → NKDA, Jordan Rivera → sulfa).
  patientNkda:      'aaaaaaaa-0000-0000-0000-000000000004',
  patientAllergies: 'aaaaaaaa-0000-0000-0000-000000000005',
  pharmacyTier1: 'aaaaaaaa-0000-0000-0000-000000000010',
  pharmacyTier2: 'aaaaaaaa-0000-0000-0000-000000000011',
  pharmacyTier4: 'aaaaaaaa-0000-0000-0000-000000000013',
  catalogItem:   'aaaaaaaa-0000-0000-0000-000000000020',
  // V3 hierarchical catalog (WO-82/87) — used by cascading prescription builder
  ingredient:         'aaaaaaaa-0000-0000-0000-000000000030',
  saltForm:           'aaaaaaaa-0000-0000-0000-000000000031',
  formulation:        'aaaaaaaa-0000-0000-0000-000000000032',
  pharmacyFormulation:'aaaaaaaa-0000-0000-0000-000000000033',
  // Controlled-substance seed for EPCS 2FA E2E (Schedule III — triggers TOTP gate)
  controlledIngredient:         'aaaaaaaa-0000-0000-0000-000000000040',
  controlledSaltForm:           'aaaaaaaa-0000-0000-0000-000000000041',
  controlledFormulation:        'aaaaaaaa-0000-0000-0000-000000000042',
  controlledPharmacyFormulation:'aaaaaaaa-0000-0000-0000-000000000043',
  // WO-99: the same Schedule III compound at the Tier 4 FAX pharmacy — the
  // only route a controlled substance may be signed to. Seeded (and
  // retired) only by the WO-99 describe block.
  controlledTier4PharmacyFormulation: 'aaaaaaaa-0000-0000-0000-000000000044',
  // WO-96: GLP-1-style seed — requires_clinical_difference = true, cold chain.
  // Drives the "Semaglutide cannot be sent without a clinical difference"
  // acceptance path without depending on the production catalog seed.
  glp1Ingredient:         'aaaaaaaa-0000-0000-0000-000000000050',
  glp1SaltForm:           'aaaaaaaa-0000-0000-0000-000000000051',
  glp1Formulation:        'aaaaaaaa-0000-0000-0000-000000000052',
  glp1PharmacyFormulation:'aaaaaaaa-0000-0000-0000-000000000053',
  // WO-101: the same GLP-1 analogue at Tier2, sold in three priced vials —
  // the E2E stand-in for Strive Semaglutide 5 mg/mL (migration
  // 20260914000001). Tier1 keeps a single package, so every other spec
  // that picks Tier1 sees no package control.
  glp1PackagedPharmacyFormulation: 'aaaaaaaa-0000-0000-0000-000000000054',
  // WO-102: shipping scenarios. Tier2 stands in for Strive ($9 standard /
  // $22 cold chain), Tier4 for Quick Rx ($12 / $25); Tier1 ships free so
  // every existing spec's amounts are unchanged. The GLP-1 analogue (cold
  // chain) is also sold at Tier4, and the plain compound (standard) at
  // Tier2 ($100, same as Tier1) and Tier4 ($110 — a re-route there changes
  // its price).
  glp1Tier4PharmacyFormulation:  'aaaaaaaa-0000-0000-0000-000000000055',
  plainTier2PharmacyFormulation: 'aaaaaaaa-0000-0000-0000-000000000034',
  plainTier4PharmacyFormulation: 'aaaaaaaa-0000-0000-0000-000000000035',
  // WO-101b: stand-in for prod's Quick Rx — lists "1 mL vial, 3 mL vial"
  // in available_quantities but prices only the 1 mL vial (one package row,
  // exactly what the WO-101 backfill left in prod).
  pharmacyQuickRx:                'aaaaaaaa-0000-0000-0000-000000000014',
  glp1QuickRxPharmacyFormulation: 'aaaaaaaa-0000-0000-0000-000000000056',
}

// WO-102: E2E shipping rates (dollars), mirroring the demo seed.
export const TEST_SHIPPING = {
  tier2: { standard: 9,  coldChain: 22 },   // "Strive"
  tier4: { standard: 12, coldChain: 25 },   // "Quick Rx"
}

// Display strings the cascading UI renders — tests reference these when
// clicking buttons/options in the builder. Keep in sync with the seed values
// below so a rename requires a single update.
export const TEST_CATALOG = {
  ingredientName:  'Test Compound E2E',
  saltFormName:    'Test Compound E2E HCl',
  formulationName: 'Test Compound E2E Injectable 10 mg/mL',
  dosageFormName:  'Injectable Solution',   // seeded by migration 20260408000002
  routeName:       'Subcutaneous',          // seeded by migration 20260408000002

  // Schedule-III controlled substance — triggers EPCS 2FA gate at signing.
  // Used by the TOTP-enrollment E2E test that proves A2 is fixed.
  controlledIngredientName:  'Test Controlled E2E',
  controlledSaltFormName:    'Test Controlled E2E Cypionate',
  controlledFormulationName: 'Test Controlled E2E Injectable 100 mg/mL',

  // WO-96 GLP-1 analogue — requires a clinical difference statement.
  glp1IngredientName:  'Test GLP1 E2E',
  glp1SaltFormName:    'Test GLP1 E2E Base',
  glp1FormulationName: 'Test GLP1 E2E Injectable 5 mg/mL',
  glp1ClinicalDifferenceOptions: [
    'Patient requires a dose or strength not commercially available',
    'Commercial product is unavailable or on national shortage',
  ],
}

// WO-101: Tier2's GLP-1 packages, in the importer's `packages` cell format.
// Same sizes and prices as the Strive demo seed.
export const TEST_GLP1_PACKAGES_CELL = '1 mL vial@95.00*|2.5 mL vial@165.00|5 mL vial@285.00'

// WO-97 patients by allergy state. Last names render as "{last}, Test"
// in the selector; chip text is what the app derives from the columns.
export const TEST_PATIENTS = {
  nkdaLastName:      'Nkda',
  allergiesLastName: 'Allergic',
  allergies:         ['sulfa', 'penicillin'],
}

// ── Test users (Supabase Auth) ────────────────────────────────
export const TEST_USERS = {
  clinicAdmin: {
    email:    'test-clinic-admin@compoundiq.test',
    password: 'TestPassword123!',
    role:     'clinic_admin',
    clinicId: TEST_IDS.clinic,
  },
  provider: {
    email:    'test-provider@compoundiq.test',
    password: 'TestPassword123!',
    role:     'provider',
    clinicId: TEST_IDS.clinic,
  },
  opsAdmin: {
    email:    'test-ops-admin@compoundiq.test',
    password: 'TestPassword123!',
    role:     'ops_admin',
    clinicId: null,
  },
}

/**
 * Seeds all static test data (clinic, pharmacy, catalog).
 * Idempotent — safe to call multiple times.
 */
export async function seedStaticData(): Promise<void> {
  // Clinic
  await supabase.from('clinics').upsert({
    clinic_id:             TEST_IDS.clinic,
    name:                  'Test Clinic E2E',
    stripe_connect_status: 'ACTIVE',
    // `poc_placeholder` is the official sentinel in /api/checkout/payment-intent
    // (see route.ts line 138) that bypasses Stripe Connect routing. This keeps
    // the E2E API-level checkout test self-contained — it doesn't require a
    // real Stripe Connect account to exist for the clinic.
    stripe_connect_account_id: 'poc_placeholder',
    is_active:             true,
  }, { onConflict: 'clinic_id' })

  // Provider
  await supabase.from('providers').upsert({
    provider_id:     TEST_IDS.provider,
    clinic_id:       TEST_IDS.clinic,
    first_name:      'Test',
    last_name:       'Provider',
    npi_number:      '1234567890',
    license_state:   'TX',
    license_number:  'TEST-LICENSE-001',
    signature_on_file: true,
    is_active:       true,
  }, { onConflict: 'provider_id' })

  // WO-100: the second provider is NOT part of the shared seed. Retire it
  // if a previous run left it active, so every other spec keeps seeing a
  // single provider that auto-selects.
  await retireSecondProvider()

  // Patients — one per WO-97 allergy chip state. The upsert re-asserts the
  // allergy columns on every run, so a test that edits them (the banner
  // editor / the Review "Confirm NKDA" beat) starts from a known state.
  // The wizard helpers search "Test" and click "Patient, Test"; the two
  // extra last names deliberately do not match that regex.
  await supabase.from('patients').upsert([
    {
      patient_id:   TEST_IDS.patient,
      clinic_id:    TEST_IDS.clinic,
      first_name:   'Test',
      last_name:    'Patient',
      date_of_birth: '1980-01-01',
      phone:        '+15550000001',
      email:        'test-patient@compoundiq.test',
      state:        'TX',
      sms_opt_in:   true,
      is_active:    true,
      // not recorded
      allergies:            null,
      nkda:                 false,
      allergies_updated_at: null,
    },
    {
      patient_id:   TEST_IDS.patientNkda,
      clinic_id:    TEST_IDS.clinic,
      first_name:   'Test',
      last_name:    TEST_PATIENTS.nkdaLastName,
      date_of_birth: '1981-01-01',
      phone:        '+15550000002',
      email:        'test-nkda@compoundiq.test',
      state:        'TX',
      sms_opt_in:   true,
      is_active:    true,
      allergies:            [],
      nkda:                 true,
      allergies_updated_at: new Date().toISOString(),
    },
    {
      patient_id:   TEST_IDS.patientAllergies,
      clinic_id:    TEST_IDS.clinic,
      first_name:   'Test',
      last_name:    TEST_PATIENTS.allergiesLastName,
      date_of_birth: '1982-01-01',
      phone:        '+15550000003',
      email:        'test-allergic@compoundiq.test',
      state:        'TX',
      sms_opt_in:   true,
      is_active:    true,
      allergies:            TEST_PATIENTS.allergies,
      nkda:                 false,
      allergies_updated_at: new Date().toISOString(),
    },
  ], { onConflict: 'patient_id' })

  // Pharmacies (Tier 1, 2, 4)
  await supabase.from('pharmacies').upsert([
    {
      pharmacy_id:     TEST_IDS.pharmacyTier1,
      name:            'Test Pharmacy Tier1',
      slug:            'test-tier1',
      integration_tier: 'TIER_1_API',
      is_active:       true,
      // WO-102: Tier1 ships free so existing specs' amounts are unchanged.
      // Every row in this bulk upsert names the same columns.
      shipping_fee_standard:   0,
      shipping_fee_cold_chain: 0,
      free_shipping_threshold: null,
    },
    {
      pharmacy_id:     TEST_IDS.pharmacyTier2,
      name:            'Test Pharmacy Tier2',
      slug:            'test-tier2',
      integration_tier: 'TIER_2_PORTAL',
      is_active:       true,
      shipping_fee_standard:   9.00,
      shipping_fee_cold_chain: 22.00,
      free_shipping_threshold: null,
    },
    {
      pharmacy_id:     TEST_IDS.pharmacyTier4,
      name:            'Test Pharmacy Tier4',
      slug:            'test-tier4',
      integration_tier: 'TIER_4_FAX',
      fax_number:      '+15550000099',
      is_active:       true,
      shipping_fee_standard:   12.00,
      shipping_fee_cold_chain: 25.00,
      free_shipping_threshold: null,
    },
    {
      pharmacy_id:     TEST_IDS.pharmacyQuickRx,
      name:            'Test Pharmacy QuickRx',
      slug:            'test-quickrx',
      integration_tier: 'TIER_1_API',
      is_active:       true,
      shipping_fee_standard:   0,
      shipping_fee_cold_chain: 0,
      free_shipping_threshold: null,
    },
  ], { onConflict: 'pharmacy_id' })

  // State licenses for TX (required for state-compliance search)
  await supabase.from('pharmacy_state_licenses').upsert([
    { pharmacy_id: TEST_IDS.pharmacyTier1, state_code: 'TX', license_number: 'TX-TEST-001', expiration_date: '2030-12-31', is_active: true },
    { pharmacy_id: TEST_IDS.pharmacyTier2, state_code: 'TX', license_number: 'TX-TEST-002', expiration_date: '2030-12-31', is_active: true },
    { pharmacy_id: TEST_IDS.pharmacyTier4, state_code: 'TX', license_number: 'TX-TEST-004', expiration_date: '2030-12-31', is_active: true },
    { pharmacy_id: TEST_IDS.pharmacyQuickRx, state_code: 'TX', license_number: 'TX-TEST-014', expiration_date: '2030-12-31', is_active: true },
  ], { onConflict: 'pharmacy_id, state_code' })

  // Legacy flat catalog — kept for the Zero-PHI describe block which inserts
  // orders referencing orders.catalog_item_id directly.
  await supabase.from('catalog').upsert({
    item_id:          TEST_IDS.catalogItem,
    pharmacy_id:      TEST_IDS.pharmacyTier1,
    medication_name:  'Test Compound Injectable',
    form:             'Injectable',
    dose:             '1mg/mL 10mL vial',
    wholesale_price:  100.00,
    retail_price:     200.00,
    is_active:        true,
  }, { onConflict: 'item_id' })

  // ── V3 hierarchical catalog (cascading prescription builder) ──
  //
  // The new UI queries ingredients → salt_forms → formulations →
  // pharmacy_formulations. The legacy catalog row above is invisible to it.
  //
  // dosage_forms and routes_of_administration are populated by migration
  // 20260408000002 with gen_random_uuid() IDs, so we look them up by name
  // (both have UNIQUE(name) constraints, so the lookup is stable).

  const { data: dosageForm, error: dfErr } = await supabase
    .from('dosage_forms')
    .select('dosage_form_id')
    .eq('name', TEST_CATALOG.dosageFormName)
    .single()
  if (dfErr || !dosageForm) {
    throw new Error(
      `seedStaticData: dosage_forms row "${TEST_CATALOG.dosageFormName}" not found. ` +
      `Migration 20260408000002_wo82_seed_reference_data.sql must be applied to the E2E project.`
    )
  }

  const { data: route, error: rErr } = await supabase
    .from('routes_of_administration')
    .select('route_id')
    .eq('name', TEST_CATALOG.routeName)
    .single()
  if (rErr || !route) {
    throw new Error(
      `seedStaticData: routes_of_administration row "${TEST_CATALOG.routeName}" not found. ` +
      `Migration 20260408000002_wo82_seed_reference_data.sql must be applied to the E2E project.`
    )
  }

  // Ingredient — dea_schedule=null skips the EPCS TOTP gate on /review.
  await supabase.from('ingredients').upsert({
    ingredient_id:        TEST_IDS.ingredient,
    common_name:          TEST_CATALOG.ingredientName,
    therapeutic_category: 'Testing',
    dea_schedule:         null,
    is_hazardous:         false,
    is_active:            true,
  }, { onConflict: 'ingredient_id' })

  // Salt form — only one per ingredient, so the cascading UI auto-selects
  // it and does not render the salt-form picker (one fewer step for the test).
  await supabase.from('salt_forms').upsert({
    salt_form_id:  TEST_IDS.saltForm,
    ingredient_id: TEST_IDS.ingredient,
    salt_name:     TEST_CATALOG.saltFormName,
    abbreviation:  'HCl',
    is_active:     true,
  }, { onConflict: 'salt_form_id' })

  // Formulation — what the test clicks in the cascade after ingredient pick.
  await supabase.from('formulations').upsert({
    formulation_id:      TEST_IDS.formulation,
    name:                TEST_CATALOG.formulationName,
    salt_form_id:        TEST_IDS.saltForm,
    dosage_form_id:      dosageForm.dosage_form_id,
    route_id:            route.route_id,
    concentration:       '10 mg/mL',
    concentration_value: 10,
    concentration_unit:  'mg/mL',
    is_combination:      false,
    total_ingredients:   1,
    is_active:           true,
    // WO-96: injectable → SubQ kit, standard shipping, no clinical
    // difference. Set explicitly because migration 20260912000001 only
    // back-fills rows that existed when it ran; this upsert may create
    // the row afterwards on a fresh E2E project.
    default_syringe_option:       'sc_kit',
    default_shipping_type:        'standard',
    clinical_difference_options:  [],
    requires_clinical_difference: false,
  }, { onConflict: 'formulation_id' })

  // Pharmacy formulation — wholesale price $100 matches the inline retail-
  // validation test which tries to set retail to $50 (below wholesale).
  await supabase.from('pharmacy_formulations').upsert({
    pharmacy_formulation_id:   TEST_IDS.pharmacyFormulation,
    pharmacy_id:               TEST_IDS.pharmacyTier1,
    formulation_id:            TEST_IDS.formulation,
    wholesale_price:           100.00,
    available_quantities:      ['30 mL vial', '60 mL vial', '90 mL vial'],
    is_available:              true,
    estimated_turnaround_days: 5,
    is_active:                 true,
  }, { onConflict: 'pharmacy_formulation_id' })

  // ── Schedule-III controlled-substance seed ──
  //
  // A second, parallel V3 cascade for tests that need to trigger the EPCS
  // 2FA gate. dea_schedule = 3 satisfies the check at
  // BatchReviewForm.handleSignAndSend: `rx.deaSchedule && rx.deaSchedule >= 2`.
  await supabase.from('ingredients').upsert({
    ingredient_id:        TEST_IDS.controlledIngredient,
    common_name:          TEST_CATALOG.controlledIngredientName,
    therapeutic_category: 'Testing — Controlled',
    dea_schedule:         3,
    is_hazardous:         false,
    is_active:            true,
  }, { onConflict: 'ingredient_id' })

  await supabase.from('salt_forms').upsert({
    salt_form_id:  TEST_IDS.controlledSaltForm,
    ingredient_id: TEST_IDS.controlledIngredient,
    salt_name:     TEST_CATALOG.controlledSaltFormName,
    abbreviation:  'Cyp',
    is_active:     true,
  }, { onConflict: 'salt_form_id' })

  await supabase.from('formulations').upsert({
    formulation_id:      TEST_IDS.controlledFormulation,
    name:                TEST_CATALOG.controlledFormulationName,
    salt_form_id:        TEST_IDS.controlledSaltForm,
    dosage_form_id:      dosageForm.dosage_form_id,
    route_id:            route.route_id,
    concentration:       '100 mg/mL',
    concentration_value: 100,
    concentration_unit:  'mg/mL',
    is_combination:      false,
    total_ingredients:   1,
    is_active:           true,
    // WO-96 defaults (see note on the plain formulation above).
    default_syringe_option:       'sc_kit',
    default_shipping_type:        'standard',
    clinical_difference_options:  [],
    requires_clinical_difference: false,
  }, { onConflict: 'formulation_id' })

  await supabase.from('pharmacy_formulations').upsert({
    pharmacy_formulation_id:   TEST_IDS.controlledPharmacyFormulation,
    pharmacy_id:               TEST_IDS.pharmacyTier1,
    formulation_id:            TEST_IDS.controlledFormulation,
    wholesale_price:           150.00,
    available_quantities:      ['10 mL vial', '20 mL vial'],
    is_available:              true,
    estimated_turnaround_days: 7,
    is_active:                 true,
  }, { onConflict: 'pharmacy_formulation_id' })

  // ── WO-96: GLP-1 analogue seed (requires clinical difference) ──
  //
  // Mirrors what migration 20260912000001 assigns to Semaglutide /
  // Tirzepatide in the production catalog: cold-chain shipping and a
  // required 503A clinical-difference statement with a picklist whose
  // first entry is the pre-selected default. dea_schedule = null so the
  // EPCS gate stays out of the way.
  await supabase.from('ingredients').upsert({
    ingredient_id:        TEST_IDS.glp1Ingredient,
    common_name:          TEST_CATALOG.glp1IngredientName,
    therapeutic_category: 'Testing — GLP-1',
    dea_schedule:         null,
    is_hazardous:         false,
    is_active:            true,
  }, { onConflict: 'ingredient_id' })

  await supabase.from('salt_forms').upsert({
    salt_form_id:  TEST_IDS.glp1SaltForm,
    ingredient_id: TEST_IDS.glp1Ingredient,
    salt_name:     TEST_CATALOG.glp1SaltFormName,
    abbreviation:  'base',
    is_active:     true,
  }, { onConflict: 'salt_form_id' })

  await supabase.from('formulations').upsert({
    formulation_id:      TEST_IDS.glp1Formulation,
    name:                TEST_CATALOG.glp1FormulationName,
    salt_form_id:        TEST_IDS.glp1SaltForm,
    dosage_form_id:      dosageForm.dosage_form_id,
    route_id:            route.route_id,
    concentration:       '5 mg/mL',
    concentration_value: 5,
    concentration_unit:  'mg/mL',
    is_combination:      false,
    total_ingredients:   1,
    is_active:           true,
    default_syringe_option:       'sc_kit',
    default_shipping_type:        'cold_chain',
    clinical_difference_options:  TEST_CATALOG.glp1ClinicalDifferenceOptions,
    requires_clinical_difference: true,
  }, { onConflict: 'formulation_id' })

  await supabase.from('pharmacy_formulations').upsert({
    pharmacy_formulation_id:   TEST_IDS.glp1PharmacyFormulation,
    pharmacy_id:               TEST_IDS.pharmacyTier1,
    formulation_id:            TEST_IDS.glp1Formulation,
    wholesale_price:           95.00,
    available_quantities:      ['5mL vial', '2.5mL vial'],
    is_available:              true,
    estimated_turnaround_days: 5,
    is_active:                 true,
  }, { onConflict: 'pharmacy_formulation_id' })

  // ── WO-101: packages ──
  // Tier1: one default package at today's price (what migration
  // 20260914000001 backfills) → no package control.
  // Tier2: three priced vials → suggestion + dropdown.
  await supabase.from('pharmacy_formulations').upsert({
    pharmacy_formulation_id:   TEST_IDS.glp1PackagedPharmacyFormulation,
    pharmacy_id:               TEST_IDS.pharmacyTier2,
    formulation_id:            TEST_IDS.glp1Formulation,
    wholesale_price:           95.00,
    available_quantities:      ['1 mL vial', '2.5 mL vial', '5 mL vial'],
    is_available:              true,
    estimated_turnaround_days: 5,
    is_active:                 true,
  }, { onConflict: 'pharmacy_formulation_id' })

  // ── WO-102: offers for the shipping scenarios ──
  await supabase.from('pharmacy_formulations').upsert([
    {
      pharmacy_formulation_id:   TEST_IDS.glp1Tier4PharmacyFormulation,
      pharmacy_id:               TEST_IDS.pharmacyTier4,
      formulation_id:            TEST_IDS.glp1Formulation,
      wholesale_price:           95.00,
      available_quantities:      ['5mL vial'],
      is_available:              true,
      estimated_turnaround_days: 5,
      is_active:                 true,
    },
    {
      pharmacy_formulation_id:   TEST_IDS.plainTier2PharmacyFormulation,
      pharmacy_id:               TEST_IDS.pharmacyTier2,
      formulation_id:            TEST_IDS.formulation,
      wholesale_price:           100.00,
      available_quantities:      ['30 mL vial', '60 mL vial', '90 mL vial'],
      is_available:              true,
      estimated_turnaround_days: 5,
      is_active:                 true,
    },
    {
      pharmacy_formulation_id:   TEST_IDS.glp1QuickRxPharmacyFormulation,
      pharmacy_id:               TEST_IDS.pharmacyQuickRx,
      formulation_id:            TEST_IDS.glp1Formulation,
      wholesale_price:           95.00,
      available_quantities:      ['1 mL vial', '3 mL vial'],
      is_available:              true,
      estimated_turnaround_days: 3,
      is_active:                 true,
    },
    {
      pharmacy_formulation_id:   TEST_IDS.plainTier4PharmacyFormulation,
      pharmacy_id:               TEST_IDS.pharmacyTier4,
      formulation_id:            TEST_IDS.formulation,
      wholesale_price:           110.00,
      available_quantities:      ['30 mL vial', '60 mL vial', '90 mL vial'],
      is_available:              true,
      estimated_turnaround_days: 5,
      is_active:                 true,
    },
  ], { onConflict: 'pharmacy_formulation_id' })

  // WO-101b: every seeded offer gets the default package the WO-101
  // backfill gives existing rows (first available_quantities entry, same
  // deterministic id), so a fresh E2E project matches the shared one. The
  // prescribing flow lists sizes from these rows only.
  const glp1Packages = [
    // Every injectable package is sized in a unit the app can convert
    // (#181): an injectable sold as a bare "30" or a container-only
    // "1 vial" cannot be sized against a dispense in mL, and a line with
    // a duration is refused rather than priced as one package.
    ...packageRowsFor(TEST_IDS.pharmacyFormulation, '', { price: 100, availableQuantities: ['30 mL vial', '60 mL vial', '90 mL vial'] }),
    ...packageRowsFor(TEST_IDS.controlledPharmacyFormulation, '', { price: 150, availableQuantities: ['10 mL vial', '20 mL vial'] }),
    ...packageRowsFor(TEST_IDS.glp1Tier4PharmacyFormulation, '', { price: 95, availableQuantities: ['5mL vial'] }),
    ...packageRowsFor(TEST_IDS.plainTier2PharmacyFormulation, '', { price: 100, availableQuantities: ['30 mL vial', '60 mL vial', '90 mL vial'] }),
    ...packageRowsFor(TEST_IDS.plainTier4PharmacyFormulation, '', { price: 110, availableQuantities: ['30 mL vial', '60 mL vial', '90 mL vial'] }),
    ...packageRowsFor(TEST_IDS.glp1QuickRxPharmacyFormulation, '', { price: 95, availableQuantities: ['1 mL vial', '3 mL vial'] }),
    ...packageRowsFor(TEST_IDS.glp1PharmacyFormulation, '', { price: 95, availableQuantities: ['5mL vial', '2.5mL vial'] }),
    ...packageRowsFor(TEST_IDS.glp1PackagedPharmacyFormulation, TEST_GLP1_PACKAGES_CELL, { price: 95, availableQuantities: [] }),
  ]
  // The shared E2E project may hold packages that earlier seeds or another
  // branch's seed wrote (the unsized "30" / "1 vial"; ids derive from the
  // label, so the upsert below adds rows beside them). Retire every
  // package on these offers that this seed does not write — BEFORE the
  // upsert, and no longer the default, since an offer has one default
  // package (uq_pfp_one_default). Each branch's seed restores its own set.
  const seededPfIds = [...new Set(glp1Packages.map(p => p.pharmacy_formulation_id))]
  const seededPkgIds = glp1Packages.map(p => p.id)
  const { error: retireError } = await supabase
    .from('pharmacy_formulation_packages')
    .update({ active: false, is_default: false })
    .in('pharmacy_formulation_id', seededPfIds)
    .not('id', 'in', `(${seededPkgIds.join(',')})`)
  if (retireError) throw new Error(`seed retire stale packages: ${retireError.message}`)

  const { error: packagesError } = await supabase
    .from('pharmacy_formulation_packages')
    .upsert(glp1Packages, { onConflict: 'id' })
  if (packagesError) throw new Error(`seed pharmacy_formulation_packages: ${packagesError.message}`)


  // ── Pre-enroll the E2E test provider with the canonical demo TOTP secret ──
  //
  // Writes directly to providers.totp_secret_encrypted using the shared
  // encryptSecret helper. Does NOT go through enrollDemoProvider because
  // that function hard-codes the POC demo provider UUID (a production
  // guardrail — see src/lib/poc/totp-enrollment.ts). The E2E test clinic
  // has its own provider row (TEST_IDS.provider) that needs the same secret
  // so the EPCS gate can verify codes in the controlled-substance test.
  await enrollE2eProviderTotp()

  // WO-100: providers.user_id is what makes "I am this provider" resolvable
  // (F-1). Link the E2E provider row to its auth user when that user exists
  // (globalSetup creates the users AFTER the first seed call and links again).
  await linkE2eProviderToAuthUser()

  // Smoke-test: walk the full cascade and fail loud if any level returns 0
  // rows. Turns a silent UI timeout into an actionable seed error.
  await assertV3CascadeVisible()
}

/**
 * WO-100: activates a second provider (no login, renders as "Provider,
 * Other") in the E2E clinic. Call from a describe's beforeAll and pair
 * with retireSecondProvider() in afterAll — the row is shared state on
 * the E2E project and other specs assume a single active provider.
 */
export async function seedSecondProvider(): Promise<void> {
  const { error } = await supabase.from('providers').upsert({
    provider_id:     TEST_IDS.providerB,
    clinic_id:       TEST_IDS.clinic,
    first_name:      'Other',
    last_name:       'Provider',
    npi_number:      '1987654321',
    license_state:   'TX',
    license_number:  'TEST-LICENSE-002',
    signature_on_file: false,
    is_active:       true,
    deleted_at:      null,
  }, { onConflict: 'provider_id' })
  if (error) throw new Error(`seedSecondProvider: ${error.message}`)
}

/** WO-100: soft-retires the second provider (idempotent; no-op if absent). */
export async function retireSecondProvider(): Promise<void> {
  await supabase
    .from('providers')
    .update({ is_active: false, deleted_at: new Date().toISOString() })
    .eq('provider_id', TEST_IDS.providerB)
}

/**
 * Sets providers.user_id on TEST_IDS.provider to the auth user behind
 * TEST_USERS.provider. Idempotent; a no-op until that auth user exists.
 * The same link is made for the POC demo provider by scripts/seed-poc.ts.
 */
export async function linkE2eProviderToAuthUser(): Promise<void> {
  const { data } = await supabase.auth.admin.listUsers()
  const providerUser = data?.users.find(u => u.email === TEST_USERS.provider.email)
  if (!providerUser) return
  const { error } = await supabase
    .from('providers')
    .update({ user_id: providerUser.id })
    .eq('provider_id', TEST_IDS.provider)
  if (error) throw new Error(`linkE2eProviderToAuthUser: ${error.message}`)
}

async function enrollE2eProviderTotp(): Promise<void> {
  await supabase
    .from('providers')
    .update({
      totp_secret_encrypted: encryptSecret(DEMO_TOTP_SECRET),
      totp_enabled:          true,
      totp_verified_at:      new Date().toISOString(),
    })
    .eq('provider_id', TEST_IDS.provider)
}

async function assertV3CascadeVisible(): Promise<void> {
  const checks: Array<[string, () => Promise<number>]> = [
    ['ingredients', async () => {
      const { count } = await supabase.from('ingredients')
        .select('*', { count: 'exact', head: true })
        .eq('ingredient_id', TEST_IDS.ingredient)
        .eq('is_active', true)
        .is('deleted_at', null)
      return count ?? 0
    }],
    ['salt_forms', async () => {
      const { count } = await supabase.from('salt_forms')
        .select('*', { count: 'exact', head: true })
        .eq('salt_form_id', TEST_IDS.saltForm)
        .eq('is_active', true)
        .is('deleted_at', null)
      return count ?? 0
    }],
    ['formulations', async () => {
      const { count } = await supabase.from('formulations')
        .select('*', { count: 'exact', head: true })
        .eq('formulation_id', TEST_IDS.formulation)
        .eq('is_active', true)
        .is('deleted_at', null)
      return count ?? 0
    }],
    ['pharmacy_formulations', async () => {
      const { count } = await supabase.from('pharmacy_formulations')
        .select('*', { count: 'exact', head: true })
        .eq('pharmacy_formulation_id', TEST_IDS.pharmacyFormulation)
        .eq('is_available', true)
        .eq('is_active', true)
        .is('deleted_at', null)
      return count ?? 0
    }],
  ]

  for (const [table, check] of checks) {
    const n = await check()
    if (n === 0) {
      throw new Error(
        `seedStaticData: V3 cascade assertion failed — ${table} returned 0 rows ` +
        `for the seeded test IDs. Check the upsert above; the cascading prescription ` +
        `builder cannot render without a row at every level.`
      )
    }
  }
}

/**
 * Soft-deletes all test orders and cleans up related rows.
 * Call in afterEach to keep tests isolated.
 */
export async function cleanupTestOrders(): Promise<void> {
  // Find all test orders for the test clinic
  const { data: orders } = await supabase
    .from('orders')
    .select('order_id')
    .eq('clinic_id', TEST_IDS.clinic)
    .eq('is_active', true)

  if (!orders?.length) return

  const orderIds = orders.map(o => o.order_id)

  // Soft-delete test orders
  await supabase
    .from('orders')
    .update({ is_active: false, deleted_at: new Date().toISOString() })
    .in('order_id', orderIds)

  // WO-99: batch signing forms payment groups. Cancel the test clinic's
  // open ones so a later spec never finds a stale group on its patient.
  await supabase
    .from('payment_groups')
    .update({ status: 'CANCELLED', updated_at: new Date().toISOString() })
    .eq('clinic_id', TEST_IDS.clinic)
    .eq('status', 'AWAITING_PAYMENT')

  // Truncate all related rows for test orders
  await supabase.from('adapter_submissions').delete().in('order_id', orderIds)
  await supabase.from('webhook_events').delete().in('order_id', orderIds)
  await supabase.from('pharmacy_webhook_events').delete().in('order_id', orderIds)
  await supabase.from('sms_log').delete().in('order_id', orderIds)
  await supabase.from('order_sla_deadlines').delete().in('order_id', orderIds)
  await supabase.from('order_status_history').delete().in('order_id', orderIds)
  await supabase.from('clinic_notifications').delete().in('order_id', orderIds)
  await supabase.from('transfer_failures').delete().in('order_id', orderIds)
  await supabase.from('disputes').delete().in('order_id', orderIds)
}

/**
 * WO-104: the one-row-per-dose favorites the old model needed for
 * Semaglutide — the GLP-1 analogue (5 mg/mL) at Tier1, 10 / 20 / 40
 * units weekly — inserted in the LEGACY shape (dose columns, no
 * dose_presets), then collapsed by the migration's own function
 * collapse_provider_favorites(). Every row has the same keys (bulk insert
 * sends NULL for missing columns). Returns how many rows were merged.
 */
export async function seedLegacySemaglutideFavorites(): Promise<number> {
  const rows = ['10', '20', '40'].map((dose, i) => ({
    favorite_id:      `aaaaaaaa-0000-4000-8000-0000000001${i}0`,
    provider_id:      TEST_IDS.provider,
    formulation_id:   TEST_IDS.glp1Formulation,
    pharmacy_id:      TEST_IDS.pharmacyTier1,
    label:            `Semaglutide ${dose} units weekly`,
    dose_amount:      dose,
    dose_unit:        'units',
    frequency_code:   'QW',
    timing_code:      'morning',
    duration_code:    '30-days',
    sig_mode:         'standard',
    sig_text:         `Inject ${dose} units subcutaneous once weekly in the morning for 30 days`,
    default_quantity: '5mL vial',
    default_refills:  1,
    use_count:        3 - i,
  }))
  const { error } = await supabase.from('provider_favorites').insert(rows)
  if (error) throw new Error(`seedLegacySemaglutideFavorites insert: ${error.message}`)
  const { data, error: rpcError } = await supabase.rpc('collapse_provider_favorites')
  if (rpcError) throw new Error(`collapse_provider_favorites: ${rpcError.message}`)
  return typeof data === 'number' ? data : 0
}

/**
 * WO-104: a prescription by the E2E provider, inserted directly (signature
 * drawing cannot be driven in CI), carrying the structured dose the
 * builder stores on medication_snapshot. Feeds the Recent strip.
 */
export async function insertRecentOrder(input: {
  formulationId: string
  medicationName: string
  prescribedDose: string
  frequencyCode: string
}): Promise<void> {
  const { error } = await supabase.from('orders').insert({
    patient_id:               TEST_IDS.patient,
    provider_id:              TEST_IDS.provider,
    catalog_item_id:          null,
    formulation_id:           input.formulationId,
    clinic_id:                TEST_IDS.clinic,
    pharmacy_id:              TEST_IDS.pharmacyTier1,
    status:                   'DRAFT',
    quantity:                 1,
    wholesale_price_snapshot: 100.00,
    retail_price_snapshot:    200.00,
    medication_snapshot:      {
      formulation_id:  input.formulationId,
      medication_name: input.medicationName,
      prescribed_dose: input.prescribedDose,
      frequency_code:  input.frequencyCode,
    },
    pharmacy_snapshot:        { pharmacy_id: TEST_IDS.pharmacyTier1, name: 'Test Pharmacy Tier1' },
    sig_text:                 'E2E recent order',
  })
  if (error) throw new Error(`insertRecentOrder: ${error.message}`)
}

/**
 * WO-103: remove favorites and protocols the E2E provider created
 * (save-as-favorite / "+ New" protocol flows). Hard delete — these are
 * clinic templates, not PHI.
 */
export async function cleanupTestFavorites(): Promise<void> {
  await supabase.from('provider_favorites').delete().eq('provider_id', TEST_IDS.provider)
  const { data: protocols } = await supabase
    .from('protocol_templates')
    .select('protocol_id')
    .eq('clinic_id', TEST_IDS.clinic)
  const ids = (protocols ?? []).map(p => p.protocol_id)
  if (ids.length === 0) return
  await supabase.from('protocol_items').delete().in('protocol_id', ids)
  await supabase.from('protocol_templates').delete().in('protocol_id', ids)
}

// ── WO-99: a controlled substance at the fax pharmacy ─────────
//
// Schedule II+ may only be signed to a Tier 4 fax pharmacy, so the EPCS
// batch-signing test needs the controlled compound offered there. Only the
// WO-99 block activates it; retire it after so the builder's pharmacy list
// for this compound is unchanged for every other spec.
export async function seedControlledAtFaxPharmacy(): Promise<void> {
  const { error } = await supabase.from('pharmacy_formulations').upsert({
    pharmacy_formulation_id:   TEST_IDS.controlledTier4PharmacyFormulation,
    pharmacy_id:               TEST_IDS.pharmacyTier4,
    formulation_id:            TEST_IDS.controlledFormulation,
    wholesale_price:           150.00,
    available_quantities:      ['10 mL vial'],
    is_available:              true,
    estimated_turnaround_days: 7,
    is_active:                 true,
  }, { onConflict: 'pharmacy_formulation_id' })
  if (error) throw new Error(`seedControlledAtFaxPharmacy: ${error.message}`)
}

export async function retireControlledAtFaxPharmacy(): Promise<void> {
  await supabase
    .from('pharmacy_formulations')
    .update({ is_active: false, is_available: false })
    .eq('pharmacy_formulation_id', TEST_IDS.controlledTier4PharmacyFormulation)
}
