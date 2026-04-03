// ============================================================
// POC Seed Script — WO-54
// ============================================================
//
// Creates all data required for a CompoundIQ POC demo:
//   - 4 Supabase Auth users (ops_admin, clinic_admin, provider, medical_assistant)
//   - 1 clinic (Sunrise Functional Medicine)
//   - 1 provider (Dr. Sarah Chen)
//   - 1 patient (Alex Demo — for E2E checkout flow)
//   - 1 pharmacy (Strive Pharmacy — Tier 4 fax, works without API credentials)
//   - 1 pharmacy state license (TX)
//   - 5 catalog items
//   - Verifies 7 SMS templates are present
//
// Usage:
//   npm run seed:poc
//   (runs: dotenv -e .env.local -- tsx scripts/seed-poc.ts)
//
// Idempotent: safe to run multiple times.
// - Auth users: upserts password + metadata on existing users (prevents credential drift)
// - Database records: existing records are skipped (checked by deterministic UUID or unique key)
// Uses deterministic UUIDs so each entity has a stable, known ID.
//
// ⚠️  Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.local
// ⚠️  Requires: STRIPE_CONNECT_TEST_ACCOUNT_ID in .env.local (from WO-53 Stripe setup)
// ⚠️  All data is fake — no real patients, no real credentials

import { createClient } from '@supabase/supabase-js'

// ============================================================
// CONFIG
// ============================================================

const SUPABASE_URL            = process.env['SUPABASE_URL']
const SUPABASE_SERVICE_ROLE   = process.env['SUPABASE_SERVICE_ROLE_KEY']
const STRIPE_CONNECT_ACCT     = process.env['STRIPE_CONNECT_TEST_ACCOUNT_ID']

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
  console.error('❌  Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — check .env.local')
  process.exit(1)
}

// NB-3 (cowork): warn early on missing Stripe Connect account — the silent fallback
// would seed the clinic with an invalid acct_ ID, causing opaque Stripe errors during
// payment intent creation. Warn now so the operator can set the var before continuing.
if (!STRIPE_CONNECT_ACCT) {
  console.warn(
    '⚠️   STRIPE_CONNECT_TEST_ACCOUNT_ID is not set. The clinic will be seeded with a\n' +
    '    placeholder Stripe Connect account (acct_poc_not_configured). Payment intents\n' +
    '    will fail. Set this var in .env.local (see docs/poc-setup.md Step 4) before\n' +
    '    running the E2E payment flow.\n'
  )
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
  auth: { persistSession: false },
})

// ============================================================
// DETERMINISTIC UUIDs
// ============================================================
// Hardcoded so the script is fully idempotent — re-runs insert
// the same IDs and the ON CONFLICT / existence checks skip them.

const IDS = {
  clinic:   'a1000000-0000-0000-0000-000000000001',
  provider: 'a2000000-0000-0000-0000-000000000001',
  patient:  'a3000000-0000-0000-0000-000000000001',
  pharmacy: 'a4000000-0000-0000-0000-000000000001',
  catalog: {
    semaglutide:  'a5000000-0000-0000-0000-000000000001',
    tirzepatide:  'a5000000-0000-0000-0000-000000000002',
    testosterone: 'a5000000-0000-0000-0000-000000000003',
    sermorelin:   'a5000000-0000-0000-0000-000000000004',
    naltrexone:   'a5000000-0000-0000-0000-000000000005',
  },
}

// ============================================================
// AUTH USERS
// ============================================================

const AUTH_USERS = [
  {
    email:    'ops@compoundiq-poc.com',
    password: 'POCAdmin2026!',
    user_metadata: { app_role: 'ops_admin' },
    label: 'ops_admin',
  },
  {
    email:    'admin@sunrise-clinic.com',
    password: 'POCClinic2026!',
    user_metadata: { app_role: 'clinic_admin', clinic_id: IDS.clinic },
    label: 'clinic_admin',
  },
  {
    email:    'dr.chen@sunrise-clinic.com',
    password: 'POCProvider2026!',
    user_metadata: { app_role: 'provider', clinic_id: IDS.clinic },
    label: 'provider',
  },
  {
    email:    'ma@sunrise-clinic.com',
    password: 'POCMA2026!',
    user_metadata: { app_role: 'medical_assistant', clinic_id: IDS.clinic },
    label: 'medical_assistant',
  },
]

async function createAuthUsers() {
  console.log('\n── Auth Users ──')

  // Fetch existing users once to avoid per-user list calls
  // NB-01: listUsers defaults to page size 50. Use perPage:1000 to avoid silently
  // truncating the list and re-attempting to create already-existing users.
  const { data: { users: existingUsers }, error: listError } = await supabase.auth.admin.listUsers({ perPage: 1000 })
  if (listError) {
    throw new Error(`Failed to list auth users: ${listError.message}`)
  }
  const existingEmails = new Set(existingUsers.map(u => u.email))

  for (const user of AUTH_USERS) {
    if (existingEmails.has(user.email)) {
      // Upsert: sync password and metadata to canonical values (prevents credential drift)
      const existing = existingUsers.find(u => u.email === user.email)
      if (existing) {
        const { error: updateError } = await supabase.auth.admin.updateUserById(existing.id, {
          password:       user.password,
          user_metadata:  user.user_metadata,
        })
        if (updateError) {
          throw new Error(`Failed to sync ${user.label} (${user.email}): ${updateError.message}`)
        }
        console.log(`  🔄  ${user.label} (${user.email}) — exists, credentials synced`)
      }
      continue
    }

    const { error } = await supabase.auth.admin.createUser({
      email:          user.email,
      password:       user.password,
      user_metadata:  user.user_metadata,
      email_confirm:  true,   // skip email verification for POC
    })

    if (error) {
      throw new Error(`Failed to create ${user.label} (${user.email}): ${error.message}`)
    }

    console.log(`  ✅  ${user.label} (${user.email}) — created`)
  }
}

// ============================================================
// CLINIC
// ============================================================

async function seedClinic() {
  console.log('\n── Clinic ──')

  const { data: existing } = await supabase
    .from('clinics')
    .select('clinic_id')
    .eq('clinic_id', IDS.clinic)
    .maybeSingle()

  if (existing) {
    console.log('  ⏭  Sunrise Functional Medicine — already exists, skipped')
    return
  }

  const { error } = await supabase.from('clinics').insert({
    clinic_id:                  IDS.clinic,
    name:                       'Sunrise Functional Medicine',
    stripe_connect_account_id:  STRIPE_CONNECT_ACCT ?? 'acct_poc_not_configured',
    stripe_connect_status:      'ACTIVE',
    is_active:                  true,
    default_markup_pct:         40,
    order_intake_blocked:       false,
  })

  if (error) throw new Error(`Failed to seed clinic: ${error.message}`)
  console.log('  ✅  Sunrise Functional Medicine — created')
}

// ============================================================
// PROVIDER
// ============================================================

async function seedProvider() {
  console.log('\n── Provider ──')

  const { data: existing } = await supabase
    .from('providers')
    .select('provider_id')
    .eq('provider_id', IDS.provider)
    .maybeSingle()

  if (existing) {
    console.log('  ⏭  Dr. Sarah Chen — already exists, skipped')
    return
  }

  const { error } = await supabase.from('providers').insert({
    provider_id:      IDS.provider,
    clinic_id:        IDS.clinic,
    first_name:       'Sarah',
    last_name:        'Chen',
    npi_number:       '1234567890',
    license_state:    'TX',
    license_number:   'TX-MD-001234',
    signature_on_file: true,
    is_active:        true,
  })

  if (error) throw new Error(`Failed to seed provider: ${error.message}`)
  console.log('  ✅  Dr. Sarah Chen — created')
}

// ============================================================
// PATIENT
// ============================================================

async function seedPatient() {
  console.log('\n── Patient ──')

  const { data: existing } = await supabase
    .from('patients')
    .select('patient_id')
    .eq('patient_id', IDS.patient)
    .maybeSingle()

  if (existing) {
    console.log('  ⏭  Alex Demo — already exists, skipped')
    return
  }

  const { error } = await supabase.from('patients').insert({
    patient_id:    IDS.patient,
    clinic_id:     IDS.clinic,
    first_name:    'Alex',
    last_name:     'Demo',
    date_of_birth: '1985-06-15',
    phone:         '+15125550199',
    email:         'patient@compoundiq-poc.com',
    state:         'TX',
    sms_opt_in:    true,
    is_active:     true,
  })

  if (error) throw new Error(`Failed to seed patient: ${error.message}`)
  console.log('  ✅  Alex Demo — created')
}

// ============================================================
// PHARMACY
// ============================================================

async function seedPharmacy() {
  console.log('\n── Pharmacy ──')

  const { data: existing } = await supabase
    .from('pharmacies')
    .select('pharmacy_id')
    .eq('pharmacy_id', IDS.pharmacy)
    .maybeSingle()

  if (existing) {
    console.log('  ⏭  Strive Pharmacy — already exists, skipped')
    return
  }

  // NB-02: POC_FAX_NUMBER defaults to the demo patient's phone — intentional for
  // offline demos (fax goes nowhere real). For live fax testing, set POC_FAX_NUMBER
  // to an actual test fax endpoint (e.g. a Documo sandbox number).
  const faxNumber = process.env['POC_FAX_NUMBER'] ?? '+15125550199'

  const { error } = await supabase.from('pharmacies').insert({
    pharmacy_id:       IDS.pharmacy,
    name:              'Strive Pharmacy',
    slug:              'strive',
    integration_tier:  'TIER_4_FAX',
    fax_number:        faxNumber,
    is_active:         true,
    adapter_status:    'green',
    timezone:          'America/Chicago',
  })

  if (error) throw new Error(`Failed to seed pharmacy: ${error.message}`)
  console.log(`  ✅  Strive Pharmacy — created (fax: ${faxNumber})`)
}

// ============================================================
// PHARMACY STATE LICENSE
// ============================================================

async function seedPharmacyLicense() {
  console.log('\n── Pharmacy State License ──')

  const { data: existing } = await supabase
    .from('pharmacy_state_licenses')
    .select('pharmacy_id')
    .eq('pharmacy_id', IDS.pharmacy)
    .eq('state_code', 'TX')
    .maybeSingle()

  if (existing) {
    console.log('  ⏭  Strive Pharmacy / TX — already exists, skipped')
    return
  }

  const { error } = await supabase.from('pharmacy_state_licenses').insert({
    pharmacy_id:     IDS.pharmacy,
    state_code:      'TX',
    license_number:  'TX-PHARM-001',
    expiration_date: '2030-12-31',
    is_active:       true,
  })

  if (error) throw new Error(`Failed to seed pharmacy license: ${error.message}`)
  console.log('  ✅  Strive Pharmacy / TX — created')
}

// ============================================================
// CATALOG
// ============================================================

const CATALOG_ITEMS = [
  { item_id: IDS.catalog.semaglutide,  medication_name: 'Semaglutide',  form: 'Injectable', dose: '0.5mg/0.5mL',  wholesale_price: 150.00, retail_price: 250.00 },
  { item_id: IDS.catalog.tirzepatide,  medication_name: 'Tirzepatide',  form: 'Injectable', dose: '2.5mg/0.5mL',  wholesale_price: 180.00, retail_price: 300.00 },
  { item_id: IDS.catalog.testosterone, medication_name: 'Testosterone', form: 'Cream',       dose: '100mg/mL',     wholesale_price:  80.00, retail_price: 160.00 },
  { item_id: IDS.catalog.sermorelin,   medication_name: 'Sermorelin',   form: 'Injectable', dose: '300mcg/mL',    wholesale_price:  90.00, retail_price: 175.00 },
  { item_id: IDS.catalog.naltrexone,   medication_name: 'Naltrexone',   form: 'Capsule',     dose: '4.5mg',        wholesale_price:  40.00, retail_price:  80.00 },
]

async function seedCatalog() {
  console.log('\n── Catalog ──')

  for (const item of CATALOG_ITEMS) {
    const { data: existing } = await supabase
      .from('catalog')
      .select('item_id')
      .eq('item_id', item.item_id)
      .maybeSingle()

    if (existing) {
      console.log(`  ⏭  ${item.medication_name} — already exists, skipped`)
      continue
    }

    const { error } = await supabase.from('catalog').insert({
      item_id:            item.item_id,
      pharmacy_id:        IDS.pharmacy,
      medication_name:    item.medication_name,
      form:               item.form,
      dose:               item.dose,
      wholesale_price:    item.wholesale_price,
      retail_price:       item.retail_price,
      regulatory_status:  'ACTIVE',
      requires_prior_auth: false,
      is_active:          true,
    })

    if (error) throw new Error(`Failed to seed catalog item ${item.medication_name}: ${error.message}`)
    console.log(`  ✅  ${item.medication_name} ${item.dose} — created`)
  }
}

// ============================================================
// SMS TEMPLATES VERIFICATION
// ============================================================

const REQUIRED_SMS_TEMPLATES = [
  'payment_link',
  'reminder_24h',
  'reminder_48h',
  'payment_confirmation',
  'shipping_notification',
  'delivered',
  'custom',
]

async function verifySmsTemplates() {
  console.log('\n── SMS Templates ──')

  const { data, error } = await supabase
    .from('sms_templates')
    .select('template_name')
    .eq('is_active', true)

  if (error) throw new Error(`Failed to query sms_templates: ${error.message}`)

  const present = new Set((data ?? []).map(r => r.template_name as string))
  const missing = REQUIRED_SMS_TEMPLATES.filter(t => !present.has(t))

  if (missing.length === 0) {
    console.log(`  ✅  All ${REQUIRED_SMS_TEMPLATES.length} SMS templates present`)
    return
  }

  console.warn(`  ⚠️  Missing SMS templates: ${missing.join(', ')}`)
  console.warn('     Run: supabase db push to apply migration 20260319000003_wo26_sms_notifications')
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log('╔══════════════════════════════════════════╗')
  console.log('║    CompoundIQ POC Seed Script — WO-54    ║')
  console.log('╚══════════════════════════════════════════╝')
  console.log(`  Supabase: ${SUPABASE_URL}`)
  console.log(`  Stripe Connect account: ${STRIPE_CONNECT_ACCT}`)

  try {
    await createAuthUsers()
    await seedClinic()
    await seedProvider()
    await seedPatient()
    await seedPharmacy()
    await seedPharmacyLicense()
    await seedCatalog()
    await verifySmsTemplates()

    console.log('\n✅  Seed complete. Test credentials:')
    console.log('   ops@compoundiq-poc.com      / POCAdmin2026!')
    console.log('   admin@sunrise-clinic.com    / POCClinic2026!')
    console.log('   dr.chen@sunrise-clinic.com  / POCProvider2026!')
    console.log('   ma@sunrise-clinic.com       / POCMA2026!')
  } catch (err) {
    console.error('\n❌  Seed failed:', err instanceof Error ? err.message : err)
    process.exit(1)
  }
}

main()
