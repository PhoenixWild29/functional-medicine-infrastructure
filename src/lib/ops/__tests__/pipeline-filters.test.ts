/**
 * REQ-OPV-002: the ops pipeline's filters, read from a URL and applied to
 * an order the same way the query applies them.
 */

import {
  EMPTY_PIPELINE_FILTERS, matchesPipelineFilters, nextDay, parsePipelineFilters,
  pipelineFiltersToSearchParams, type FilterableOrder, type PipelineFilters,
} from '../pipeline-filters'

const order = (over: Partial<FilterableOrder> = {}): FilterableOrder => ({
  status: 'PAID_PROCESSING', clinicId: 'c-1', pharmacyId: 'ph-1', pharmacyTier: 'TIER_1_API',
  createdAt: '2026-10-20T12:00:00+00:00', ...over,
})
const filters = (over: Partial<PipelineFilters>): PipelineFilters => ({ ...EMPTY_PIPELINE_FILTERS, ...over })

describe('parsePipelineFilters', () => {
  it('reads every filter from a query string', () => {
    const f = parsePipelineFilters(new URLSearchParams(
      'clinicId=c-1&pharmacyId=ph-2&tier=TIER_4_FAX&statuses=FAX_FAILED,SUBMISSION_FAILED&dateFrom=2026-10-01&dateTo=2026-10-31',
    ))
    expect(f).toEqual({
      clinicId: 'c-1', pharmacyId: 'ph-2', tier: 'TIER_4_FAX',
      statuses: ['FAX_FAILED', 'SUBMISSION_FAILED'], dateFrom: '2026-10-01', dateTo: '2026-10-31',
    })
  })

  it('reads a Next searchParams object too', () => {
    expect(parsePipelineFilters({ tier: 'TIER_2_PORTAL', order: 'o-1' }).tier).toBe('TIER_2_PORTAL')
  })

  it('drops an unknown tier or status and a malformed date instead of querying with it', () => {
    const f = parsePipelineFilters(new URLSearchParams('tier=TIER_9&statuses=NOPE,SHIPPED&dateFrom=10/01/2026&dateTo=2026-13-45'))
    expect(f.tier).toBe('')
    expect(f.statuses).toEqual(['SHIPPED'])
    expect(f.dateFrom).toBe('')
    expect(f.dateTo).toBe('')
  })

  it('round-trips through the query string it writes', () => {
    const f = filters({ tier: 'TIER_3_SPEC', statuses: ['DELIVERED'], dateTo: '2026-10-24' })
    expect(parsePipelineFilters(pipelineFiltersToSearchParams(f))).toEqual(f)
    expect(pipelineFiltersToSearchParams(EMPTY_PIPELINE_FILTERS).toString()).toBe('')
  })
})

describe('matchesPipelineFilters', () => {
  it('tier: only orders whose pharmacy is on that tier', () => {
    const t4 = filters({ tier: 'TIER_4_FAX' })
    expect(matchesPipelineFilters(order({ pharmacyTier: 'TIER_4_FAX' }), t4)).toBe(true)
    expect(matchesPipelineFilters(order({ pharmacyTier: 'TIER_1_API' }), t4)).toBe(false)
    expect(matchesPipelineFilters(order({ pharmacyTier: null, pharmacyId: null }), t4)).toBe(false)
  })

  it('dateTo includes the whole day, to its last fraction of a second', () => {
    const f = filters({ dateTo: '2026-10-24' })
    expect(matchesPipelineFilters(order({ createdAt: '2026-10-24T23:59:59.900+00:00' }), f)).toBe(true)
    expect(matchesPipelineFilters(order({ createdAt: '2026-10-25T00:00:00+00:00' }), f)).toBe(false)
  })

  it('dateFrom starts at the first instant of the day, whatever offset the row carries', () => {
    const f = filters({ dateFrom: '2026-10-24' })
    expect(matchesPipelineFilters(order({ createdAt: '2026-10-24T00:00:00+00:00' }), f)).toBe(true)
    // 2026-10-23T22:00 UTC, written with a +01:00 offset
    expect(matchesPipelineFilters(order({ createdAt: '2026-10-23T23:00:00+01:00' }), f)).toBe(false)
  })

  it('clinic, pharmacy and status', () => {
    expect(matchesPipelineFilters(order(), filters({ clinicId: 'c-2' }))).toBe(false)
    expect(matchesPipelineFilters(order(), filters({ pharmacyId: 'ph-1' }))).toBe(true)
    expect(matchesPipelineFilters(order(), filters({ statuses: ['SHIPPED', 'PAID_PROCESSING'] }))).toBe(true)
    expect(matchesPipelineFilters(order(), filters({ statuses: ['SHIPPED'] }))).toBe(false)
  })
})

it('nextDay crosses month and year ends', () => {
  expect(nextDay('2026-10-31')).toBe('2026-11-01')
  expect(nextDay('2026-12-31')).toBe('2027-01-01')
  expect(nextDay('2028-02-28')).toBe('2028-02-29')
})
