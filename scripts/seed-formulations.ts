// ============================================================
// WO-82: Seed Hierarchical Catalog — Formulations from Real Protocols
// ============================================================
//
// Usage: npx dotenv -e .env.local -- npx tsx scripts/seed-formulations.ts
//
// Populates ingredients, salt_forms, formulations, formulation_ingredients,
// and pharmacy_formulations based on Lauren's real protocol data.
//
// Idempotent: safe to run multiple times. Uses upsert pattern.

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ── Deterministic IDs for stable references ────────────────

const IDS = {
  // Ingredients
  semaglutide:      'b1000000-0000-4000-8000-000000000001',
  testosterone:     'b1000000-0000-4000-8000-000000000002',
  naltrexone:       'b1000000-0000-4000-8000-000000000003',
  ketotifen:        'b1000000-0000-4000-8000-000000000004',
  ketamine:         'b1000000-0000-4000-8000-000000000005',
  bpc157:           'b1000000-0000-4000-8000-000000000006',
  nad:              'b1000000-0000-4000-8000-000000000007',
  motsc:            'b1000000-0000-4000-8000-000000000008',
  amino1mq:         'b1000000-0000-4000-8000-000000000009',
  tb500:            'b1000000-0000-4000-8000-000000000010',
  ghkcu:            'b1000000-0000-4000-8000-000000000011',
  thymosinA1:       'b1000000-0000-4000-8000-000000000012',
  dsip:             'b1000000-0000-4000-8000-000000000013',
  methylene_blue:   'b1000000-0000-4000-8000-000000000014',
  sermorelin:       'b1000000-0000-4000-8000-000000000015',
  tirzepatide:      'b1000000-0000-4000-8000-000000000016',
  progesterone:     'b1000000-0000-4000-8000-000000000017',
  dhea:             'b1000000-0000-4000-8000-000000000018',
  glutathione:      'b1000000-0000-4000-8000-000000000019',
  lipo_mino:        'b1000000-0000-4000-8000-000000000020',

  // Pharmacy (existing seed pharmacy — matches seed-poc.ts)
  strivePharmacy:   'a4000000-0000-0000-0000-000000000001',
}

async function main() {
  console.log('╔══════════════════════════════════════════╗')
  console.log('║  CompoundIQ Formulation Seed — WO-82     ║')
  console.log('╚══════════════════════════════════════════╝')

  // ── 1. Seed Ingredients ────────────────────────────────
  console.log('\n── Ingredients ──')

  const ingredients = [
    { ingredient_id: IDS.semaglutide, common_name: 'Semaglutide', therapeutic_category: 'Weight Loss', dea_schedule: null, description: 'GLP-1 receptor agonist for weight management' },
    { ingredient_id: IDS.testosterone, common_name: 'Testosterone', therapeutic_category: "Men's Health", dea_schedule: 3, description: 'Androgen hormone for HRT' },
    { ingredient_id: IDS.naltrexone, common_name: 'Naltrexone', therapeutic_category: 'Autoimmune', dea_schedule: null, description: 'Opioid antagonist, used off-label as LDN for autoimmune/inflammatory conditions' },
    { ingredient_id: IDS.ketotifen, common_name: 'Ketotifen', therapeutic_category: 'MCAS', dea_schedule: null, description: 'Mast cell stabilizer and antihistamine' },
    { ingredient_id: IDS.ketamine, common_name: 'Ketamine', therapeutic_category: 'Pain Management', dea_schedule: 3, description: 'NMDA antagonist for chronic pain and depression' },
    { ingredient_id: IDS.bpc157, common_name: 'BPC-157', therapeutic_category: 'Peptides', dea_schedule: null, fda_alert_status: 'Category 2', fda_alert_message: 'FDA categorized BPC-157 as a substance presenting significant safety risks (immunogenicity/angiogenesis). Provider must acknowledge before prescribing.', description: 'Body Protection Compound — gut/tissue repair peptide' },
    { ingredient_id: IDS.nad, common_name: 'NAD+', therapeutic_category: 'Anti-Aging', dea_schedule: null, description: 'Nicotinamide adenine dinucleotide — mitochondrial support' },
    { ingredient_id: IDS.motsc, common_name: 'MOTS-c', therapeutic_category: 'Peptides', dea_schedule: null, description: 'Mitochondrial-derived peptide for metabolic regulation' },
    { ingredient_id: IDS.amino1mq, common_name: '5-Amino-1MQ', therapeutic_category: 'Weight Loss', dea_schedule: null, description: 'NNMT inhibitor for fat metabolism' },
    { ingredient_id: IDS.tb500, common_name: 'TB-500', therapeutic_category: 'Peptides', dea_schedule: null, description: 'Thymosin Beta-4 fragment — tissue repair and regeneration' },
    { ingredient_id: IDS.ghkcu, common_name: 'GHK-Cu', therapeutic_category: 'Anti-Aging', dea_schedule: null, description: 'Copper peptide for skin/vascular repair' },
    { ingredient_id: IDS.thymosinA1, common_name: 'Thymosin Alpha-1', therapeutic_category: 'Immune', dea_schedule: null, description: 'Immune modulator for mast cell calming and barrier integrity' },
    { ingredient_id: IDS.dsip, common_name: 'DSIP', therapeutic_category: 'Sleep', dea_schedule: null, description: 'Delta Sleep-Inducing Peptide' },
    { ingredient_id: IDS.methylene_blue, common_name: 'Methylene Blue', therapeutic_category: 'Cognitive', dea_schedule: null, description: 'Mitochondrial electron carrier for cognitive support' },
    { ingredient_id: IDS.sermorelin, common_name: 'Sermorelin', therapeutic_category: 'Peptides', dea_schedule: null, description: 'Growth hormone releasing hormone (GHRH) analog' },
    { ingredient_id: IDS.tirzepatide, common_name: 'Tirzepatide', therapeutic_category: 'Weight Loss', dea_schedule: null, description: 'Dual GIP/GLP-1 receptor agonist' },
    { ingredient_id: IDS.progesterone, common_name: 'Progesterone', therapeutic_category: "Women's Health", dea_schedule: null, description: 'Progestogen hormone for HRT' },
    { ingredient_id: IDS.dhea, common_name: 'DHEA', therapeutic_category: 'Hormone Support', dea_schedule: null, description: 'Dehydroepiandrosterone — adrenal hormone precursor' },
    { ingredient_id: IDS.glutathione, common_name: 'Glutathione', therapeutic_category: 'Detox', dea_schedule: null, description: 'Master antioxidant for detox and cellular protection' },
    { ingredient_id: IDS.lipo_mino, common_name: 'Lipo-Mino Mix', therapeutic_category: 'Weight Loss', dea_schedule: null, description: 'Lipotropic injection with B vitamins and MIC' },
  ]

  for (const ing of ingredients) {
    const { error } = await supabase.from('ingredients').upsert(ing, { onConflict: 'ingredient_id' })
    if (error) {
      console.error(`  ✗ ${ing.common_name}: ${error.message}`)
    } else {
      console.log(`  ✅ ${ing.common_name}`)
    }
  }

  // ── 2. Seed Salt Forms ─────────────────────────────────
  console.log('\n── Salt Forms ──')

  const saltForms = [
    { salt_form_id: 'b2000000-0000-4000-8000-000000000001', ingredient_id: IDS.semaglutide, salt_name: 'Semaglutide (base)', abbreviation: 'base' },
    { salt_form_id: 'b2000000-0000-4000-8000-000000000002', ingredient_id: IDS.testosterone, salt_name: 'Testosterone Cypionate', abbreviation: 'Cypionate' },
    { salt_form_id: 'b2000000-0000-4000-8000-000000000003', ingredient_id: IDS.testosterone, salt_name: 'Testosterone Enanthate', abbreviation: 'Enanthate' },
    { salt_form_id: 'b2000000-0000-4000-8000-000000000004', ingredient_id: IDS.naltrexone, salt_name: 'Naltrexone Hydrochloride', abbreviation: 'HCL' },
    { salt_form_id: 'b2000000-0000-4000-8000-000000000005', ingredient_id: IDS.ketamine, salt_name: 'Ketamine Hydrochloride', abbreviation: 'HCL' },
    { salt_form_id: 'b2000000-0000-4000-8000-000000000006', ingredient_id: IDS.ketotifen, salt_name: 'Ketotifen Fumarate', abbreviation: 'Fumarate' },
    { salt_form_id: 'b2000000-0000-4000-8000-000000000007', ingredient_id: IDS.bpc157, salt_name: 'BPC-157 (acetate salt)', abbreviation: 'acetate' },
    { salt_form_id: 'b2000000-0000-4000-8000-000000000008', ingredient_id: IDS.nad, salt_name: 'NAD+ (free form)', abbreviation: 'free' },
    { salt_form_id: 'b2000000-0000-4000-8000-000000000009', ingredient_id: IDS.thymosinA1, salt_name: 'Thymosin Alpha-1 (acetate)', abbreviation: 'acetate' },
    { salt_form_id: 'b2000000-0000-4000-8000-000000000010', ingredient_id: IDS.ghkcu, salt_name: 'GHK-Cu (tripeptide-copper)', abbreviation: 'Cu' },
    { salt_form_id: 'b2000000-0000-4000-8000-000000000011', ingredient_id: IDS.sermorelin, salt_name: 'Sermorelin (acetate)', abbreviation: 'acetate' },
    { salt_form_id: 'b2000000-0000-4000-8000-000000000012', ingredient_id: IDS.tirzepatide, salt_name: 'Tirzepatide (base)', abbreviation: 'base' },
    { salt_form_id: 'b2000000-0000-4000-8000-000000000013', ingredient_id: IDS.methylene_blue, salt_name: 'Methylene Blue (chloride)', abbreviation: 'chloride' },
  ]

  for (const sf of saltForms) {
    const { error } = await supabase.from('salt_forms').upsert(sf, { onConflict: 'salt_form_id' })
    if (error) {
      console.error(`  ✗ ${sf.salt_name}: ${error.message}`)
    } else {
      console.log(`  ✅ ${sf.salt_name}`)
    }
  }

  console.log('\n✅ Formulation seed complete.')
  console.log('   Next: Run the migration, then seed formulations + pharmacy_formulations.')
  console.log('   (Formulations and pharmacy linkage depend on dosage_forms and routes being seeded first via migration.)')
}

main().catch(err => {
  console.error('Seed failed:', err)
  process.exit(1)
})
