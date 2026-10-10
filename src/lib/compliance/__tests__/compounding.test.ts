/**
 * @jest-environment node
 *
 * Compliance C8: what may be compounded, and the documented reason a
 * compounded prescription is not a copy of a commercial drug.
 *
 *   - usp_monograph, approved_drug_component, bulks_list, category_1 and
 *     (owner decision) pending_evaluation may be ordered; category_2,
 *     category_3, withdrawn_removed and not_eligible may not
 *     (not_compoundable);
 *   - pending_evaluation carries a non-blocking warning: the dispensing
 *     pharmacy confirms it can compound it;
 *     unverified, or a status we cannot read, is blocked too
 *     (compounding_status_unknown);
 *   - an ingredient with a marketed FDA-approved equivalent needs a reason
 *     on every prescription; so does every older catalog line;
 *   - no reason is pre-selected; the shortage reason only when the
 *     commercial product is on FDA's shortage list; "Other" needs at least
 *     20 characters;
 *   - an older catalog line that is RECALLED or DISCONTINUED is blocked.
 */

import {
  COMPOUNDABLE_STATUSES,
  COMPOUNDING_STATUSES,
  MIN_OTHER_REASON_LENGTH,
  SHORTAGE_REASON,
  catalogStatusBlock,
  clinicalDifferenceOptions,
  clinicalDifferenceProblem,
  compoundingBlock,
  compoundingWarning,
  isPendingEvaluation,
  PENDING_EVALUATION_WARNING,
  ingredientsFromFormulationRow,
  requiresClinicalDifference,
  shortageReasonAllowed,
  type IngredientCompounding,
} from '../compounding'
import { STANDARD_CLINICAL_DIFFERENCE_OPTIONS } from '@/lib/orders/rx-details'

const ing = (name: string, status: string | null, over: Partial<IngredientCompounding> = {}): IngredientCompounding => ({
  name, status, commercialEquivalent: false, onFdaShortage: false, source: null, reviewedAt: null, ...over,
})

describe('statuses', () => {
  it('the agreed set, in the migration order', () => {
    expect(COMPOUNDING_STATUSES).toEqual([
      'usp_monograph', 'approved_drug_component', 'bulks_list', 'category_1',
      'category_2', 'category_3', 'withdrawn_removed', 'not_eligible', 'pending_evaluation',
      'unverified',
    ])
    // CHANGED (owner decision): pending_evaluation may be ordered, with a warning.
    expect([...COMPOUNDABLE_STATUSES].sort()).toEqual(['approved_drug_component', 'bulks_list', 'category_1', 'pending_evaluation', 'usp_monograph'])
  })
})

describe('compoundingBlock', () => {
  it.each(['usp_monograph', 'approved_drug_component', 'bulks_list', 'category_1', 'pending_evaluation'])('%s may be compounded', s => {
    expect(compoundingBlock('Thing 1mg', [ing('Thing', s)])).toBeNull()
  })

  it.each([
    ['category_2', "503A Category 2 (significant safety risks)"],
    ['category_3', '503A Category 3 (not enough information to evaluate)'],
    ['withdrawn_removed', "on FDA's withdrawn or removed list"],
    ['not_eligible', 'not eligible for 503A compounding'],
  ])('%s is not_compoundable, and says why', (status, why) => {
    expect(compoundingBlock('BPC-157 5mg/mL Injectable', [ing('BPC-157', status)])).toEqual({
      code: 'not_compoundable',
      message: `BPC-157 5mg/mL Injectable: BPC-157 is ${why}, so it cannot be compounded or ordered through CompoundIQ.`,
    })
  })

  it.each([['unverified'], [null], ['something new']])('status %p is compounding_status_unknown: blocked', status => {
    expect(compoundingBlock('NAD+ 200mg/mL', [ing('NAD+', status as string | null)])).toEqual({
      code: 'compounding_status_unknown',
      message: 'NAD+ 200mg/mL: the compounding status of NAD+ has not been verified, so it cannot be ordered.',
    })
  })

  it('a combination is blocked by any ingredient; not_compoundable outranks unknown', () => {
    const block = compoundingBlock('X/Y', [ing('Glutathione', 'unverified'), ing('X', 'category_2'), ing('NAD+', 'usp_monograph')])
    expect(block?.code).toBe('not_compoundable')
    expect(block?.message).toContain('X is 503A Category 2')
  })

  it('no ingredients at all: unknown, never a pass', () => {
    expect(compoundingBlock('Mystery', [])).toEqual({
      code: 'compounding_status_unknown',
      message: 'Mystery: its ingredients could not be identified, so its compounding status is unknown and it cannot be ordered.',
    })
  })
})

describe('pending FDA evaluation: orderable, with a warning', () => {
  it('the warning, exactly', () => {
    expect(PENDING_EVALUATION_WARNING).toBe('FDA evaluation pending for this substance. The dispensing pharmacy confirms it can compound it.')
  })

  it('a product with a pending_evaluation ingredient: not blocked, warned', () => {
    const ings = [ing('BPC-157', 'pending_evaluation')]
    expect(compoundingBlock('BPC-157 5mg/mL Injectable', ings)).toBeNull()
    expect(compoundingWarning(ings)).toBe(PENDING_EVALUATION_WARNING)
  })

  it('a combination warns when any ingredient is pending', () => {
    expect(compoundingWarning([ing('Cyanocobalamin', 'approved_drug_component'), ing('TB-500', 'pending_evaluation')])).toBe(PENDING_EVALUATION_WARNING)
  })

  it('no pending ingredient: no warning', () => {
    expect(compoundingWarning([ing('NAD+', 'usp_monograph')])).toBeNull()
    expect(compoundingWarning([])).toBeNull()
  })

  it('isPendingEvaluation', () => {
    expect(isPendingEvaluation('pending_evaluation')).toBe(true)
    expect(isPendingEvaluation('category_2')).toBe(false)
    expect(isPendingEvaluation(null)).toBe(false)
  })
})

describe('ingredientsFromFormulationRow', () => {
  const cols = (name: string, status: string, ce = false, shortage = false) => ({
    common_name: name, compounding_status: status, commercial_equivalent: ce, on_fda_shortage: shortage,
    compounding_status_source: 'src', compounding_status_reviewed_at: '2026-10-01T00:00:00Z',
  })

  it('reads the salt form ingredient and every combination ingredient', () => {
    expect(ingredientsFromFormulationRow({
      salt_forms: { ingredients: cols('Semaglutide', 'approved_drug_component', true) },
      formulation_ingredients: [{ ingredients: cols('Cyanocobalamin', 'approved_drug_component') }, { ingredients: null }],
    })).toEqual([
      { name: 'Semaglutide', status: 'approved_drug_component', commercialEquivalent: true, onFdaShortage: false, source: 'src', reviewedAt: '2026-10-01T00:00:00Z' },
      { name: 'Cyanocobalamin', status: 'approved_drug_component', commercialEquivalent: false, onFdaShortage: false, source: 'src', reviewedAt: '2026-10-01T00:00:00Z' },
    ])
  })

  it('accepts PostgREST arrays as well as objects', () => {
    expect(ingredientsFromFormulationRow({ salt_forms: [{ ingredients: [cols('DHEA', 'approved_drug_component', true)] }] })
      .map(i => i.name)).toEqual(['DHEA'])
  })
})

describe('the clinical-difference reason', () => {
  it('is required for an ingredient with a commercial equivalent, a flagged formulation, or an older catalog line', () => {
    expect(requiresClinicalDifference({ flag: false, ingredients: [ing('Semaglutide', 'approved_drug_component', { commercialEquivalent: true })] })).toBe(true)
    expect(requiresClinicalDifference({ flag: true, ingredients: [ing('X', 'usp_monograph')] })).toBe(true)
    expect(requiresClinicalDifference({ flag: false, ingredients: [], legacyCatalogLine: true })).toBe(true)
    expect(requiresClinicalDifference({ flag: false, ingredients: [ing('NAD+', 'usp_monograph')] })).toBe(false)
  })

  it('the shortage reason is offered only when the commercial product is on the FDA shortage list', () => {
    expect(SHORTAGE_REASON).toBe('Commercial product is unavailable or on national shortage')
    expect(shortageReasonAllowed([ing('Semaglutide', 'approved_drug_component', { commercialEquivalent: true })])).toBe(false)
    expect(shortageReasonAllowed([ing('Semaglutide', 'approved_drug_component', { commercialEquivalent: true, onFdaShortage: true })])).toBe(true)
    expect(clinicalDifferenceOptions(STANDARD_CLINICAL_DIFFERENCE_OPTIONS, false)).not.toContain(SHORTAGE_REASON)
    expect(clinicalDifferenceOptions(STANDARD_CLINICAL_DIFFERENCE_OPTIONS, false)).toHaveLength(4)
    expect(clinicalDifferenceOptions(STANDARD_CLINICAL_DIFFERENCE_OPTIONS, true)).toContain(SHORTAGE_REASON)
  })

  it('a picked reason passes; missing, a disallowed shortage reason, or a short "Other" do not', () => {
    const opts = { options: [...STANDARD_CLINICAL_DIFFERENCE_OPTIONS], shortageAllowed: false }
    expect(clinicalDifferenceProblem(STANDARD_CLINICAL_DIFFERENCE_OPTIONS[0], opts)).toBeNull()
    expect(clinicalDifferenceProblem(null, opts)).toBe('missing')
    expect(clinicalDifferenceProblem('   ', opts)).toBe('missing')
    expect(clinicalDifferenceProblem(SHORTAGE_REASON, opts)).toBe('shortage_not_listed')
    expect(clinicalDifferenceProblem(SHORTAGE_REASON, { ...opts, shortageAllowed: true })).toBeNull()
    expect(MIN_OTHER_REASON_LENGTH).toBe(20)
    expect(clinicalDifferenceProblem('needs it', opts)).toBe('other_too_short')
    expect(clinicalDifferenceProblem('  Patient cannot tolerate sorbitol  ', opts)).toBeNull()
    expect(clinicalDifferenceProblem('x'.repeat(19), opts)).toBe('other_too_short')
    expect(clinicalDifferenceProblem('x'.repeat(20), opts)).toBeNull()
  })
})

describe('older catalog lines', () => {
  it.each(['RECALLED', 'DISCONTINUED'])('%s is blocked', status => {
    expect(catalogStatusBlock('Old Cream 2%', status)).toEqual({
      code: 'not_compoundable',
      message: `Old Cream 2%: this catalog item is ${status.toLowerCase()}, so it cannot be ordered.`,
    })
  })

  it.each(['ACTIVE', 'SHORTAGE', null])('%p is not blocked by its status', status => {
    expect(catalogStatusBlock('Old Cream 2%', status)).toBeNull()
  })
})
