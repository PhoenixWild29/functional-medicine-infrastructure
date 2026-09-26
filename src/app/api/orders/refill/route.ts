// ============================================================
// WO-106: POST /api/orders/refill — build refill lines from past orders
// ============================================================
//
// Gina Rooks, 2026-09-11 (00:32:29): "from a specific patient
// perspective, like reordering, you want it to be as fast as possible,
// you know, not re-entering it every time."
//
// Body: { orderIds: string[] } — one order, or several for the SAME
// patient. Several matter: each order pays its own shipping when it is
// created (applyBundleShipping, single-order bundle), so refilling three
// medications one at a time charges shipping three times. Refilled
// together they become sibling drafts in one session and WO-102 charges
// shipping once per pharmacy — which is what Gina asked for in writing.
//
// Returns the prescription-session lines the client adds to its session
// before landing on Review. Everything the provider cannot see is
// decided here, server-side:
//
//   - the refill is authorized (counted from refill_of_order_id, never
//     a decrement on the signed source);
//   - a titration refills at its maintenance dose, with the reason;
//   - a cycling order refills as cycling, its quantity recomputed from
//     the stored on/off pattern (dosing days, not calendar days). One
//     written before the pattern was stored is never refilled as daily
//     dosing: the line comes back cyclePatternRequired and the picker
//     lands on the dose step to ask for the days on and off;
//   - the package is re-suggested against today's ACTIVE packages and
//     re-priced, with the delta reported rather than applied silently.
//
// Auth: verified user via getUser(); clinic_id from that user. Orders
// must belong to that clinic.

import { NextRequest, NextResponse } from 'next/server'
import { isLivePharmacy, type PharmacyLiveness } from '@/lib/pharmacies/live'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import {
  refillsUsed,
  refillAllowance,
  maintenanceFromTitration,
  priceDeltaMessage,
  type RefillPackageChange,
} from '@/lib/orders/refill'
import { parseTitrationSteps } from '@/lib/orders/titration'
import { cyclePatternFromRow } from '@/lib/orders/cycling'
import {
  rxDetailsFromRow,
  packageOptionsFromRows,
  suggestPackageForDispense,
  computeDispense,
  packageCountFor,
  packageQtyInUnit,
  packageUnitMismatchMessage,
  RX_DETAIL_COLUMN_LIST,
  type PackageOption,
} from '@/lib/orders/rx-details'
import { buildStandardSig } from '@/lib/orders/dose-display'
import { splitDose } from '@/lib/orders/dose'

export const dynamic = 'force-dynamic'

/** One order may be refilled at a time per line; a session holds several. */
const MAX_REFILL_LINES = 25

export async function POST(request: NextRequest) {
  const supabaseAuth = await createServerClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const clinicId = typeof user.user_metadata['clinic_id'] === 'string'
    ? user.user_metadata['clinic_id'] as string
    : null
  if (!clinicId) return NextResponse.json({ error: 'Session missing clinic_id' }, { status: 400 })

  let body: { orderIds?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const orderIds = Array.isArray(body.orderIds)
    ? [...new Set(body.orderIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0))]
    : []
  if (orderIds.length === 0) {
    return NextResponse.json({ error: 'orderIds required' }, { status: 400 })
  }
  if (orderIds.length > MAX_REFILL_LINES) {
    return NextResponse.json({ error: `At most ${MAX_REFILL_LINES} orders can be refilled at once` }, { status: 400 })
  }

  const supabase = createServiceClient()

  const { data: sources, error: sourcesError } = await supabase
    .from('orders')
    .select(`
      order_id, patient_id, provider_id, formulation_id, catalog_item_id, pharmacy_id,
      sig_text, sig_mode, titration_steps, cycle_on_days, cycle_off_days, quantity, created_at,
      retail_price_snapshot, wholesale_price_snapshot,
      medication_snapshot, pharmacy_snapshot,
      package_id, package_label, package_count,
      ${RX_DETAIL_COLUMN_LIST}
    `)
    .in('order_id', orderIds)
    .eq('clinic_id', clinicId)
    .is('deleted_at', null)

  if (sourcesError) {
    console.error('[refill] source lookup failed:', sourcesError.message)
    return NextResponse.json({ error: 'Failed to load orders' }, { status: 500 })
  }
  const rows = (sources ?? []) as unknown as SourceRow[]
  if (rows.length !== orderIds.length) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  // Several orders refill into ONE session, which carries one patient.
  const patientIds = new Set(rows.map(r => r.patient_id))
  if (patientIds.size > 1) {
    return NextResponse.json({ error: 'All orders must be for the same patient' }, { status: 400 })
  }

  // ── Authorization: counted, never decremented ─────────────
  const { data: priorRefills, error: countError } = await supabase
    .from('orders')
    .select('order_id, status, refill_of_order_id')
    .in('refill_of_order_id', orderIds)
    .is('deleted_at', null)
  if (countError) {
    console.error('[refill] refill count failed:', countError.message)
    return NextResponse.json({ error: 'Failed to load refill history' }, { status: 500 })
  }

  const usedBySource = new Map<string, { status: string }[]>()
  for (const r of (priorRefills ?? []) as { status: string; refill_of_order_id: string | null }[]) {
    if (!r.refill_of_order_id) continue
    const list = usedBySource.get(r.refill_of_order_id) ?? []
    list.push({ status: r.status })
    usedBySource.set(r.refill_of_order_id, list)
  }

  const blocked = rows
    .map(row => ({ row, allowance: refillAllowance(row.refills, refillsUsed(usedBySource.get(row.order_id) ?? [])) }))
    .filter(x => !x.allowance.allowed)
  if (blocked.length > 0) {
    const first = blocked[0]!
    return NextResponse.json({
      error: first.allowance.message,
      blocked: blocked.map(b => ({ orderId: b.row.order_id, used: b.allowance.used, authorized: b.allowance.authorized })),
    }, { status: 409 })
  }

  // ── The formulation as it is today ────────────────────────
  // A refill sizes the line with the formulation's CURRENT dosage form
  // and concentration, not the ones frozen on the source's snapshot. A
  // catalog correction (#183 moved six mL topicals from Topical Gel to
  // Topical Solution) would otherwise never reach a refill of an order
  // written before it. A formulation that no longer exists falls back to
  // the snapshot; a read that FAILED has no answer and is refused.
  const currentByFormulation = new Map<string, CurrentFormulation>()
  const refillFormulationIds = [...new Set(rows.map(r => r.formulation_id).filter((id): id is string => !!id))]
  if (refillFormulationIds.length > 0) {
    const { data: current, error: currentError } = await supabase
      .from('formulations')
      .select('formulation_id, concentration_value, concentration_unit, dosage_forms ( name )')
      .in('formulation_id', refillFormulationIds)
    if (currentError) {
      console.error('[refill] formulations could not be read:', currentError.message)
      return NextResponse.json(
        { error: "Today's formulation details could not be read, so this refill cannot be sized. Nothing was changed — try again." },
        { status: 503 },
      )
    }
    for (const f of (current ?? []) as unknown as CurrentFormulation[]) currentByFormulation.set(f.formulation_id, f)
  }

  // ── Packages, priced today ────────────────────────────────
  const formulationIds = rows.map(r => r.formulation_id).filter((id): id is string => !!id)
  const pharmacyIds = rows.map(r => r.pharmacy_id).filter((id): id is string => !!id)
  const packagesByKey = new Map<string, PackageOption[]>()
  if (formulationIds.length > 0 && pharmacyIds.length > 0) {
    const { data: pfRows, error: pfError } = await supabase
      .from('pharmacy_formulations')
      .select('pharmacy_id, formulation_id, wholesale_price, pharmacy_formulation_packages(id, package_label, package_qty, package_unit, wholesale_price, is_default, active), pharmacies ( name, is_active, deleted_at )')
      .in('formulation_id', formulationIds)
      .in('pharmacy_id', pharmacyIds)
      .eq('is_active', true)
      .eq('is_available', true)
      .is('deleted_at', null)
    // Batch 2C: this error used to be discarded. With no packages the line
    // fell back to the source order's wholesale, repriceRequired came out
    // false, and the refill skipped the WO-108 price interrupt exactly when
    // we could not see the price. A read that failed has no answer.
    if (pfError) {
      console.error('[refill] package prices could not be read:', pfError.message)
      return NextResponse.json(
        { error: "Today's package prices could not be read, so this refill cannot be priced. Nothing was changed — try again." },
        { status: 503 },
      )
    }
    // A refill goes to the source order's pharmacy. If that pharmacy is
    // no longer live (or no longer offers the formulation), the refill is
    // refused up front, naming the line — it is never priced from a
    // snapshot and sent to a pharmacy that cannot fill it.
    const offered = new Set(
      ((pfRows ?? []) as unknown as Array<{ pharmacy_id: string; formulation_id: string; pharmacies?: PharmacyLiveness | null }>)
        .filter(pf => isLivePharmacy(pf.pharmacies))
        .map(pf => `${pf.pharmacy_id}:${pf.formulation_id}`),
    )
    const unavailable = rows.filter(r => r.formulation_id && r.pharmacy_id && !offered.has(`${r.pharmacy_id}:${r.formulation_id}`))
    if (unavailable.length > 0) {
      return NextResponse.json({
        error: `${unavailable.map(r => refillLineName(r)).join(', ')} cannot be refilled as before: the pharmacy is no longer active or no longer offers it. Start a new prescription to choose another pharmacy.`,
        code:  'PHARMACY_INACTIVE',
        unavailable: unavailable.map(r => r.order_id),
      }, { status: 409 })
    }
    for (const pf of (pfRows ?? []) as unknown as PharmacyFormulationRow[]) {
      packagesByKey.set(
        `${pf.pharmacy_id}:${pf.formulation_id}`,
        packageOptionsFromRows(pf.pharmacy_formulation_packages ?? []),
      )
    }
  }

  const lines = rows.map(row => buildRefillLine(row, packagesByKey, row.formulation_id ? currentByFormulation.get(row.formulation_id) ?? null : null))

  // A package that cannot be sized against the refill's dispense (an mg
  // vial with no concentration, a container-only "1 vial") is refused,
  // naming the line, rather than refilled as one package.
  const unsized = lines.filter(l => l.packageUnitMismatch)
  if (unsized.length > 0) {
    return NextResponse.json({
      error: unsized.map(l => `${l.medicationName}: ${l.packageUnitMismatch}`).join(' '),
      code:  'PACKAGE_UNIT_MISMATCH',
      unavailable: unsized.map(l => l.refillOfOrderId),
    }, { status: 409 })
  }

  return NextResponse.json({
    patientId: rows[0]!.patient_id,
    lines,
  })
}

// ── Row shapes ──────────────────────────────────────────────

interface SourceRow {
  order_id:        string
  patient_id:      string
  provider_id:     string | null
  formulation_id:  string | null
  catalog_item_id: string | null
  pharmacy_id:     string | null
  sig_text:        string | null
  sig_mode:        string | null
  titration_steps: unknown
  cycle_on_days?:  number | null
  cycle_off_days?: number | null
  quantity:        number | null
  created_at:      string
  retail_price_snapshot:    number | null
  wholesale_price_snapshot: number | null
  medication_snapshot: Record<string, unknown> | null
  pharmacy_snapshot:   Record<string, unknown> | null
  package_id:      string | null
  package_label:   string | null
  package_count:   number | null
  refills:         number | null
  days_supply:     number | null
  dispense_quantity: number | string | null
  dispense_unit:   string | null
}

interface PharmacyFormulationRow {
  pharmacy_id:    string
  formulation_id: string
  wholesale_price: number | null
  pharmacy_formulation_packages: Parameters<typeof packageOptionsFromRows>[0]
}

// ── One line ────────────────────────────────────────────────

interface CurrentFormulation {
  formulation_id:      string
  concentration_value: number | string | null
  concentration_unit:  string | null
  dosage_forms:        { name?: string | null } | Array<{ name?: string | null }> | null
}

function buildRefillLine(row: SourceRow, packagesByKey: Map<string, PackageOption[]>, current: CurrentFormulation | null) {
  const sourceRetailCents = row.retail_price_snapshot != null ? Math.round(row.retail_price_snapshot * 100) : 0
  const snap = row.medication_snapshot ?? {}
  const pharmacySnap = row.pharmacy_snapshot ?? {}
  const rxDetails = rxDetailsFromRow(row as unknown as Record<string, unknown>)

  const storedDose = typeof snap['prescribed_dose'] === 'string' ? snap['prescribed_dose']
    : typeof snap['dose'] === 'string' ? snap['dose'] : ''
  const storedFrequency = typeof snap['frequency_code'] === 'string' ? snap['frequency_code'] : null
  const quantityLabel = typeof snap['quantity_label'] === 'string' ? snap['quantity_label'] : null
  // Today's catalog first (see the handler); the snapshot only when the
  // formulation is gone.
  const currentForm = current
    ? (Array.isArray(current.dosage_forms) ? current.dosage_forms[0]?.name : current.dosage_forms?.name) ?? null
    : null
  const currentConc = current?.concentration_value != null && Number.isFinite(Number(current.concentration_value))
    ? Number(current.concentration_value)
    : null
  const concentrationValue = currentConc ?? (typeof snap['concentration_value'] === 'number' ? snap['concentration_value'] : null)
  const concentrationUnit = (current?.concentration_unit ?? null) ?? (typeof snap['concentration_unit'] === 'string' ? snap['concentration_unit'] : null)
  const dosageFormName = currentForm ?? (typeof snap['form'] === 'string' ? snap['form'] : null)

  // ── Titration → maintenance dose ────────────────────────
  const steps = row.sig_mode === 'titration' ? parseTitrationSteps(row.titration_steps) : []
  const maintenance = steps.length > 0 ? maintenanceFromTitration(steps) : null

  let dose = storedDose
  let frequencyCode = storedFrequency
  let durationDays: number | null = row.days_supply ?? null
  let sigText = row.sig_text ?? ''
  let notice: string | null = null

  if (maintenance) {
    dose = `${maintenance.dose} ${maintenance.unit}`.trim()
    frequencyCode = maintenance.frequency
    durationDays = maintenance.durationDays
    notice = maintenance.note
    const generated = buildStandardSig({
      doseAmount:    maintenance.dose,
      doseUnit:      maintenance.unit,
      frequencyCode: maintenance.frequency,
      formulation: {
        concentration_value: concentrationValue,
        concentration_unit:  concentrationUnit,
        dosage_forms:        dosageFormName ? { name: dosageFormName } : null,
        routes_of_administration: readRoute(snap),
      },
    })
    if (generated) sigText = generated
  }

  // ── Package, priced today ───────────────────────────────
  const packages = packagesByKey.get(`${row.pharmacy_id}:${row.formulation_id}`) ?? []
  const previousCents = row.wholesale_price_snapshot != null
    ? Math.round(row.wholesale_price_snapshot * 100)
    : null

  // ── Cycling → the same pattern, the same dosing days ────
  // The length is the source's days supply (the calendar span). A
  // cycling source with no stored pattern is NOT recomputed: sizing it
  // without the pattern would be sizing it as daily dosing. It keeps
  // the source's own numbers and waits for the provider (below).
  const isCycling = row.sig_mode === 'cycling'
  const cyclePattern = isCycling ? cyclePatternFromRow(row) : null
  const cyclePatternRequired = isCycling && !cyclePattern

  const { amount, unit } = splitDose(dose)
  const derived = cyclePatternRequired ? null : computeDispense({
    doseAmount:         amount,
    doseUnit:           unit,
    frequencyCode:      frequencyCode,
    quantityLabel:      quantityLabel,
    concentrationValue: concentrationValue,
    concentrationUnit:  concentrationUnit,
    dosageFormName:     dosageFormName,
    durationDays:       durationDays,
    cycle:              cyclePattern,
  })

  const stillPriced = row.package_id ? packages.find(p => p.id === row.package_id) ?? null : null
  let change: RefillPackageChange | null = null
  let packageUnitMismatch: string | null = null
  // Package amounts are counted in the dispense unit: a 5 mg vial at
  // 1 mg/mL holds 5 mL (prod, 2026-09-25: 30 mL had been one vial).
  const sizing = { dosageFormName, concentrationValue, concentrationUnit }

  if (packages.length > 0) {
    if (stillPriced) {
      const stored = row.package_count && row.package_count > 0 ? row.package_count : 1
      const sizedQty = derived ? packageQtyInUnit(stillPriced, derived.dispenseUnit, sizing) : null
      if (derived && derived.dispenseQuantity > 0 && sizedQty == null) {
        packageUnitMismatch = packageUnitMismatchMessage(stillPriced, derived.dispenseUnit)
      }
      // The count the dispense needs — never fewer than the source carried
      // (a provider may have ordered more), but never the source's single
      // vial carried forward when the Rx needs six.
      const count = derived && sizedQty != null
        ? Math.max(stored, packageCountFor(stillPriced, derived.dispenseQuantity, { unit: derived.dispenseUnit, ...sizing }))
        : stored
      change = {
        packageId:      stillPriced.id,
        packageLabel:   stillPriced.label,
        packageCount:   count,
        currentCents:   Math.round(stillPriced.wholesalePrice * 100) * count,
        previousCents,
        previousAt:     row.created_at,
        packageChanged: false,
      }
    } else {
      // The size on the order is gone (or there never was one): suggest
      // from today's active packages rather than resending a stale id
      // and letting the server reject it with an internal error.
      const suggestion = derived
        ? suggestPackageForDispense(
            packages,
            { dispenseQuantity: derived.dispenseQuantity ?? 0, dispenseUnit: derived.dispenseUnit ?? '', daysSupply: derived.daysSupply },
            dosageFormName,
            sizing,
          )
        : null
      if (suggestion?.reason === 'unconvertible') {
        packageUnitMismatch = packageUnitMismatchMessage(suggestion.package, derived!.dispenseUnit)
      } else if (suggestion) {
        change = {
          packageId:      suggestion.package.id,
          packageLabel:   suggestion.package.label,
          packageCount:   suggestion.count,
          currentCents:   Math.round(suggestion.package.wholesalePrice * 100) * suggestion.count,
          previousCents,
          previousAt:     row.created_at,
          packageChanged: row.package_id != null,
        }
      }
    }
  }

  const priceNote = change ? priceDeltaMessage(change) : null

  // ── WO-108: the price the provider must confirm ───────────
  //
  // The line used to carry the source order's retail forward against
  // today's wholesale, so the clinic absorbed every price move in
  // silence. The decision belongs to the provider, so the wholesale
  // moving is what interrupts — in either direction, any amount.
  //
  // previousCents null means the source has no recorded wholesale: we
  // cannot show that nothing moved, so it counts as moved.
  const currentWholesaleCents = change?.currentCents ?? (previousCents ?? 0)
  const repriceRequired = previousCents == null || currentWholesaleCents !== previousCents

  // Preserving the original margin percentage only means something when
  // there IS one: a source with no wholesale, or one already priced
  // below its own cost, has no margin worth carrying forward. Both fall
  // back to the clinic's default markup, and the page says why.
  const canPreserveMargin = previousCents != null && previousCents > 0 && sourceRetailCents >= previousCents
  const suggestedRetailCents = canPreserveMargin
    ? Math.round(currentWholesaleCents * sourceRetailCents / previousCents)
    : null

  return {
    refillOfOrderId: row.order_id,
    pharmacyId:      row.pharmacy_id ?? '',
    pharmacyName:    typeof pharmacySnap['name'] === 'string' ? pharmacySnap['name'] : '',
    itemId:          row.catalog_item_id,
    formulationId:   row.formulation_id,
    medicationName:  typeof snap['medication_name'] === 'string' ? snap['medication_name'] : 'Prescription',
    form:            dosageFormName ?? '',
    dose,
    frequencyCode,
    quantityLabel,
    sigText,
    // A finished titration refills as standard at its maintenance dose;
    // a cycling order refills as cycling.
    sigMode:         isCycling ? ('cycling' as const) : ('standard' as const),
    titrationSteps:  [] as never[],
    cycle:           cyclePattern ? { ...cyclePattern, lengthDays: durationDays } : null,
    cyclePatternRequired,
    rxDetails: {
      ...rxDetails,
      daysSupply:       derived?.daysSupply ?? rxDetails.daysSupply,
      dispenseQuantity: derived?.dispenseQuantity ?? rxDetails.dispenseQuantity,
      dispenseUnit:     derived?.dispenseUnit ?? rxDetails.dispenseUnit,
    },
    concentrationValue,
    concentrationUnit,
    wholesaleCents:  currentWholesaleCents,
    retailCents:     sourceRetailCents,
    // WO-108: what the source charged, what today's margin-preserving
    // price would be, and whether the provider has to confirm it.
    sourceRetailCents,
    sourceWholesaleCents: previousCents,
    suggestedRetailCents,
    marginBasis: canPreserveMargin ? ('preserved' as const) : ('clinic_default' as const),
    repriceRequired,
    packageId:       change?.packageId ?? null,
    packageLabel:    change?.packageLabel ?? null,
    packageCount:    change?.packageCount ?? null,
    // Shown on the Review card. Both are decisions the provider must be
    // able to see and undo, so neither is applied silently.
    maintenanceNote: notice,
    priceNote,
    // Refused by the handler when set (never sent to the client as a line).
    packageUnitMismatch,
  }
}

function readRoute(snap: Record<string, unknown>): { name: string; sig_prefix: string } | null {
  const route = snap['route'] ?? snap['routes_of_administration']
  if (typeof route === 'object' && route !== null) {
    const r = route as Record<string, unknown>
    if (typeof r['name'] === 'string') {
      return { name: r['name'], sig_prefix: typeof r['sig_prefix'] === 'string' ? r['sig_prefix'] : 'Take' }
    }
  }
  return null
}

/** The medication name a refused refill line is reported by. */
function refillLineName(row: SourceRow): string {
  const snap = (row as { medication_snapshot?: unknown }).medication_snapshot
  const name = snap && typeof snap === 'object' ? (snap as Record<string, unknown>)['medication_name'] : null
  return typeof name === 'string' && name ? name : 'A prescription'
}
