// ============================================================
// Compounding status and the "not a copy" reason (Compliance C8)
// ============================================================
//
// A 503A pharmacy may compound a bulk drug substance only when it has a
// USP-NF monograph, is a component of an FDA-approved drug, or is on the
// 503A bulks list (Category 1 substances may be compounded while FDA
// evaluates them). Owner decision: a substance FDA removed from Category 2
// but has not yet placed (pending_evaluation) may be ordered too, with a
// non-blocking warning that the dispensing pharmacy confirms it can
// compound it. Everything else is refused here, and so is a substance
// whose status nobody has verified: ops records each ingredient's status
// (ingredients.compounding_status) on /ops/ingredients from FDA's primary
// source.
//
// A compounded drug may not be essentially a copy of a commercial one. A
// prescription containing an ingredient with a marketed FDA-approved
// equivalent (ingredients.commercial_equivalent), and every line from the
// older flat catalog (whose ingredients cannot be checked), carries a
// clinical-difference reason the provider chose: nothing is pre-selected,
// the shortage reason only while the commercial product is on FDA's
// shortage list, and a typed "Other" reason of at least 20 characters.
//
// Plain module (no 'use client'): the builder, Review and the server use it.

export const COMPOUNDING_STATUSES = [
  'usp_monograph', 'approved_drug_component', 'bulks_list', 'category_1',
  'category_2', 'category_3', 'withdrawn_removed', 'not_eligible', 'pending_evaluation',
  'unverified',
] as const
export type CompoundingStatus = (typeof COMPOUNDING_STATUSES)[number]

export const COMPOUNDABLE_STATUSES: ReadonlySet<string> = new Set<CompoundingStatus>([
  'usp_monograph', 'approved_drug_component', 'bulks_list', 'category_1',
  // Owner decision: orderable, with PENDING_EVALUATION_WARNING shown.
  'pending_evaluation',
])

/** Shown wherever a pending_evaluation ingredient appears. Never blocks. */
export const PENDING_EVALUATION_WARNING = 'FDA evaluation pending for this substance. The dispensing pharmacy confirms it can compound it.'

export function isPendingEvaluation(status: string | null | undefined): boolean {
  return status === 'pending_evaluation'
}

const NOT_COMPOUNDABLE_WHY: Record<string, string> = {
  category_2:         '503A Category 2 (significant safety risks)',
  category_3:         '503A Category 3 (not enough information to evaluate)',
  withdrawn_removed:  "on FDA's withdrawn or removed list",
  not_eligible:       'not eligible for 503A compounding',
}

/** Labels for the ops screen and the builder. */
export const COMPOUNDING_STATUS_LABEL: Record<CompoundingStatus, string> = {
  usp_monograph:           'USP-NF monograph',
  approved_drug_component: 'Component of an FDA-approved drug',
  bulks_list:              'On the 503A bulks list',
  category_1:              '503A Category 1 (may be compounded while FDA evaluates it)',
  category_2:              '503A Category 2: may not be compounded',
  category_3:              '503A Category 3: may not be compounded',
  withdrawn_removed:       'Withdrawn or removed: may not be compounded',
  not_eligible:            'Not eligible for 503A compounding',
  pending_evaluation:      'Pending FDA evaluation: may be ordered; the pharmacy confirms',
  unverified:              'Not verified: may not be ordered',
}

/** The short label shown on a blocked product. */
export const NOT_COMPOUNDABLE_LABEL = 'Not compoundable: cannot be ordered through CompoundIQ'

export function isCompoundingStatus(v: unknown): v is CompoundingStatus {
  return typeof v === 'string' && (COMPOUNDING_STATUSES as readonly string[]).includes(v)
}

export interface IngredientCompounding {
  name:                 string
  status:               string | null
  commercialEquivalent: boolean
  onFdaShortage:        boolean
  source:               string | null
  reviewedAt:           string | null
}

export type CompoundingCode = 'not_compoundable' | 'compounding_status_unknown'
export interface CompoundingBlock {
  code:    CompoundingCode
  message: string
}

/** Why a product cannot be ordered, or null when every ingredient may be compounded. */
export function compoundingBlock(medicationName: string, ingredients: ReadonlyArray<IngredientCompounding>): CompoundingBlock | null {
  if (ingredients.length === 0) {
    return {
      code: 'compounding_status_unknown',
      message: `${medicationName}: its ingredients could not be identified, so its compounding status is unknown and it cannot be ordered.`,
    }
  }
  const refused = ingredients.find(i => i.status !== null && i.status in NOT_COMPOUNDABLE_WHY)
  if (refused) {
    return {
      code: 'not_compoundable',
      message: `${medicationName}: ${refused.name} is ${NOT_COMPOUNDABLE_WHY[refused.status as string]}, so it cannot be compounded or ordered through CompoundIQ.`,
    }
  }
  const unknown = ingredients.find(i => !(i.status !== null && COMPOUNDABLE_STATUSES.has(i.status)))
  if (unknown) {
    return {
      code: 'compounding_status_unknown',
      message: `${medicationName}: the compounding status of ${unknown.name} has not been verified, so it cannot be ordered.`,
    }
  }
  return null
}

/** The warning for a product with an ingredient pending FDA evaluation, or null. */
export function compoundingWarning(ingredients: ReadonlyArray<Pick<IngredientCompounding, 'status'>>): string | null {
  return ingredients.some(i => isPendingEvaluation(i.status)) ? PENDING_EVALUATION_WARNING : null
}

// ── Reading the catalog ──────────────────────────────────────

/** The ingredient columns C8 reads. */
export const INGREDIENT_COMPOUNDING_COLUMNS =
  'common_name, compounding_status, commercial_equivalent, on_fda_shortage, compounding_status_source, compounding_status_reviewed_at'

/** The PostgREST embed that brings a formulation's ingredients' compounding fields. */
export const FORMULATION_COMPOUNDING_SELECT =
  `salt_forms(ingredients(${INGREDIENT_COMPOUNDING_COLUMNS})), formulation_ingredients(ingredients(${INGREDIENT_COMPOUNDING_COLUMNS}))`

export interface IngredientCompoundingRow {
  common_name?:                    string | null
  compounding_status?:             string | null
  commercial_equivalent?:          boolean | null
  on_fda_shortage?:                boolean | null
  compounding_status_source?:      string | null
  compounding_status_reviewed_at?: string | null
}

type Embedded<T> = T | T[] | null | undefined
const first = <T>(v: Embedded<T>): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null)

export function ingredientFromRow(row: IngredientCompoundingRow): IngredientCompounding {
  return {
    name:                 row.common_name ?? 'an ingredient',
    status:               row.compounding_status ?? null,
    commercialEquivalent: row.commercial_equivalent === true,
    onFdaShortage:        row.on_fda_shortage === true,
    source:               row.compounding_status_source ?? null,
    reviewedAt:           row.compounding_status_reviewed_at ?? null,
  }
}

/** A formulation row (with FORMULATION_COMPOUNDING_SELECT) → its ingredients. */
export function ingredientsFromFormulationRow(row: {
  salt_forms?: Embedded<{ ingredients?: Embedded<IngredientCompoundingRow> }>
  formulation_ingredients?: Array<{ ingredients?: Embedded<IngredientCompoundingRow> }> | null
}): IngredientCompounding[] {
  const rows: IngredientCompoundingRow[] = []
  const salt = first(first(row.salt_forms)?.ingredients)
  if (salt) rows.push(salt)
  for (const fi of row.formulation_ingredients ?? []) {
    const i = first(fi.ingredients)
    if (i) rows.push(i)
  }
  return rows.map(ingredientFromRow)
}

// ── The clinical-difference reason ───────────────────────────
// The reason rules live in rx-details (which must not import this module)
// and are re-exported here.

export {
  SHORTAGE_REASON, MIN_OTHER_REASON_LENGTH, clinicalDifferenceOptions, clinicalDifferenceProblem,
  type ClinicalDifferenceProblem,
} from '@/lib/orders/rx-details'

export function requiresClinicalDifference(input: {
  flag:               boolean | null | undefined
  ingredients:        ReadonlyArray<IngredientCompounding>
  legacyCatalogLine?: boolean
}): boolean {
  return input.legacyCatalogLine === true || input.flag === true || input.ingredients.some(i => i.commercialEquivalent)
}

/** The shortage reason may be given only while the commercial product is on FDA's shortage list. */
export function shortageReasonAllowed(ingredients: ReadonlyArray<IngredientCompounding>): boolean {
  return ingredients.some(i => i.onFdaShortage)
}

// ── Older (flat) catalog lines ───────────────────────────────

const BLOCKED_CATALOG_STATUSES: ReadonlySet<string> = new Set(['RECALLED', 'DISCONTINUED'])

export function catalogStatusBlock(medicationName: string, regulatoryStatus: string | null | undefined): CompoundingBlock | null {
  if (!regulatoryStatus || !BLOCKED_CATALOG_STATUSES.has(regulatoryStatus)) return null
  return {
    code: 'not_compoundable',
    message: `${medicationName}: this catalog item is ${regulatoryStatus.toLowerCase()}, so it cannot be ordered.`,
  }
}

// ── An order, re-checked at submission ───────────────────────

interface QueryClient {
  // Structural: the service client, a scripted test client.
  from: (table: string) => unknown
}

type MaybeSingle = { maybeSingle: () => Promise<{ data: unknown; error: { message: string } | null }> }

/**
 * May this order's product be sent to a pharmacy? Re-read from the
 * catalog (statuses can change after signing): 'ok', 'not_compoundable',
 * or 'compounding_status_unknown' (unverified, or the catalog could not be
 * read). Callers send nothing but 'ok'.
 */
export async function orderCompoundingStatus(
  supabase: QueryClient,
  order: { formulation_id?: string | null; catalog_item_id?: string | null },
): Promise<'ok' | CompoundingCode> {
  const db = supabase as unknown as { from: (t: string) => { select: (c: string) => { eq: (k: string, v: string) => MaybeSingle } } }
  if (order.formulation_id) {
    const { data, error } = await db.from('formulations')
      .select(`formulation_id, name, ${FORMULATION_COMPOUNDING_SELECT}`)
      .eq('formulation_id', order.formulation_id)
      .maybeSingle()
    if (error || !data) {
      console.error('[compounding] formulation read failed:', error?.message ?? 'not found', '| formulation=', order.formulation_id)
      return 'compounding_status_unknown'
    }
    const row = data as { name?: string | null } & Parameters<typeof ingredientsFromFormulationRow>[0]
    return compoundingBlock(row.name ?? 'This product', ingredientsFromFormulationRow(row))?.code ?? 'ok'
  }
  if (order.catalog_item_id) {
    const { data, error } = await db.from('catalog')
      .select('item_id, medication_name, regulatory_status')
      .eq('item_id', order.catalog_item_id)
      .maybeSingle()
    if (error || !data) {
      console.error('[compounding] catalog read failed:', error?.message ?? 'not found', '| item=', order.catalog_item_id)
      return 'compounding_status_unknown'
    }
    const row = data as { medication_name?: string | null; regulatory_status?: string | null }
    return catalogStatusBlock(row.medication_name ?? 'This product', row.regulatory_status)?.code ?? 'ok'
  }
  return 'compounding_status_unknown'
}
