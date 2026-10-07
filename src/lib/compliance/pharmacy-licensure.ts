// ============================================================
// Pharmacy licensure by state — Compliance C5
// ============================================================
//
// The one rule every path uses (the builder's pharmacy list, draft
// creation, batch-sign, submission and the ops fax):
//
//   An order may go to a pharmacy only if the pharmacy holds an ACTIVE,
//   non-deleted, UNEXPIRED license in the patient's shipping state.
//   A sterile product (dosage_forms.is_sterile: injectables, pellets)
//   additionally needs that license to cover sterile compounding, or the
//   pharmacy to be a 503B outsourcing facility.
//
// Before C5 every lookup tested is_active only: an expired license (its
// expiration_date in the past) or a soft-deleted one counted as licensed,
// and nothing looked at sterile scope.
//
// A sterile scope that was never recorded (sterile_compounding NULL) does
// NOT cover a sterile product: unknown fails closed. /ops/licensure lists
// every unrecorded one so ops can fill them in.
//
// Expiry is compared by calendar date in UTC: a license that expires
// today is valid through today.

import type { createServiceClient } from '@/lib/supabase/service'

type Supabase = ReturnType<typeof createServiceClient>

export type FacilityType = '503A' | '503B'
export type LicenseType = 'resident_pharmacy' | 'nonresident_pharmacy' | 'outsourcing_facility'

export interface LicenseRecord {
  pharmacy_id:         string
  state_code:          string
  license_number?:     string | null
  expiration_date:     string | null
  is_active:           boolean
  deleted_at:          string | null
  license_type?:       string | null
  sterile_compounding: boolean | null
}

/** Columns every licensure read selects. */
export const LICENSE_COLUMNS =
  'pharmacy_id, state_code, license_number, expiration_date, is_active, deleted_at, license_type, sterile_compounding'

export type LicensureProblem = 'no_state' | 'no_license' | 'expired' | 'not_sterile' | 'sterile_unrecorded'

export type LicensureResult =
  | { ok: true }
  | { ok: false; problem: LicensureProblem; message: string }

/** The UTC calendar date, YYYY-MM-DD. */
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

/** Whole days from `today` to `date` (both YYYY-MM-DD); negative once past. */
export function daysUntil(date: string, today: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
}

/**
 * Whether a product is sterile. The dosage form's is_sterile flag decides
 * when it is known; a legacy catalog item has only its form text, so an
 * injectable, pellet or implant counts as sterile.
 */
export function isSterileProduct(input: { dosageFormIsSterile?: boolean | null; formText?: string | null }): boolean {
  if (typeof input.dosageFormIsSterile === 'boolean') return input.dosageFormIsSterile
  return /inject|pellet|implant/i.test(input.formText ?? '')
}

export function normalizeFacilityType(v: unknown): FacilityType | null {
  return v === '503A' || v === '503B' ? v : null
}

const isLive = (l: LicenseRecord) => l.is_active === true && !l.deleted_at

/** The pharmacy's live licenses in `state`, latest expiry first. */
function licensesIn(licenses: ReadonlyArray<LicenseRecord>, pharmacyId: string, state: string): LicenseRecord[] {
  return licenses
    .filter(l => l.pharmacy_id === pharmacyId && (l.state_code ?? '').toUpperCase() === state && isLive(l))
    .sort((a, b) => String(b.expiration_date ?? '').localeCompare(String(a.expiration_date ?? '')))
}

export function checkLicensure(input: {
  licenses:     ReadonlyArray<LicenseRecord>
  pharmacyId:   string
  pharmacyName: string
  state:        string | null | undefined
  sterile:      boolean
  facilityType: FacilityType | null
  today:        string
}): LicensureResult {
  const { pharmacyName: name, today } = input
  const state = (input.state ?? '').trim().toUpperCase()
  if (!state) {
    return { ok: false, problem: 'no_state', message: `${name}'s license cannot be checked: the order has no shipping state.` }
  }

  const license = licensesIn(input.licenses, input.pharmacyId, state)[0]
  if (!license) {
    return { ok: false, problem: 'no_license', message: `${name} is not licensed in ${state}.` }
  }
  if (!license.expiration_date) {
    return { ok: false, problem: 'expired', message: `${name}'s license in ${state} has no expiry date on record.` }
  }
  if (license.expiration_date < today) {
    return { ok: false, problem: 'expired', message: `${name}'s license in ${state} expired on ${license.expiration_date}.` }
  }

  if (input.sterile && input.facilityType !== '503B') {
    if (license.sterile_compounding === false) {
      return {
        ok: false, problem: 'not_sterile',
        message: `${name}'s license in ${state} does not cover sterile compounding, which this product needs.`,
      }
    }
    if (license.sterile_compounding !== true) {
      return {
        ok: false, problem: 'sterile_unrecorded',
        message: `${name}'s sterile compounding scope in ${state} is not recorded, so it cannot fill this sterile product. Ops can record it on the licensure page.`,
      }
    }
  }

  return { ok: true }
}

/**
 * The pharmacies' live licenses (active, not deleted), optionally in one
 * state. Expiry is judged by checkLicensure, so an expired license comes
 * back and is reported as expired rather than as missing.
 */
export async function readLicenses(
  supabase: Supabase,
  pharmacyIds: ReadonlyArray<string>,
  state?: string | null,
): Promise<{ data: LicenseRecord[]; error: { message: string } | null }> {
  if (pharmacyIds.length === 0) return { data: [], error: null }
  let q = supabase
    .from('pharmacy_state_licenses')
    .select(LICENSE_COLUMNS)
    .in('pharmacy_id', [...pharmacyIds])
    .eq('is_active', true)
    .is('deleted_at', null)
  if (state) q = q.eq('state_code', state.trim().toUpperCase())
  const { data, error } = await q
  return { data: (data ?? []) as unknown as LicenseRecord[], error: error ? { message: error.message } : null }
}

// ── Submission: an order's licensure, read fresh ───────────────

/**
 * Re-checks an order's licensure from the database before anything is sent
 * (routing engine, ops fax). Reads the order's shipping state and product,
 * and the pharmacy's licenses in that state. A failed read throws: the
 * caller must not send on an unknown.
 */
export async function checkOrderLicensure(
  supabase: Supabase,
  input: { orderId: string; pharmacyId: string; pharmacyName: string; facilityType: FacilityType | null; today?: string },
): Promise<LicensureResult> {
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('order_id, shipping_state_snapshot, formulation_id, catalog_item_id')
    .eq('order_id', input.orderId)
    .maybeSingle()
  if (orderError) throw new Error(`licensure: order ${input.orderId} could not be read: ${orderError.message}`)
  if (!order) throw new Error(`licensure: order ${input.orderId} not found`)

  const sterile = await productIsSterile(supabase, order.formulation_id, order.catalog_item_id)
  const state = order.shipping_state_snapshot
  const { data: licenses, error } = await readLicenses(supabase, [input.pharmacyId], state)
  if (error) throw new Error(`licensure: licenses for pharmacy ${input.pharmacyId} could not be read: ${error.message}`)

  return checkLicensure({
    licenses, pharmacyId: input.pharmacyId, pharmacyName: input.pharmacyName,
    state, sterile, facilityType: input.facilityType, today: input.today ?? todayIso(),
  })
}

/** Whether an order's product is sterile, from its formulation or legacy catalog item. */
export async function productIsSterile(
  supabase: Supabase,
  formulationId: string | null | undefined,
  catalogItemId: string | null | undefined,
): Promise<boolean> {
  if (formulationId) {
    const { data, error } = await supabase
      .from('formulations')
      .select('formulation_id, dosage_forms(name, is_sterile)')
      .eq('formulation_id', formulationId)
      .maybeSingle()
    if (error) throw new Error(`licensure: formulation ${formulationId} could not be read: ${error.message}`)
    const form = (data as { dosage_forms?: { name?: string | null; is_sterile?: boolean | null } | null } | null)?.dosage_forms
    return isSterileProduct({ dosageFormIsSterile: form?.is_sterile ?? null, formText: form?.name ?? null })
  }
  if (catalogItemId) {
    const { data, error } = await supabase
      .from('catalog')
      .select('item_id, form')
      .eq('item_id', catalogItemId)
      .maybeSingle()
    if (error) throw new Error(`licensure: catalog item ${catalogItemId} could not be read: ${error.message}`)
    return isSterileProduct({ formText: (data as { form?: string | null } | null)?.form ?? null })
  }
  return false
}

// ── Ops matrix ─────────────────────────────────────────────────

export type MatrixStatus = 'valid' | 'expiring' | 'expired' | 'inactive'

export interface MatrixCell {
  state:          string
  licenseNumber:  string | null
  expirationDate: string | null
  daysLeft:       number | null
  status:         MatrixStatus
  licenseType:    string | null
  sterile:        boolean | null
}

export interface MatrixRow {
  pharmacyId:   string
  pharmacyName: string
  facilityType: FacilityType | null
  cells:        Record<string, MatrixCell>
}

export interface LicensureMatrix {
  today:   string
  states:  string[]
  rows:    MatrixRow[]
  summary: { expiring: number; expired: number; sterileUnrecorded: number }
}

/** Days before expiry at which a license is flagged on the ops matrix. */
export const EXPIRING_WITHIN_DAYS = 30

export function licensureMatrix(
  licenses: ReadonlyArray<LicenseRecord>,
  pharmacies: ReadonlyArray<{ pharmacy_id: string; name: string; facility_type?: string | null }>,
  today: string,
): LicensureMatrix {
  const states = new Set<string>()
  const summary = { expiring: 0, expired: 0, sterileUnrecorded: 0 }

  const rows: MatrixRow[] = [...pharmacies]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(p => {
      const cells: Record<string, MatrixCell> = {}
      for (const l of licenses) {
        if (l.pharmacy_id !== p.pharmacy_id || l.deleted_at) continue
        const state = l.state_code.toUpperCase()
        const daysLeft = l.expiration_date ? daysUntil(l.expiration_date, today) : null
        const status: MatrixStatus = !l.is_active ? 'inactive'
          : daysLeft == null || daysLeft < 0 ? 'expired'
          : daysLeft <= EXPIRING_WITHIN_DAYS ? 'expiring'
          : 'valid'
        cells[state] = {
          state,
          licenseNumber:  l.license_number ?? null,
          expirationDate: l.expiration_date,
          daysLeft,
          status,
          licenseType:    l.license_type ?? null,
          sterile:        l.sterile_compounding,
        }
        states.add(state)
        if (status === 'expiring') summary.expiring++
        if (status === 'expired') summary.expired++
        if (status !== 'inactive' && l.sterile_compounding == null) summary.sterileUnrecorded++
      }
      return { pharmacyId: p.pharmacy_id, pharmacyName: p.name, facilityType: normalizeFacilityType(p.facility_type), cells }
    })

  return { today, states: [...states].sort(), rows, summary }
}

/** Live pharmacies and their non-deleted licenses, as the ops matrix. A failed read throws. */
export async function loadLicensureMatrix(supabase: Supabase, today: string = todayIso()): Promise<LicensureMatrix> {
  const { data: pharmacies, error: pharmacyError } = await supabase
    .from('pharmacies')
    .select('pharmacy_id, name, facility_type, is_active, deleted_at')
    .eq('is_active', true)
    .is('deleted_at', null)
  if (pharmacyError) throw new Error(`licensure matrix: pharmacies could not be read: ${pharmacyError.message}`)

  const ids = (pharmacies ?? []).map(p => p.pharmacy_id)
  if (ids.length === 0) return licensureMatrix([], [], today)

  const { data: licenses, error: licenseError } = await supabase
    .from('pharmacy_state_licenses')
    .select(LICENSE_COLUMNS)
    .in('pharmacy_id', ids)
    .is('deleted_at', null)
  if (licenseError) throw new Error(`licensure matrix: licenses could not be read: ${licenseError.message}`)

  return licensureMatrix((licenses ?? []) as unknown as LicenseRecord[], pharmacies ?? [], today)
}
