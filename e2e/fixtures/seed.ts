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

  // Catalog item
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
