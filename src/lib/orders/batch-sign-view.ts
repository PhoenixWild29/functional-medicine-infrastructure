// ============================================================
// Batch sign page — view model (WO-99)
// ============================================================
//
// Plain module (no 'use client', no server imports): the server page
// builds these, the client form renders them, and the dashboard links to
// the page with batchSignHref.

import type { RxDetails } from './rx-details'
import type { TitrationStep } from './titration'
import { bundleTotals, computeBundleShipping, type BundleShipping, type BundleTotals, type PharmacyShippingRates } from './shipping'

export const BATCH_SIGN_PATH = '/new-prescription/sign'

/** The most prescriptions one signature signs (one request). */
export const MAX_BATCH_ORDERS = 25

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The batch sign page with these drafts pre-selected. */
export function batchSignHref(orderIds: ReadonlyArray<string>): string {
  return `${BATCH_SIGN_PATH}?orders=${orderIds.map(encodeURIComponent).join(',')}`
}

/**
 * A batch sign page href with one more order selected; any other href is
 * returned unchanged. Used after "+ Add prescription" so the new line
 * comes back selected.
 */
export function withOrderSelected(href: string, orderId: string): string {
  const prefix = `${BATCH_SIGN_PATH}?orders=`
  if (!href.startsWith(prefix)) return href
  const ids = href.slice(prefix.length).split(',').map(decodeURIComponent).filter(Boolean)
  return batchSignHref(ids.includes(orderId) ? ids : [...ids, orderId])
}

/** `?orders=a,b` → the valid, distinct order ids (at most `max`). */
export function parseOrdersParam(raw: string | string[] | undefined | null, max = MAX_BATCH_ORDERS): string[] {
  const value = Array.isArray(raw) ? raw.join(',') : (raw ?? '')
  const ids = value.split(',').map(s => s.trim()).filter(s => UUID_RE.test(s))
  return [...new Set(ids)].slice(0, max)
}

export interface BatchDraftLine {
  orderId:          string
  patientId:        string
  medicationName:   string
  form:             string
  dose:             string
  pharmacyId:       string
  pharmacyName:     string
  sigText:          string
  retailCents:      number
  wholesaleCents:   number
  shippingType:     string | null
  rxDetails:        RxDetails
  /** From the snapshot taken at creation; null = unknown (treated as controlled). */
  deaSchedule:      number | null
  /** WO-105: a titration keeps its steps through signing. */
  sigMode:          'standard' | 'titration' | 'cycling'
  titrationSteps:   TitrationStep[]
  /** WO-106: the order this one refills. */
  refillOfOrderId:  string | null
  packageLabel:     string | null
  packageCount:     number | null
}

export interface OtherProviderDrafts {
  providerId:    string
  providerName:  string
  /** Any one of their drafts — Sign as me moves all of that provider's lines for the patient. */
  anchorOrderId: string
  count:         number
}

export interface BatchPatientView {
  patientId:  string
  firstName:  string
  lastName:   string
  dob:        string
  phone:      string
  state:      string
  /** Drafts the signed-in provider can sign. */
  lines:      BatchDraftLine[]
  /** Drafts under another provider: Sign as me first (WO-100). */
  others:     OtherProviderDrafts[]
}

export interface PatientBatchTotals {
  shipping: BundleShipping
  totals:   BundleTotals
}

/** One patient's selected lines: shipping once per pharmacy, then the totals. */
export function patientBatchTotals(
  lines: ReadonlyArray<Pick<BatchDraftLine, 'pharmacyId' | 'shippingType' | 'retailCents' | 'wholesaleCents'>>,
  rates: ReadonlyArray<PharmacyShippingRates>,
  absorbShipping: boolean,
): PatientBatchTotals {
  const shipping = computeBundleShipping(
    lines.map(l => ({ pharmacyId: l.pharmacyId, shippingType: l.shippingType, wholesaleCents: l.wholesaleCents })),
    rates,
  )
  return { shipping, totals: bundleTotals(lines, shipping.totalCents, { absorbShipping }) }
}

/** Controlled for signing purposes: Schedule 2+ or unknown. */
export function isControlledLine(line: Pick<BatchDraftLine, 'deaSchedule'>): boolean {
  return line.deaSchedule == null || line.deaSchedule >= 2
}
