// ============================================================
// WO-82: Seed Formulations + Pharmacy Formulations (Phase 2)
// ============================================================
//
// Usage: npx dotenv -e .env.local -- npx tsx scripts/seed-formulations-phase2.ts
//
// Seeds actual formulations and links them to Strive Pharmacy with pricing.
// Must run AFTER seed-formulations.ts (ingredients + salt forms)
// and AFTER the migration (dosage_forms + routes seeded).

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const STRIVE_PHARMACY_ID = 'a4000000-0000-0000-0000-000000000001'

async function main() {
  console.log('╔══════════════════════════════════════════╗')
  console.log('║  Formulation Seed Phase 2 — WO-82        ║')
  console.log('╚══════════════════════════════════════════╝')

  // ── Look up reference IDs ──────────────────────────────
  const { data: dosageForms } = await supabase.from('dosage_forms').select('dosage_form_id, name')
  const { data: routes } = await supabase.from('routes_of_administration').select('route_id, name')

  if (!dosageForms || !routes) {
    console.error('Failed to load reference data. Run migration first.')
    process.exit(1)
  }

  const df = (name: string) => dosageForms.find(d => d.name === name)?.dosage_form_id
  const rt = (name: string) => routes.find(r => r.name === name)?.route_id

  // Salt form IDs (from seed-formulations.ts)
  const SF = {
    semaglutide_base:  'b2000000-0000-4000-8000-000000000001',
    test_cypionate:    'b2000000-0000-4000-8000-000000000002',
    test_enanthate:    'b2000000-0000-4000-8000-000000000003',
    naltrexone_hcl:    'b2000000-0000-4000-8000-000000000004',
    ketamine_hcl:      'b2000000-0000-4000-8000-000000000005',
    ketotifen_fumarate:'b2000000-0000-4000-8000-000000000006',
    bpc157_acetate:    'b2000000-0000-4000-8000-000000000007',
    nad_free:          'b2000000-0000-4000-8000-000000000008',
    thymosin_acetate:  'b2000000-0000-4000-8000-000000000009',
    ghkcu:             'b2000000-0000-4000-8000-000000000010',
    sermorelin_acetate:'b2000000-0000-4000-8000-000000000011',
    tirzepatide_base:  'b2000000-0000-4000-8000-000000000012',
    methylene_chloride:'b2000000-0000-4000-8000-000000000013',
  }

  // Ingredient IDs
  const ING = {
    semaglutide:    'b1000000-0000-4000-8000-000000000001',
    testosterone:   'b1000000-0000-4000-8000-000000000002',
    naltrexone:     'b1000000-0000-4000-8000-000000000003',
    ketotifen:      'b1000000-0000-4000-8000-000000000004',
    ketamine:       'b1000000-0000-4000-8000-000000000005',
    bpc157:         'b1000000-0000-4000-8000-000000000006',
    nad:            'b1000000-0000-4000-8000-000000000007',
    motsc:          'b1000000-0000-4000-8000-000000000008',
    amino1mq:       'b1000000-0000-4000-8000-000000000009',
    tb500:          'b1000000-0000-4000-8000-000000000010',
    ghkcu:          'b1000000-0000-4000-8000-000000000011',
    thymosinA1:     'b1000000-0000-4000-8000-000000000012',
    sermorelin:     'b1000000-0000-4000-8000-000000000015',
    tirzepatide:    'b1000000-0000-4000-8000-000000000016',
    methylene_blue: 'b1000000-0000-4000-8000-000000000014',
    lipo_mino:      'b1000000-0000-4000-8000-000000000020',
  }

  // ── Seed Formulations ──────────────────────────────────
  console.log('\n── Formulations ──')

  const formulations = [
    // Single-ingredient formulations
    { formulation_id: 'b3000000-0000-4000-8000-000000000001', name: 'Semaglutide 5mg/mL Injectable', salt_form_id: SF.semaglutide_base, dosage_form_id: df('Injectable Solution'), route_id: rt('Subcutaneous'), concentration: '5mg/mL', concentration_value: 5, concentration_unit: 'mg/mL', is_combination: false },
    { formulation_id: 'b3000000-0000-4000-8000-000000000002', name: 'Semaglutide 2.5mg/mL Injectable', salt_form_id: SF.semaglutide_base, dosage_form_id: df('Injectable Solution'), route_id: rt('Subcutaneous'), concentration: '2.5mg/mL', concentration_value: 2.5, concentration_unit: 'mg/mL', is_combination: false },
    { formulation_id: 'b3000000-0000-4000-8000-000000000003', name: 'Testosterone Cypionate 200mg/mL Injectable', salt_form_id: SF.test_cypionate, dosage_form_id: df('Injectable Solution'), route_id: rt('Subcutaneous'), concentration: '200mg/mL', concentration_value: 200, concentration_unit: 'mg/mL', excipient_base: 'Grapeseed Oil', is_combination: false },
    { formulation_id: 'b3000000-0000-4000-8000-000000000004', name: 'Testosterone Cypionate 200mg/mL in MCT Oil', salt_form_id: SF.test_cypionate, dosage_form_id: df('Injectable Solution'), route_id: rt('Subcutaneous'), concentration: '200mg/mL', concentration_value: 200, concentration_unit: 'mg/mL', excipient_base: 'MCT Oil', is_combination: false },
    { formulation_id: 'b3000000-0000-4000-8000-000000000005', name: 'Naltrexone HCL 1mg/mL Oral Solution (LDN)', salt_form_id: SF.naltrexone_hcl, dosage_form_id: df('Oral Solution'), route_id: rt('Oral'), concentration: '1mg/mL', concentration_value: 1, concentration_unit: 'mg/mL', is_combination: false },
    { formulation_id: 'b3000000-0000-4000-8000-000000000006', name: 'Naltrexone HCL 4.5mg Capsule (LDN)', salt_form_id: SF.naltrexone_hcl, dosage_form_id: df('Capsule'), route_id: rt('Oral'), concentration: '4.5mg', concentration_value: 4.5, concentration_unit: 'mg', is_combination: false },
    { formulation_id: 'b3000000-0000-4000-8000-000000000007', name: 'Ketotifen 1mg Capsule', salt_form_id: SF.ketotifen_fumarate, dosage_form_id: df('Capsule'), route_id: rt('Oral'), concentration: '1mg', concentration_value: 1, concentration_unit: 'mg', is_combination: false },
    { formulation_id: 'b3000000-0000-4000-8000-000000000008', name: 'Ketamine HCL 150mg RDT', salt_form_id: SF.ketamine_hcl, dosage_form_id: df('Rapid Dissolve Tablet (RDT)'), route_id: rt('Sublingual'), concentration: '150mg', concentration_value: 150, concentration_unit: 'mg', is_combination: false },
    { formulation_id: 'b3000000-0000-4000-8000-000000000009', name: 'BPC-157 5mg/mL Injectable', salt_form_id: SF.bpc157_acetate, dosage_form_id: df('Injectable Solution'), route_id: rt('Subcutaneous'), concentration: '5mg/mL', concentration_value: 5, concentration_unit: 'mg/mL', is_combination: false },
    { formulation_id: 'b3000000-0000-4000-8000-000000000010', name: 'NAD+ 200mg/mL Injectable', salt_form_id: SF.nad_free, dosage_form_id: df('Injectable Solution'), route_id: rt('Subcutaneous'), concentration: '200mg/mL', concentration_value: 200, concentration_unit: 'mg/mL', is_combination: false },
    { formulation_id: 'b3000000-0000-4000-8000-000000000011', name: 'Thymosin Alpha-1 3mg/mL Injectable', salt_form_id: SF.thymosin_acetate, dosage_form_id: df('Injectable Solution'), route_id: rt('Subcutaneous'), concentration: '3mg/mL', concentration_value: 3, concentration_unit: 'mg/mL', is_combination: false },
    { formulation_id: 'b3000000-0000-4000-8000-000000000012', name: 'GHK-Cu 2mg/mL Injectable', salt_form_id: SF.ghkcu, dosage_form_id: df('Injectable Solution'), route_id: rt('Subcutaneous'), concentration: '2mg/mL', concentration_value: 2, concentration_unit: 'mg/mL', is_combination: false },
    { formulation_id: 'b3000000-0000-4000-8000-000000000013', name: 'GHK-Cu Topical Cream', salt_form_id: SF.ghkcu, dosage_form_id: df('Topical Cream'), route_id: rt('Topical'), concentration: '0.1%', concentration_value: 0.1, concentration_unit: '%', is_combination: false },
    { formulation_id: 'b3000000-0000-4000-8000-000000000014', name: 'Methylene Blue 10mg Capsule', salt_form_id: SF.methylene_chloride, dosage_form_id: df('Capsule'), route_id: rt('Oral'), concentration: '10mg', concentration_value: 10, concentration_unit: 'mg', is_combination: false },
    { formulation_id: 'b3000000-0000-4000-8000-000000000015', name: 'Sermorelin 9mg/3mL Injectable', salt_form_id: SF.sermorelin_acetate, dosage_form_id: df('Injectable Solution'), route_id: rt('Subcutaneous'), concentration: '3mg/mL', concentration_value: 3, concentration_unit: 'mg/mL', is_combination: false },
    { formulation_id: 'b3000000-0000-4000-8000-000000000016', name: 'Tirzepatide 5mg/mL Injectable', salt_form_id: SF.tirzepatide_base, dosage_form_id: df('Injectable Solution'), route_id: rt('Subcutaneous'), concentration: '5mg/mL', concentration_value: 5, concentration_unit: 'mg/mL', is_combination: false },

    // Combination formulations (is_combination = true)
    { formulation_id: 'b3000000-0000-4000-8000-000000000020', name: 'NAD+/MOTS-c/5-Amino-1MQ 100/10/10mg Injectable', salt_form_id: null, dosage_form_id: df('Injectable Solution'), route_id: rt('Subcutaneous'), concentration: '100/10/10mg', concentration_value: null, concentration_unit: null, is_combination: true, total_ingredients: 3 },
    { formulation_id: 'b3000000-0000-4000-8000-000000000021', name: 'BPC-157/TB-500/GHK-Cu 10/10/50mg Injectable', salt_form_id: null, dosage_form_id: df('Injectable Solution'), route_id: rt('Subcutaneous'), concentration: '10/10/50mg', concentration_value: null, concentration_unit: null, is_combination: true, total_ingredients: 3 },
    { formulation_id: 'b3000000-0000-4000-8000-000000000022', name: 'Lipo-Mino Mix C 30mL Multi-Dose Vial', salt_form_id: null, dosage_form_id: df('Injectable Solution'), route_id: rt('Intramuscular'), concentration: 'Multi-ingredient', concentration_value: null, concentration_unit: null, is_combination: true, total_ingredients: 6, description: 'Lipotropic + B vitamins + MIC' },
  ]

  for (const f of formulations) {
    const { error } = await supabase.from('formulations').upsert(f, { onConflict: 'formulation_id' })
    if (error) {
      console.error(`  ✗ ${f.name}: ${error.message}`)
    } else {
      console.log(`  ✅ ${f.name}`)
    }
  }

  // ── Seed Formulation Ingredients (for combos) ──────────
  console.log('\n── Combination Ingredients ──')

  const comboIngredients = [
    // NAD+/MOTS-c/5-Amino-1MQ
    { formulation_id: 'b3000000-0000-4000-8000-000000000020', ingredient_id: ING.nad, concentration_per_unit: '100mg', concentration_value: 100, concentration_unit: 'mg', role: 'primary', sort_order: 1 },
    { formulation_id: 'b3000000-0000-4000-8000-000000000020', ingredient_id: ING.motsc, concentration_per_unit: '10mg', concentration_value: 10, concentration_unit: 'mg', role: 'adjuvant', sort_order: 2 },
    { formulation_id: 'b3000000-0000-4000-8000-000000000020', ingredient_id: ING.amino1mq, concentration_per_unit: '10mg', concentration_value: 10, concentration_unit: 'mg', role: 'adjuvant', sort_order: 3 },
    // BPC-157/TB-500/GHK-Cu
    { formulation_id: 'b3000000-0000-4000-8000-000000000021', ingredient_id: ING.bpc157, concentration_per_unit: '10mg', concentration_value: 10, concentration_unit: 'mg', role: 'primary', sort_order: 1 },
    { formulation_id: 'b3000000-0000-4000-8000-000000000021', ingredient_id: ING.tb500, concentration_per_unit: '10mg', concentration_value: 10, concentration_unit: 'mg', role: 'adjuvant', sort_order: 2 },
    { formulation_id: 'b3000000-0000-4000-8000-000000000021', ingredient_id: ING.ghkcu, concentration_per_unit: '50mg', concentration_value: 50, concentration_unit: 'mg', role: 'adjuvant', sort_order: 3 },
  ]

  for (const ci of comboIngredients) {
    const { error } = await supabase.from('formulation_ingredients').upsert(ci, { onConflict: 'formulation_id, ingredient_id' })
    if (error) {
      console.error(`  ✗ combo ingredient: ${error.message}`)
    } else {
      console.log(`  ✅ ${ci.concentration_per_unit} ingredient linked`)
    }
  }

  // ── Seed Pharmacy Formulations (Strive Pharmacy pricing) ──
  console.log('\n── Pharmacy Formulations (Strive Pharmacy) ──')

  const pharmacyFormulations = [
    { pharmacy_id: STRIVE_PHARMACY_ID, formulation_id: 'b3000000-0000-4000-8000-000000000001', wholesale_price: 150.00, available_quantities: '["5mL vial", "2.5mL vial"]', estimated_turnaround_days: 5 },
    { pharmacy_id: STRIVE_PHARMACY_ID, formulation_id: 'b3000000-0000-4000-8000-000000000002', wholesale_price: 125.00, available_quantities: '["5mL vial"]', estimated_turnaround_days: 5 },
    { pharmacy_id: STRIVE_PHARMACY_ID, formulation_id: 'b3000000-0000-4000-8000-000000000003', wholesale_price: 85.00, available_quantities: '["10mL vial", "5mL vial"]', estimated_turnaround_days: 3 },
    { pharmacy_id: STRIVE_PHARMACY_ID, formulation_id: 'b3000000-0000-4000-8000-000000000004', wholesale_price: 90.00, available_quantities: '["10mL vial"]', estimated_turnaround_days: 3 },
    { pharmacy_id: STRIVE_PHARMACY_ID, formulation_id: 'b3000000-0000-4000-8000-000000000005', wholesale_price: 79.95, available_quantities: '["60mL bottle"]', estimated_turnaround_days: 5 },
    { pharmacy_id: STRIVE_PHARMACY_ID, formulation_id: 'b3000000-0000-4000-8000-000000000006', wholesale_price: 45.00, available_quantities: '["30 capsules", "90 capsules"]', estimated_turnaround_days: 3 },
    { pharmacy_id: STRIVE_PHARMACY_ID, formulation_id: 'b3000000-0000-4000-8000-000000000007', wholesale_price: 35.00, available_quantities: '["90 capsules", "360 capsules"]', estimated_turnaround_days: 3 },
    { pharmacy_id: STRIVE_PHARMACY_ID, formulation_id: 'b3000000-0000-4000-8000-000000000008', wholesale_price: 120.00, available_quantities: '["30 tablets", "90 tablets"]', estimated_turnaround_days: 5 },
    { pharmacy_id: STRIVE_PHARMACY_ID, formulation_id: 'b3000000-0000-4000-8000-000000000009', wholesale_price: 110.00, available_quantities: '["5mL vial"]', estimated_turnaround_days: 5 },
    { pharmacy_id: STRIVE_PHARMACY_ID, formulation_id: 'b3000000-0000-4000-8000-000000000010', wholesale_price: 95.00, available_quantities: '["5mL vial"]', estimated_turnaround_days: 5 },
    { pharmacy_id: STRIVE_PHARMACY_ID, formulation_id: 'b3000000-0000-4000-8000-000000000011', wholesale_price: 145.00, available_quantities: '["3mL vial"]', estimated_turnaround_days: 7 },
    { pharmacy_id: STRIVE_PHARMACY_ID, formulation_id: 'b3000000-0000-4000-8000-000000000012', wholesale_price: 75.00, available_quantities: '["5mL vial"]', estimated_turnaround_days: 5 },
    { pharmacy_id: STRIVE_PHARMACY_ID, formulation_id: 'b3000000-0000-4000-8000-000000000014', wholesale_price: 40.00, available_quantities: '["30 capsules"]', estimated_turnaround_days: 3 },
    { pharmacy_id: STRIVE_PHARMACY_ID, formulation_id: 'b3000000-0000-4000-8000-000000000015', wholesale_price: 195.00, available_quantities: '["3mL vial"]', estimated_turnaround_days: 7 },
    { pharmacy_id: STRIVE_PHARMACY_ID, formulation_id: 'b3000000-0000-4000-8000-000000000016', wholesale_price: 225.00, available_quantities: '["2.5mL vial", "5mL vial"]', estimated_turnaround_days: 5 },
    { pharmacy_id: STRIVE_PHARMACY_ID, formulation_id: 'b3000000-0000-4000-8000-000000000020', wholesale_price: 175.00, available_quantities: '["5mL vial"]', estimated_turnaround_days: 7 },
    { pharmacy_id: STRIVE_PHARMACY_ID, formulation_id: 'b3000000-0000-4000-8000-000000000021', wholesale_price: 185.00, available_quantities: '["5mL vial"]', estimated_turnaround_days: 7 },
    { pharmacy_id: STRIVE_PHARMACY_ID, formulation_id: 'b3000000-0000-4000-8000-000000000022', wholesale_price: 65.00, available_quantities: '["30mL multi-dose vial"]', estimated_turnaround_days: 5 },
  ]

  for (const pf of pharmacyFormulations) {
    const { error } = await supabase.from('pharmacy_formulations').upsert(
      { ...pf, available_quantities: JSON.parse(pf.available_quantities) },
      { onConflict: 'pharmacy_id, formulation_id' }
    )
    if (error) {
      console.error(`  ✗ formulation ${pf.formulation_id.slice(-4)}: ${error.message}`)
    } else {
      console.log(`  ✅ $${pf.wholesale_price} — formulation ...${pf.formulation_id.slice(-4)}`)
    }
  }

  console.log('\n✅ Phase 2 seed complete.')
  console.log(`   ${formulations.length} formulations seeded`)
  console.log(`   ${comboIngredients.length} combination ingredients linked`)
  console.log(`   ${pharmacyFormulations.length} pharmacy formulations with pricing`)
}

main().catch(err => {
  console.error('Seed failed:', err)
  process.exit(1)
})
