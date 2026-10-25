// ============================================================
// Ops pipeline filters — REQ-OPV-002
// ============================================================
//
// Multi-dimension filtering (clinic, pharmacy, status, date, tier),
// shared by the page (initial load from the URL), the API route (the
// polled query) and the view (the URL it writes, and the rows it shows
// while a new filter's first fetch is in flight).
//
// Tier is the order's pharmacy's integration_tier, the tier the
// "Pharmacy / Tier" column shows. Dates are whole UTC days: dateFrom
// from its first instant, dateTo through its last.

import { Constants } from '@/types/database.types'
import type { OrderStatusEnum, IntegrationTierEnum } from '@/types/database.types'

export interface PipelineFilters {
  clinicId:   string
  pharmacyId: string
  tier:       IntegrationTierEnum | ''
  statuses:   OrderStatusEnum[]
  dateFrom:   string
  dateTo:     string
}

export const EMPTY_PIPELINE_FILTERS: PipelineFilters = {
  clinicId:   '',
  pharmacyId: '',
  tier:       '',
  statuses:   [],
  dateFrom:   '',
  dateTo:     '',
}

const TIERS    = new Set<string>(Constants.public.Enums.integration_tier_enum)
const STATUSES = new Set<string>(Constants.public.Enums.order_status_enum)
const DAY      = /^\d{4}-\d{2}-\d{2}$/

function isDay(v: string): boolean {
  return DAY.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))
}

/** The day after a YYYY-MM-DD day, as YYYY-MM-DD. */
export function nextDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/** First instant of dateFrom (inclusive). */
export function dateFromBound(dateFrom: string): string {
  return `${dateFrom}T00:00:00Z`
}

/** First instant after dateTo (exclusive), so all of dateTo is included. */
export function dateToBound(dateTo: string): string {
  return `${nextDay(dateTo)}T00:00:00Z`
}

type ParamSource = URLSearchParams | Record<string, string | string[] | undefined>

function read(params: ParamSource, key: string): string {
  if (params instanceof URLSearchParams) return params.get(key)?.trim() ?? ''
  const v = params[key]
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? ''
}

/**
 * Filters from a URL's query (the page's searchParams or the API
 * request). An unknown tier or status, or a malformed date, is dropped
 * rather than sent to the database, where it would fail the query.
 */
export function parsePipelineFilters(params: ParamSource): PipelineFilters {
  const tier     = read(params, 'tier')
  const dateFrom = read(params, 'dateFrom')
  const dateTo   = read(params, 'dateTo')
  const statuses = read(params, 'statuses')
    .split(',')
    .map(s => s.trim())
    .filter((s): s is OrderStatusEnum => STATUSES.has(s))

  return {
    clinicId:   read(params, 'clinicId'),
    pharmacyId: read(params, 'pharmacyId'),
    tier:       TIERS.has(tier) ? tier as IntegrationTierEnum : '',
    statuses:   [...new Set(statuses)],
    dateFrom:   isDay(dateFrom) ? dateFrom : '',
    dateTo:     isDay(dateTo)   ? dateTo   : '',
  }
}

/** The query string for these filters (empty filters are left out). */
export function pipelineFiltersToSearchParams(filters: PipelineFilters): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.clinicId)        params.set('clinicId',   filters.clinicId)
  if (filters.pharmacyId)      params.set('pharmacyId', filters.pharmacyId)
  if (filters.tier)            params.set('tier',       filters.tier)
  if (filters.statuses.length) params.set('statuses',   filters.statuses.join(','))
  if (filters.dateFrom)        params.set('dateFrom',   filters.dateFrom)
  if (filters.dateTo)          params.set('dateTo',     filters.dateTo)
  return params
}

export function hasPipelineFilters(filters: PipelineFilters): boolean {
  return pipelineFiltersToSearchParams(filters).toString() !== ''
}

export interface FilterableOrder {
  status:       OrderStatusEnum
  clinicId:     string
  pharmacyId:   string | null
  pharmacyTier: IntegrationTierEnum | null
  createdAt:    string
}

/** Whether one order passes the filters: the same rules as the query. */
export function matchesPipelineFilters(order: FilterableOrder, filters: PipelineFilters): boolean {
  if (filters.clinicId   && order.clinicId     !== filters.clinicId)   return false
  if (filters.pharmacyId && order.pharmacyId   !== filters.pharmacyId) return false
  if (filters.tier       && order.pharmacyTier !== filters.tier)       return false
  if (filters.statuses.length && !filters.statuses.includes(order.status)) return false
  const created = Date.parse(order.createdAt)
  if (filters.dateFrom && !(created >= Date.parse(dateFromBound(filters.dateFrom)))) return false
  if (filters.dateTo   && !(created <  Date.parse(dateToBound(filters.dateTo))))     return false
  return true
}
