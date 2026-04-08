// ============================================================
// WO-85: Seed Provider Favorites + Protocol Templates
// ============================================================
//
// Usage: npx dotenv -e .env.local -- npx tsx scripts/seed-favorites-protocols.ts
//
// Seeds sample favorites for Dr. Sarah Chen and a Weight Loss
// protocol template for Sunrise Clinic. Idempotent via upsert.

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ── Known IDs from seed-poc.ts and seed-formulations.ts ─────

const IDS = {
  clinic:     'a1000000-0000-0000-0000-000000000001',
  provider:   'a2000000-0000-0000-0000-000000000001',
  pharmacy:   'a4000000-0000-0000-0000-000000000001',
  // Formulations (b3 series)
  sema5:      'b3000000-0000-4000-8000-000000000001',
  testCyp:    'b3000000-0000-4000-8000-000000000003',
  ldnSoln:    'b3000000-0000-4000-8000-000000000005',
  ketotifen:  'b3000000-0000-4000-8000-000000000007',
  bpc157:     'b3000000-0000-4000-8000-000000000009',
  nad200:     'b3000000-0000-4000-8000-000000000010',
  thymosin:   'b3000000-0000-4000-8000-000000000011',
  lipoMino:   'b3000000-0000-4000-8000-000000000022',
  // Favorites (deterministic)
  fav1:       'c1000000-0000-4000-8000-000000000001',
  fav2:       'c1000000-0000-4000-8000-000000000002',
  fav3:       'c1000000-0000-4000-8000-000000000003',
  fav4:       'c1000000-0000-4000-8000-000000000004',
  // Protocols
  proto1:     'c2000000-0000-4000-8000-000000000001',
  proto2:     'c2000000-0000-4000-8000-000000000002',
}

async function main() {
  console.log('╔══════════════════════════════════════════╗')
  console.log('║  WO-85: Seed Favorites + Protocols       ║')
  console.log('╚══════════════════════════════════════════╝')

  // ── 1. Provider Favorites ──────────────────────────────
  console.log('\n── Provider Favorites (Dr. Sarah Chen) ──')

  const favorites = [
    {
      favorite_id: IDS.fav1,
      provider_id: IDS.provider,
      formulation_id: IDS.sema5,
      pharmacy_id: IDS.pharmacy,
      label: 'Semaglutide 0.5mg weekly',
      dose_amount: '10',
      dose_unit: 'units',
      frequency_code: 'QW',
      timing_code: 'MORNING',
      sig_mode: 'standard',
      sig_text: 'Inject 10 units (0.10mL / 0.50mg) subcutaneous once weekly in the morning',
      default_quantity: '5mL vial',
      default_refills: 2,
      use_count: 12,
    },
    {
      favorite_id: IDS.fav2,
      provider_id: IDS.provider,
      formulation_id: IDS.testCyp,
      pharmacy_id: IDS.pharmacy,
      label: 'Standard TRT — Cyp 200mg',
      dose_amount: '70',
      dose_unit: 'mg',
      frequency_code: 'Q2W',
      sig_mode: 'standard',
      sig_text: 'Inject 35 units (0.35mL / 70mg) subcutaneous every 2 weeks',
      default_quantity: '10mL vial',
      default_refills: 3,
      use_count: 8,
    },
    {
      favorite_id: IDS.fav3,
      provider_id: IDS.provider,
      formulation_id: IDS.ldnSoln,
      pharmacy_id: IDS.pharmacy,
      label: 'LDN Starter — Titration',
      dose_amount: '0.1',
      dose_unit: 'mL',
      frequency_code: 'QHS',
      timing_code: 'BEDTIME',
      sig_mode: 'titration',
      sig_text: 'Take 0.1mL (0.10mg) oral at bedtime. Titrate up by 0.1mL every 3-4 days as tolerated up to 0.5mL (0.50mg)',
      default_quantity: '60mL',
      default_refills: 2,
      use_count: 5,
    },
    {
      favorite_id: IDS.fav4,
      provider_id: IDS.provider,
      formulation_id: IDS.bpc157,
      pharmacy_id: IDS.pharmacy,
      label: 'BPC-157 daily cycling',
      dose_amount: '1',
      dose_unit: 'mg',
      frequency_code: 'QD',
      sig_mode: 'cycling',
      sig_text: 'Inject 20 units (0.20mL / 1mg) subcutaneous once daily, 5 days on / 2 days off, for 6 weeks then reassess',
      default_quantity: '5mL vial',
      default_refills: 0,
      use_count: 3,
    },
  ]

  for (const fav of favorites) {
    const { error } = await supabase.from('provider_favorites').upsert(fav, { onConflict: 'favorite_id' })
    if (error) {
      console.error(`  FAIL: ${fav.label} — ${error.message}`)
    } else {
      console.log(`  OK: ${fav.label}`)
    }
  }

  // ── 2. Protocol Templates ──────────────────────────────
  console.log('\n── Protocol Templates (Sunrise Clinic) ──')

  const protocols = [
    {
      protocol_id: IDS.proto1,
      clinic_id: IDS.clinic,
      created_by: IDS.provider,
      name: 'Weight Loss Protocol',
      description: 'Standard weight loss protocol: Semaglutide titration + BPC-157 for GI support + Lipo-Mino for energy',
      therapeutic_category: 'Weight Loss',
      total_duration_weeks: 12,
      is_active: true,
      use_count: 4,
    },
    {
      protocol_id: IDS.proto2,
      clinic_id: IDS.clinic,
      created_by: IDS.provider,
      name: 'Mold/MCAS Support',
      description: 'Mast cell stabilization + immune modulation for mold exposure patients',
      therapeutic_category: 'Autoimmune',
      total_duration_weeks: 8,
      is_active: true,
      use_count: 2,
    },
  ]

  for (const proto of protocols) {
    const { error } = await supabase.from('protocol_templates').upsert(proto, { onConflict: 'protocol_id' })
    if (error) {
      console.error(`  FAIL: ${proto.name} — ${error.message}`)
    } else {
      console.log(`  OK: ${proto.name}`)
    }
  }

  // ── 3. Protocol Items ──────────────────────────────────
  console.log('\n── Protocol Items ──')

  const items = [
    // Weight Loss Protocol
    {
      item_id: 'c3000000-0000-4000-8000-000000000001',
      protocol_id: IDS.proto1,
      formulation_id: IDS.sema5,
      pharmacy_id: IDS.pharmacy,
      phase_name: 'Initiation',
      phase_start_week: 1,
      phase_end_week: 4,
      dose_amount: '0.25',
      dose_unit: 'mg',
      frequency_code: 'QW',
      timing_code: 'MORNING',
      sig_mode: 'titration',
      sig_text: 'Inject 5 units (0.05mL / 0.25mg) subcutaneous once weekly. Titrate up by 0.25mg every 4 weeks as tolerated up to 2.5mg',
      default_quantity: '5mL vial',
      default_refills: 2,
      sort_order: 1,
    },
    {
      item_id: 'c3000000-0000-4000-8000-000000000002',
      protocol_id: IDS.proto1,
      formulation_id: IDS.bpc157,
      pharmacy_id: IDS.pharmacy,
      phase_name: 'Initiation',
      phase_start_week: 1,
      phase_end_week: 6,
      dose_amount: '300',
      dose_unit: 'mcg',
      frequency_code: 'QD',
      sig_mode: 'standard',
      sig_text: 'Inject 300mcg subcutaneous once daily for GI support',
      default_quantity: '5mL vial',
      sort_order: 2,
    },
    {
      item_id: 'c3000000-0000-4000-8000-000000000003',
      protocol_id: IDS.proto1,
      formulation_id: IDS.lipoMino,
      pharmacy_id: IDS.pharmacy,
      phase_name: 'Ongoing',
      phase_start_week: 1,
      phase_end_week: 12,
      dose_amount: '1',
      dose_unit: 'mL',
      frequency_code: 'QOD',
      sig_mode: 'standard',
      sig_text: 'Inject 1mL intramuscularly every other day',
      default_quantity: '30mL vial',
      sort_order: 3,
    },
    // Mold/MCAS Protocol
    {
      item_id: 'c3000000-0000-4000-8000-000000000004',
      protocol_id: IDS.proto2,
      formulation_id: IDS.ketotifen,
      pharmacy_id: IDS.pharmacy,
      phase_name: 'Baseline',
      phase_start_week: 1,
      phase_end_week: 8,
      dose_amount: '1',
      dose_unit: 'capsule',
      frequency_code: 'QID',
      sig_mode: 'standard',
      sig_text: 'Take 1 capsule by mouth four times daily with meals and at bedtime',
      default_quantity: '360 capsules',
      default_refills: 1,
      sort_order: 1,
    },
    {
      item_id: 'c3000000-0000-4000-8000-000000000005',
      protocol_id: IDS.proto2,
      formulation_id: IDS.ldnSoln,
      pharmacy_id: IDS.pharmacy,
      phase_name: 'Week 2+',
      phase_start_week: 2,
      phase_end_week: 8,
      dose_amount: '0.1',
      dose_unit: 'mL',
      frequency_code: 'QHS',
      timing_code: 'BEDTIME',
      sig_mode: 'titration',
      sig_text: 'Take 0.1mL by mouth at bedtime. Titrate up by 0.1mL every 3-4 days as tolerated up to 0.5mL (0.5mg)',
      default_quantity: '60mL',
      default_refills: 2,
      sort_order: 2,
    },
    {
      item_id: 'c3000000-0000-4000-8000-000000000006',
      protocol_id: IDS.proto2,
      formulation_id: IDS.thymosin,
      pharmacy_id: IDS.pharmacy,
      phase_name: 'Immune Modulation',
      phase_start_week: 1,
      phase_end_week: 6,
      dose_amount: '1',
      dose_unit: 'mg',
      frequency_code: 'QD',
      sig_mode: 'cycling',
      sig_text: 'Inject 1mg subcutaneous daily, 5 days on / 2 days off, for 6 weeks then reassess',
      default_quantity: '5mL vial',
      sort_order: 3,
    },
  ]

  for (const item of items) {
    const { error } = await supabase.from('protocol_items').upsert(item, { onConflict: 'item_id' })
    if (error) {
      console.error(`  FAIL: sort_order ${item.sort_order} in ${item.protocol_id} — ${error.message}`)
    } else {
      console.log(`  OK: ${item.phase_name} — ${item.sig_text?.substring(0, 50)}...`)
    }
  }

  console.log('\nDone!')
}

main().catch(err => {
  console.error('Seed failed:', err)
  process.exit(1)
})
