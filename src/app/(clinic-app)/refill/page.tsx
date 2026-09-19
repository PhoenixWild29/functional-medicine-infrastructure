// ============================================================
// Refill — pick a patient, pick what to refill — WO-106
// /refill
// ============================================================
//
// Gina Rooks, 2026-09-11 (00:32:29): "from a specific patient
// perspective, like reordering, you want it to be as fast as possible,
// you know, not re-entering it every time."
//
// Lauren Perkins, 2026-09-11 (01:35:48): "they definitely are going to
// need to do refills, whether that's a oneoff refill or whether that's
// refilling multiples."
//
// Refilling multiples is not a convenience. Each order pays its own
// shipping when it is created (applyBundleShipping with a single-order
// bundle), so three refills sent one at a time charge the patient
// shipping three times — the thing Gina raised in writing. Refilled
// together they become sibling drafts in ONE session and WO-102 charges
// shipping once per pharmacy.
//
// Only patients with prior orders appear, because a refill needs
// something to refill.
//
// Auth: verified user via getUser(); clinic_id from that user. The
// provider path (WO-100) prescribes as themself.

import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveCurrentProvider } from '@/lib/auth/current-provider'
import { SessionGuardNotice } from '@/components/session-guard-notice'
import { HipaaTimeout } from '@/components/hipaa-timeout'
import { RefillPicker, type RefillablePatient, type RefillableOrder } from './_components/refill-picker'
import { refillsUsed, refillAllowance } from '@/lib/orders/refill'

export const dynamic = 'force-dynamic'

/** Orders scanned for refillable history. A clinic's recent work, not all time. */
const SCAN_LIMIT = 500

export default async function RefillPage(
  props: { searchParams?: Promise<{ order?: string }> } = {},
) {
  const preselectOrderId = ((await props.searchParams)?.order ?? '').trim() || null
  const supabaseAuth = await createServerClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return <SessionGuardNotice />

  const clinicId = typeof user.user_metadata['clinic_id'] === 'string'
    ? user.user_metadata['clinic_id'] as string
    : null
  if (!clinicId) return <SessionGuardNotice />

  const appRole = typeof user.user_metadata['app_role'] === 'string'
    ? user.user_metadata['app_role'] as string
    : undefined

  const supabase = createServiceClient()

  const [ordersResult, selfProvider] = await Promise.all([
    supabase
      .from('orders')
      .select(`
        order_id, patient_id, provider_id, status, created_at, refills,
        sig_text, sig_mode, medication_snapshot, pharmacy_snapshot, pharmacy_id,
        package_label, package_count, refill_of_order_id,
        patients!inner(patient_id, first_name, last_name, date_of_birth, phone, state, sms_opt_in)
      `)
      .eq('clinic_id', clinicId)
      .is('deleted_at', null)
      .neq('status', 'DRAFT')
      .order('created_at', { ascending: false })
      .limit(SCAN_LIMIT),
    appRole === 'provider'
      ? resolveCurrentProvider(supabase, { userId: user.id, clinicId })
      : Promise.resolve(null),
  ])

  // A failed query is not an empty clinic. `data ?? []` used to turn any
  // PostgREST error into "No patient has a prescription to refill yet",
  // which a provider cannot tell from a real empty state — and nothing
  // reached the logs. Log the whole error and say so on the page.
  // PostgREST errors carry schema-level text (codes, column names), never
  // patient data, so the code and message are safe to show staff.
  if (ordersResult.error) {
    const e = ordersResult.error
    console.error(
      '[refill] orders query failed:',
      JSON.stringify({ code: e.code, message: e.message, details: e.details, hint: e.hint }),
      '| clinic=', clinicId,
    )
    return (
      <>
        <HipaaTimeout />
        <main className="mx-auto max-w-3xl px-4 py-8">
          <h1 className="text-2xl font-bold text-foreground">Refill</h1>
          <div
            role="alert"
            data-testid="refill-load-error"
            className="mt-6 rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-800"
          >
            <p className="font-semibold">Prescriptions could not be loaded for refill.</p>
            <p className="mt-1">
              This is an error, not an empty list — nothing has been refilled. Try again, and if it
              persists, report the code below.
            </p>
            <p className="mt-3 font-mono text-xs" data-testid="refill-load-error-detail">
              {e.code ?? 'no code'}: {e.message}
            </p>
          </div>
        </main>
      </>
    )
  }

  const rows = (ordersResult.data ?? []) as unknown as OrderRow[]

  // How many refills each order has already had. Counted, never stored:
  // a cancelled or refunded refill frees the authorization again.
  const usedBySource = new Map<string, { status: string }[]>()
  for (const r of rows) {
    if (!r.refill_of_order_id) continue
    const list = usedBySource.get(r.refill_of_order_id) ?? []
    list.push({ status: r.status })
    usedBySource.set(r.refill_of_order_id, list)
  }

  const patients = new Map<string, RefillablePatient>()
  for (const row of rows) {
    // A refill of a refill is refilled against ITS source's
    // authorization, so only original orders are offered.
    if (row.refill_of_order_id) continue

    const p = row.patients
    if (!p) continue
    const allowance = refillAllowance(row.refills, refillsUsed(usedBySource.get(row.order_id) ?? []))
    const snap = row.medication_snapshot ?? {}
    const pharmacySnap = row.pharmacy_snapshot ?? {}

    const order: RefillableOrder = {
      orderId:        row.order_id,
      medicationName: typeof snap['medication_name'] === 'string' ? snap['medication_name'] : 'Prescription',
      dose:           typeof snap['prescribed_dose'] === 'string' ? snap['prescribed_dose']
                      : typeof snap['dose'] === 'string' ? snap['dose'] : '',
      pharmacyId:     row.pharmacy_id ?? '',
      pharmacyName:   typeof pharmacySnap['name'] === 'string' ? pharmacySnap['name'] : '',
      createdAt:      row.created_at,
      status:         row.status,
      isTitration:    row.sig_mode === 'titration',
      packageLabel:   row.package_label,
      packageCount:   row.package_count,
      refillsUsed:      allowance.used,
      refillsAuthorized: allowance.authorized,
      refillable:     allowance.allowed,
      blockedReason:  allowance.message ?? null,
    }

    const existing = patients.get(p.patient_id)
    if (existing) {
      existing.orders.push(order)
    } else {
      patients.set(p.patient_id, {
        patient: {
          patient_id:    p.patient_id,
          first_name:    p.first_name,
          last_name:     p.last_name,
          date_of_birth: p.date_of_birth,
          phone:         p.phone,
          state:         p.state,
          sms_opt_in:    p.sms_opt_in,
        },
        orders: [order],
      })
    }
  }

  const list = [...patients.values()].sort((a, b) =>
    `${a.patient.last_name}${a.patient.first_name}`.localeCompare(`${b.patient.last_name}${b.patient.first_name}`),
  )

  return (
    <>
      <HipaaTimeout />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-bold text-foreground">Refill</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick a patient, then the prescriptions to refill. Refilling several at once keeps
          them on one order for the patient, so shipping is charged once per pharmacy.
        </p>

        <RefillPicker
          patients={list}
          preselectOrderId={preselectOrderId}
          provider={selfProvider ? {
            provider_id:    selfProvider.provider_id,
            first_name:     selfProvider.first_name,
            last_name:      selfProvider.last_name,
            npi_number:     selfProvider.npi_number,
            signature_hash: selfProvider.signature_hash ?? null,
          } : null}
        />
      </main>
    </>
  )
}

interface OrderRow {
  order_id:           string
  patient_id:         string
  provider_id:        string | null
  status:             string
  created_at:         string
  refills:            number | null
  sig_text:           string | null
  sig_mode:           string | null
  medication_snapshot: Record<string, unknown> | null
  pharmacy_snapshot:   Record<string, unknown> | null
  pharmacy_id:        string | null
  package_label:      string | null
  package_count:      number | null
  refill_of_order_id: string | null
  patients: {
    patient_id:    string
    first_name:    string
    last_name:     string
    date_of_birth: string
    phone:         string
    state:         string | null
    sms_opt_in:    boolean
  } | null
}
