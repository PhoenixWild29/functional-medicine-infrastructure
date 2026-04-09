// ============================================================
// WO-86: Seed Drug Interactions + EPCS Demo Data
// ============================================================
//
// Usage: npx dotenv -e .env.local -- npx tsx scripts/seed-interactions-wo86.ts

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Ingredient IDs from seed-formulations.ts
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
  tirzepatide:    'b1000000-0000-4000-8000-000000000016',
}

// Deterministic IDs
const INT = {
  i1: 'd1000000-0000-4000-8000-000000000001',
  i2: 'd1000000-0000-4000-8000-000000000002',
  i3: 'd1000000-0000-4000-8000-000000000003',
  i4: 'd1000000-0000-4000-8000-000000000004',
  i5: 'd1000000-0000-4000-8000-000000000005',
  i6: 'd1000000-0000-4000-8000-000000000006',
}

async function main() {
  console.log('╔══════════════════════════════════════════╗')
  console.log('║  WO-86: Seed Drug Interactions           ║')
  console.log('╚══════════════════════════════════════════╝')

  const interactions = [
    {
      interaction_id: INT.i1,
      ingredient_a_id: ING.motsc,
      ingredient_b_id: ING.nad,
      severity: 'warning',
      description: 'MOTS-c and NAD+ both target mitochondrial pathways. Concurrent same-day administration may cause overlapping metabolic effects.',
      clinical_note: 'Space administration by at least 4 hours, or administer on alternating days. From Lauren Perkins protocol: NAD+ is M-F, MOTS-c combo is 2-3x/week on alternate days.',
      source: 'Clinical protocol data (Lauren Perkins)',
    },
    {
      interaction_id: INT.i2,
      ingredient_a_id: ING.semaglutide,
      ingredient_b_id: ING.tirzepatide,
      severity: 'critical',
      description: 'Semaglutide and Tirzepatide are both GLP-1 receptor agonists. Concurrent use causes additive GI side effects (nausea, vomiting) and hypoglycemia risk.',
      clinical_note: 'Never prescribe both simultaneously. Switch protocols require a washout period.',
      source: 'FDA prescribing information',
    },
    {
      interaction_id: INT.i3,
      ingredient_a_id: ING.naltrexone,
      ingredient_b_id: ING.ketamine,
      severity: 'info',
      description: 'Naltrexone (opioid antagonist) may partially attenuate ketamine\'s analgesic effects via NMDA/opioid pathway cross-talk.',
      clinical_note: 'Monitor pain relief effectiveness. LDN doses (0.5-4.5mg) unlikely to significantly interact with sublingual ketamine.',
      source: 'Pharmacology literature',
    },
    {
      interaction_id: INT.i4,
      ingredient_a_id: ING.bpc157,
      ingredient_b_id: ING.tb500,
      severity: 'info',
      description: 'BPC-157 and TB-500 are commonly co-administered in regenerative protocols. Synergistic tissue repair effects reported.',
      clinical_note: 'Safe to combine. Often compounded together (BPC-157/TB-500/GHK-Cu triple). Monitor for injection site reactions.',
      source: 'Clinical practice',
    },
    {
      interaction_id: INT.i5,
      ingredient_a_id: ING.ketotifen,
      ingredient_b_id: ING.ketamine,
      severity: 'warning',
      description: 'Both ketotifen and ketamine have sedative effects. Concurrent use may cause excessive drowsiness.',
      clinical_note: 'Advise patient not to drive or operate machinery. Space evening doses: ketotifen with dinner, ketamine at bedtime.',
      source: 'Pharmacology (sedation profiles)',
    },
    {
      interaction_id: INT.i6,
      ingredient_a_id: ING.testosterone,
      ingredient_b_id: ING.semaglutide,
      severity: 'info',
      description: 'Testosterone and Semaglutide may be co-prescribed in male weight loss protocols. Testosterone supports lean mass preservation during GLP-1-induced weight loss.',
      clinical_note: 'Monitor testosterone levels quarterly. Semaglutide-induced weight loss may improve endogenous testosterone, requiring dose adjustment.',
      source: 'Clinical practice',
    },
  ]

  console.log('\n── Drug Interactions ──')
  for (const int of interactions) {
    const { error } = await supabase.from('drug_interactions').upsert(int, { onConflict: 'interaction_id' })
    if (error) {
      console.error(`  FAIL: ${int.description.substring(0, 50)}... — ${error.message}`)
    } else {
      console.log(`  OK: [${int.severity}] ${int.description.substring(0, 60)}...`)
    }
  }

  console.log('\nDone!')
}

main().catch(err => {
  console.error('Seed failed:', err)
  process.exit(1)
})
