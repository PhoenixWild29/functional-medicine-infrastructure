// ============================================================
// Demo compounding statuses (Compliance C8)
// ============================================================
//
// Demo data, NOT verified regulatory values. The seeded demo ingredients
// get these so the demo can prescribe; the peptides in regulatory limbo
// are pending_evaluation: orderable, with a warning (owner decision), and an
// ingredient not listed (5-Amino-1MQ, Adrenal Cortex Extract, Lipo-Mino
// Mix among them) stays unverified, so blocked as well. Real
// values are entered on /ops/ingredients from FDA's primary source after
// counsel review.
//
// The migration 20261012000001 applies the same list (a unit test keeps
// the two identical); the seed scripts apply it to freshly seeded rows.

import type { CompoundingStatus } from './compounding'

export const DEMO_COMPOUNDING_SOURCE = 'demo data, not verified'

export interface DemoCompounding {
  name:                 string
  status:               CompoundingStatus
  commercialEquivalent: boolean
}

export const DEMO_COMPOUNDING: ReadonlyArray<DemoCompounding> = [
  // Peptides pending FDA evaluation: orderable, with a warning (owner decision)
  { name: 'BPC-157',                 status: 'pending_evaluation',       commercialEquivalent: false },
  { name: 'TB-500',                  status: 'pending_evaluation',       commercialEquivalent: false },
  { name: 'MOTS-c',                  status: 'pending_evaluation',       commercialEquivalent: false },
  { name: 'DSIP',                    status: 'pending_evaluation',       commercialEquivalent: false },
  { name: 'GHK-Cu',                  status: 'pending_evaluation',       commercialEquivalent: false },
  { name: 'KPV',                     status: 'pending_evaluation',       commercialEquivalent: false },
  { name: 'Epitalon',                status: 'pending_evaluation',       commercialEquivalent: false },
  { name: 'Semax',                   status: 'pending_evaluation',       commercialEquivalent: false },
  { name: 'Selank',                  status: 'pending_evaluation',       commercialEquivalent: false },
  { name: 'CJC-1295',                status: 'pending_evaluation',       commercialEquivalent: false },
  { name: 'Ipamorelin',              status: 'pending_evaluation',       commercialEquivalent: false },
  { name: 'GHRP-2',                  status: 'pending_evaluation',       commercialEquivalent: false },
  { name: 'GHRP-6',                  status: 'pending_evaluation',       commercialEquivalent: false },
  { name: 'Hexarelin',               status: 'pending_evaluation',       commercialEquivalent: false },
  { name: 'Kisspeptin-10',           status: 'pending_evaluation',       commercialEquivalent: false },
  { name: 'Thymosin Alpha-1',        status: 'pending_evaluation',       commercialEquivalent: false },
  // A marketed FDA-approved product with this active ingredient: a clinical-difference reason on every Rx
  { name: 'Semaglutide',             status: 'approved_drug_component',  commercialEquivalent: true },
  { name: 'Tirzepatide',             status: 'approved_drug_component',  commercialEquivalent: true },
  { name: 'Testosterone',            status: 'approved_drug_component',  commercialEquivalent: true },
  { name: 'Testosterone Cypionate',  status: 'approved_drug_component',  commercialEquivalent: true },
  { name: 'Testosterone Propionate', status: 'approved_drug_component',  commercialEquivalent: true },
  { name: 'Ketamine',                status: 'approved_drug_component',  commercialEquivalent: true },
  { name: 'Naltrexone',              status: 'approved_drug_component',  commercialEquivalent: true },
  { name: 'Progesterone',            status: 'approved_drug_component',  commercialEquivalent: true },
  { name: 'DHEA',                    status: 'approved_drug_component',  commercialEquivalent: true },
  { name: 'Methylene Blue',          status: 'approved_drug_component',  commercialEquivalent: true },
  { name: 'Alprostadil',             status: 'approved_drug_component',  commercialEquivalent: true },
  { name: 'Aminophylline',           status: 'approved_drug_component',  commercialEquivalent: true },
  { name: 'Atropine',                status: 'approved_drug_component',  commercialEquivalent: true },
  { name: 'Azelaic Acid',            status: 'approved_drug_component',  commercialEquivalent: true },
  { name: 'Benzoyl Peroxide',        status: 'approved_drug_component',  commercialEquivalent: true },
  { name: 'Calcium Gluconate',       status: 'approved_drug_component',  commercialEquivalent: true },
  { name: 'Clindamycin',             status: 'approved_drug_component',  commercialEquivalent: true },
  { name: 'Cyanocobalamin',          status: 'approved_drug_component',  commercialEquivalent: true },
  { name: 'Estradiol',               status: 'approved_drug_component',  commercialEquivalent: true },
  { name: 'Finasteride',             status: 'approved_drug_component',  commercialEquivalent: true },
  { name: 'Hydrocortisone',          status: 'approved_drug_component',  commercialEquivalent: true },
  { name: 'Ketotifen',               status: 'approved_drug_component',  commercialEquivalent: true },
  { name: 'Latanoprost',             status: 'approved_drug_component',  commercialEquivalent: true },
  { name: 'Levothyroxine',           status: 'approved_drug_component',  commercialEquivalent: true },
  { name: 'Liothyronine',            status: 'approved_drug_component',  commercialEquivalent: true },
  { name: 'Minoxidil',               status: 'approved_drug_component',  commercialEquivalent: true },
  { name: 'Oxytocin',                status: 'approved_drug_component',  commercialEquivalent: true },
  { name: 'Papaverine',              status: 'approved_drug_component',  commercialEquivalent: true },
  { name: 'Pentoxifylline',          status: 'approved_drug_component',  commercialEquivalent: true },
  { name: 'Phentolamine',            status: 'approved_drug_component',  commercialEquivalent: true },
  { name: 'PT-141',                  status: 'approved_drug_component',  commercialEquivalent: true },
  { name: 'Sildenafil',              status: 'approved_drug_component',  commercialEquivalent: true },
  { name: 'Sildenafil Citrate',      status: 'approved_drug_component',  commercialEquivalent: true },
  { name: 'Spironolactone',          status: 'approved_drug_component',  commercialEquivalent: true },
  { name: 'Tadalafil',               status: 'approved_drug_component',  commercialEquivalent: true },
  { name: 'Tesamorelin',             status: 'approved_drug_component',  commercialEquivalent: true },
  { name: 'Tretinoin',               status: 'approved_drug_component',  commercialEquivalent: true },
  { name: 'Hydroquinone',            status: 'usp_monograph',            commercialEquivalent: true },
  { name: 'L-Arginine',              status: 'usp_monograph',            commercialEquivalent: true },
  { name: 'L-Carnitine',             status: 'usp_monograph',            commercialEquivalent: true },
  { name: 'Vitamin C',               status: 'usp_monograph',            commercialEquivalent: true },
  { name: 'Zinc Sulfate',            status: 'usp_monograph',            commercialEquivalent: true },
  // Other demo ingredients: demo values
  { name: 'Sermorelin',              status: 'approved_drug_component',  commercialEquivalent: false },
  { name: 'Biotin',                  status: 'usp_monograph',            commercialEquivalent: false },
  { name: 'Choline',                 status: 'usp_monograph',            commercialEquivalent: false },
  { name: 'Desiccated Thyroid',      status: 'usp_monograph',            commercialEquivalent: false },
  { name: 'Estriol',                 status: 'usp_monograph',            commercialEquivalent: false },
  { name: 'Estrone',                 status: 'usp_monograph',            commercialEquivalent: false },
  { name: 'Glutathione',             status: 'usp_monograph',            commercialEquivalent: false },
  { name: 'Inositol',                status: 'usp_monograph',            commercialEquivalent: false },
  { name: 'Kojic Acid',              status: 'usp_monograph',            commercialEquivalent: false },
  { name: 'L-Citrulline',            status: 'usp_monograph',            commercialEquivalent: false },
  { name: 'L-Ornithine',             status: 'usp_monograph',            commercialEquivalent: false },
  { name: 'Magnesium Chloride',      status: 'usp_monograph',            commercialEquivalent: false },
  { name: 'Methionine',              status: 'usp_monograph',            commercialEquivalent: false },
  { name: 'Methylcobalamin',         status: 'usp_monograph',            commercialEquivalent: false },
  { name: 'NAD+',                    status: 'usp_monograph',            commercialEquivalent: false },
  { name: 'Niacinamide',             status: 'usp_monograph',            commercialEquivalent: false },
  { name: 'Pregnenolone',            status: 'usp_monograph',            commercialEquivalent: false },
  { name: 'Taurine',                 status: 'usp_monograph',            commercialEquivalent: false },
  { name: 'Vitamin B Complex',       status: 'usp_monograph',            commercialEquivalent: false },
]

interface UpdateClient {
  // Structural: the service client from a seed script.
  from: (table: string) => unknown
}

/**
 * Seed scripts: give freshly seeded demo ingredients their demo statuses,
 * exactly as the migration does for existing rows. Only rows still
 * unverified and never reviewed are touched. Returns how many matched.
 */
export async function applyDemoCompounding(supabase: UpdateClient): Promise<number> {
  type Chain = {
    eq: (c: string, v: unknown) => Chain
    is: (c: string, v: null) => Chain
    select: (c: string) => Promise<{ data: unknown[] | null; error: { message: string } | null }>
  }
  const db = supabase as unknown as { from: (t: string) => { update: (p: Record<string, unknown>) => Chain } }
  const reviewedAt = new Date().toISOString()
  let matched = 0
  for (const d of DEMO_COMPOUNDING) {
    const { data, error } = await db.from('ingredients')
      .update({
        compounding_status:             d.status,
        commercial_equivalent:          d.commercialEquivalent,
        on_fda_shortage:                false,
        compounding_status_source:      DEMO_COMPOUNDING_SOURCE,
        compounding_status_reviewed_at: reviewedAt,
        compounding_status_reviewed_by: null,
      })
      .eq('common_name', d.name)
      .eq('compounding_status', 'unverified')
      .is('compounding_status_source', null)
      .select('ingredient_id')
    if (error) throw new Error(`demo compounding status for ${d.name} could not be set: ${error.message}`)
    matched += data?.length ?? 0
  }
  return matched
}
