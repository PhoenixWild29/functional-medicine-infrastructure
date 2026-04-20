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
  patient:       'aaaaaaaa-0000-0000-0000-000000000003',
  pharmacyTier1: 'aaaaaaaa-0000-0000-0000-000000000010',
  pharmacyTier2: 'aaaaaaaa-0000-0000-0000-000000000011',
  pharmacyTier4: 'aaaaaaaa-0000-0000-0000-000000000013',
  catalogItem:   'aaaaaaaa-0000-0000-0000-000000000020',
  // V3 hierarchical catalog (WO-82/87) — used by cascading prescription builder
  ingredient:         'aaaaaaaa-0000-0000-0000-000000000030',
  saltForm:           'aaaaaaaa-0000-0000-0000-000000000031',
  formulation:        'aaaaaaaa-0000-0000-0000-000000000032',
  pharmacyFormulation:'aaaaaaaa-0000-0000-0000-000000000033',
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
    stripe_connect_account_id: 'acct_test_e2e',
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

  // Patient
  await supabase.from('patients').upsert({
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
  }, { onConflict: 'patient_id' })

  // Pharmacies (Tier 1, 2, 4)
  await supabase.from('pharmacies').upsert([
    {
      pharmacy_id:     TEST_IDS.pharmacyTier1,
      name:            'Test Pharmacy Tier1',
      slug:            'test-tier1',
      integration_tier: 'TIER_1_API',
      is_active:       true,
    },
    {
      pharmacy_id:     TEST_IDS.pharmacyTier2,
      name:            'Test Pharmacy Tier2',
      slug:            'test-tier2',
      integration_tier: 'TIER_2_PORTAL',
      is_active:       true,
    },
    {
      pharmacy_id:     TEST_IDS.pharmacyTier4,
      name:            'Test Pharmacy Tier4',
      slug:            'test-tier4',
      integration_tier: 'TIER_4_FAX',
      fax_number:      '+15550000099',
      is_active:       true,
    },
  ], { onConflict: 'pharmacy_id' })

  // State licenses for TX (required for state-compliance search)
  await supabase.from('pharmacy_state_licenses').upsert([
    { pharmacy_id: TEST_IDS.pharmacyTier1, state_code: 'TX', license_number: 'TX-TEST-001', expiration_date: '2030-12-31', is_active: true },
    { pharmacy_id: TEST_IDS.pharmacyTier2, state_code: 'TX', license_number: 'TX-TEST-002', expiration_date: '2030-12-31', is_active: true },
    { pharmacy_id: TEST_IDS.pharmacyTier4, state_code: 'TX', license_number: 'TX-TEST-004', expiration_date: '2030-12-31', is_active: true },
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
  }, { onConflict: 'formulation_id' })

  // Pharmacy formulation — wholesale price $100 matches the inline retail-
  // validation test which tries to set retail to $50 (below wholesale).
  await supabase.from('pharmacy_formulations').upsert({
    pharmacy_formulation_id:   TEST_IDS.pharmacyFormulation,
    pharmacy_id:               TEST_IDS.pharmacyTier1,
    formulation_id:            TEST_IDS.formulation,
    wholesale_price:           100.00,
    available_quantities:      ['30', '60', '90'],
    is_available:              true,
    estimated_turnaround_days: 5,
    is_active:                 true,
  }, { onConflict: 'pharmacy_formulation_id' })

  // Smoke-test: walk the full cascade and fail loud if any level returns 0
  // rows. Turns a silent UI timeout into an actionable seed error.
  await assertV3CascadeVisible()
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
