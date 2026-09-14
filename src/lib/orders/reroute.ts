// ============================================================
// WO-102: multi-pharmacy notice + one-click re-route (Review)
// ============================================================
//
// Gina Rooks, 2026-09-11: ordering one patient's prescriptions from more
// than one pharmacy "you might get better pricing but … you pay shipping
// more than once". When a Review session spans more than one pharmacy the
// page says what the split costs, and offers to route everything to one of
// them — only when that is genuinely possible and genuinely cheaper.
//
// A pharmacy is offered as the target only when EVERY line is available
// there (it offers the formulation; pharmacy_options already filters to
// pharmacies licensed in the patient's state). Re-routing a line re-prices
// it at the target: the same package (by label and count) when the target
// sells it, otherwise the package the target would suggest for the line's
// dispense quantity, otherwise the target's formulation price. Retail keeps
// the line's markup (as changing a package does on the price step).
//
// The notice never advertises a shipping saving that a medication price
// increase wipes out: the re-route is offered only when the net change
// (medication prices + shipping) is a saving, and any price change is
// named with the net before the provider clicks.
//
// Pure. Integer cents.

import {
  suggestPackageForDispense,
  type PackageOption,
} from './rx-details'
import { computeBundleShipping, type PharmacyShippingRates } from './shipping'

export interface RerouteLine {
  id:              string
  medicationName:  string
  pharmacyId:      string
  pharmacyName:    string
  formulationId:   string | null
  wholesaleCents:  number
  retailCents:     number
  shippingType:    string | null | undefined
  packageId?:      string | null
  packageLabel?:   string | null
  packageCount?:   number | null
  dispenseQuantity?: number | null
  dispenseUnit?:     string | null
  dosageFormName?:   string | null
}

/** One pharmacy's offer for a formulation (pharmacy_options, licensed in the patient's state). */
export interface PharmacyOffer {
  pharmacyId:     string
  pharmacyName:   string
  integrationTier?: string | null
  wholesaleCents: number
  packages:       PackageOption[]
}

export interface ReroutedLine {
  lineId:         string
  medicationName: string
  pharmacyId:     string
  pharmacyName:   string
  integrationTier: string | null
  wholesaleCents: number
  retailCents:    number
  packageId:      string | null
  packageLabel:   string | null
  packageCount:   number | null
  /** retailCents − the line's current retail */
  priceChangeCents: number
  fromRetailCents:  number
}

export interface ReroutePlan {
  targetPharmacyId:     string
  targetPharmacyName:   string
  lines:                ReroutedLine[]
  currentShippingCents: number
  newShippingCents:     number
  /** new − current (negative = saving) */
  shippingDeltaCents:   number
  /** Σ retail change (negative = cheaper) */
  medicationDeltaCents: number
  /** shipping + medication change (negative = saving) */
  netDeltaCents:        number
}

function roundRetail(retailCents: number, fromWholesale: number, toWholesale: number): number {
  if (toWholesale === fromWholesale || fromWholesale <= 0) return retailCents
  return Math.max(toWholesale, Math.round(retailCents * toWholesale / fromWholesale))
}

/** Price one line at the target pharmacy; null when the target does not offer it. */
export function priceLineAt(line: RerouteLine, offer: PharmacyOffer | undefined): ReroutedLine | null {
  if (!offer) return null

  let wholesaleCents = offer.wholesaleCents
  let packageId: string | null = null
  let packageLabel: string | null = null
  let packageCount: number | null = null

  if (offer.packages.length > 0) {
    const count = line.packageCount && line.packageCount > 0 ? line.packageCount : 1
    const sameLabel = line.packageLabel
      ? offer.packages.find(p => p.label.trim().toLowerCase() === line.packageLabel!.trim().toLowerCase())
      : undefined
    const suggestion = sameLabel
      ? { package: sameLabel, count }
      : line.dispenseQuantity != null && line.dispenseUnit
        ? suggestPackageForDispense(offer.packages, { dispenseQuantity: line.dispenseQuantity, dispenseUnit: line.dispenseUnit }, line.dosageFormName)
        : null
    const chosen = suggestion ?? { package: offer.packages.find(p => p.isDefault) ?? offer.packages[0]!, count: 1 }
    // Same visibility rule as the price step: a package is named when the
    // pharmacy sells more than one, or more than one of it is needed.
    if (offer.packages.length > 1 || chosen.count > 1) {
      packageId = chosen.package.id
      packageLabel = chosen.package.label
      packageCount = chosen.count
      wholesaleCents = Math.round(chosen.package.wholesalePrice * 100) * chosen.count
    }
  }

  const retailCents = roundRetail(line.retailCents, line.wholesaleCents, wholesaleCents)
  return {
    lineId:          line.id,
    medicationName:  line.medicationName,
    pharmacyId:      offer.pharmacyId,
    pharmacyName:    offer.pharmacyName,
    integrationTier: offer.integrationTier ?? null,
    wholesaleCents,
    retailCents,
    packageId,
    packageLabel,
    packageCount,
    priceChangeCents: retailCents - line.retailCents,
    fromRetailCents:  line.retailCents,
  }
}

/**
 * Plan routing every line to `targetPharmacyId`. Lines already there keep
 * their pricing. null when any line is not available at the target.
 */
export function planReroute(
  lines: ReadonlyArray<RerouteLine>,
  targetPharmacyId: string,
  offersByLine: ReadonlyMap<string, ReadonlyArray<PharmacyOffer>>,
  rates: ReadonlyMap<string, PharmacyShippingRates>,
): ReroutePlan | null {
  if (lines.length === 0) return null
  const rerouted: ReroutedLine[] = []
  let targetName = ''
  for (const line of lines) {
    if (line.pharmacyId === targetPharmacyId) {
      targetName ||= line.pharmacyName
      rerouted.push({
        lineId: line.id, medicationName: line.medicationName, pharmacyId: line.pharmacyId, pharmacyName: line.pharmacyName,
        integrationTier: null, wholesaleCents: line.wholesaleCents, retailCents: line.retailCents,
        packageId: line.packageId ?? null, packageLabel: line.packageLabel ?? null, packageCount: line.packageCount ?? null,
        priceChangeCents: 0, fromRetailCents: line.retailCents,
      })
      continue
    }
    if (!line.formulationId) return null   // legacy catalog items can't be re-priced elsewhere
    const offer = (offersByLine.get(line.id) ?? []).find(o => o.pharmacyId === targetPharmacyId)
    const priced = priceLineAt(line, offer)
    if (!priced) return null
    targetName ||= priced.pharmacyName
    rerouted.push(priced)
  }

  const current = computeBundleShipping(lines.map(l => ({ pharmacyId: l.pharmacyId, shippingType: l.shippingType, wholesaleCents: l.wholesaleCents })), rates)
  const next = computeBundleShipping(
    rerouted.map((r, i) => ({ pharmacyId: r.pharmacyId, shippingType: lines[i]!.shippingType, wholesaleCents: r.wholesaleCents })),
    rates,
  )
  const medicationDeltaCents = rerouted.reduce((s, r) => s + r.priceChangeCents, 0)
  const shippingDeltaCents = next.totalCents - current.totalCents
  return {
    targetPharmacyId,
    targetPharmacyName:   targetName || rates.get(targetPharmacyId)?.pharmacyName || '',
    lines:                rerouted,
    currentShippingCents: current.totalCents,
    newShippingCents:     next.totalCents,
    shippingDeltaCents,
    medicationDeltaCents,
    netDeltaCents:        shippingDeltaCents + medicationDeltaCents,
  }
}

export interface MultiPharmacyNotice {
  pharmacyCount:        number
  currentShippingCents: number
  /** The best eligible plan (lowest net), whether or not it saves. */
  plan:                 ReroutePlan | null
  /** True only when routing all to plan's pharmacy is a net saving. */
  offerReroute:         boolean
  message:              string
}

const money = (cents: number): string => '$' + (Math.abs(cents) / 100).toFixed(2)

/**
 * The Review notice for a session spanning more than one pharmacy, or null
 * for a single-pharmacy session. Candidates are the session's own
 * pharmacies.
 */
export function multiPharmacyNotice(
  lines: ReadonlyArray<RerouteLine>,
  offersByLine: ReadonlyMap<string, ReadonlyArray<PharmacyOffer>>,
  rates: ReadonlyMap<string, PharmacyShippingRates>,
): MultiPharmacyNotice | null {
  const pharmacyIds = [...new Set(lines.map(l => l.pharmacyId))]
  if (pharmacyIds.length < 2) return null

  const current = computeBundleShipping(lines.map(l => ({ pharmacyId: l.pharmacyId, shippingType: l.shippingType, wholesaleCents: l.wholesaleCents })), rates)
  const charges = current.byPharmacy.filter(p => p.feeCents > 0).length
  const head = `${pharmacyIds.length} pharmacies → ${charges} shipping charge${charges === 1 ? '' : 's'} (${money(current.totalCents)})`

  const plans = pharmacyIds
    .map(id => planReroute(lines, id, offersByLine, rates))
    .filter((p): p is ReroutePlan => p != null)
    .sort((a, b) => a.netDeltaCents - b.netDeltaCents)
  const plan = plans[0] ?? null

  if (!plan) {
    return { pharmacyCount: pharmacyIds.length, currentShippingCents: current.totalCents, plan: null, offerReroute: false, message: `${head}.` }
  }

  const changed = plan.lines.filter(l => l.priceChangeCents !== 0)
  const priceList = changed
    .map(l => `${l.medicationName} ${money(l.fromRetailCents)} → ${money(l.retailCents)}`)
    .join('; ')
  const to = plan.targetPharmacyName

  if (plan.netDeltaCents < 0) {
    const message = changed.length === 0
      ? `${head}. Route all to ${to} to save ${money(plan.netDeltaCents)}.`
      : `${head}. Route all to ${to}: shipping ${plan.shippingDeltaCents <= 0 ? 'saves' : 'adds'} ${money(plan.shippingDeltaCents)}, ` +
        `and medication prices ${plan.medicationDeltaCents > 0 ? 'rise' : 'fall'} ${money(plan.medicationDeltaCents)} (${priceList}). ` +
        `Net saving ${money(plan.netDeltaCents)}.`
    return { pharmacyCount: pharmacyIds.length, currentShippingCents: current.totalCents, plan, offerReroute: true, message }
  }

  // Not a saving: say so rather than advertise the shipping alone.
  const message = plan.shippingDeltaCents < 0 && changed.length > 0
    ? `${head}. Routing all to ${to} would save ${money(plan.shippingDeltaCents)} on shipping, but medication prices would ` +
      `${plan.medicationDeltaCents > 0 ? 'rise' : 'fall'} ${money(plan.medicationDeltaCents)} (${priceList}) — ` +
      `${plan.netDeltaCents === 0 ? 'no net saving' : `${money(plan.netDeltaCents)} more overall`}, so it is not suggested.`
    : `${head}.`
  return { pharmacyCount: pharmacyIds.length, currentShippingCents: current.totalCents, plan, offerReroute: false, message }
}
