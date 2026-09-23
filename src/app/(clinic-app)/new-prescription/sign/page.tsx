// ============================================================
// Batch sign — /new-prescription/sign?orders=<id>,<id>… (WO-99)
// ============================================================
//
// The one place a provider signs saved drafts. Gina Rooks asked to sign
// all of a patient's prescriptions at once; this page lists the drafts
// named in ?orders= pre-selected, grouped by patient, alongside that
// patient's other drafts (unselected — one click adds them), with the
// same safety checks Review runs, one signature pad and one Sign & Send.
//
// Reached from the dashboard (Sign all / Sign selected), the drawer, and
// /new-prescription/sign/<id>, which redirects here with that order.
//
// Provider only: src/middleware.ts sends every other role to
// /unauthorized for this exact path and the /sign/ prefix; the check
// below is the belt behind it, and batch-sign refuses anyone else.

import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { HipaaTimeout } from '@/components/hipaa-timeout'
import { SessionGuardNotice } from '@/components/session-guard-notice'
import { resolveCurrentProvider } from '@/lib/auth/current-provider'
import { loadShippingRates } from '@/lib/orders/apply-bundle-shipping'
import { rxDetailsFromRow, RX_DETAIL_COLUMN_LIST } from '@/lib/orders/rx-details'
import { parseTitrationSteps } from '@/lib/orders/titration'
import { parseOrdersParam, type BatchDraftLine, type BatchPatientView } from '@/lib/orders/batch-sign-view'
import { BatchSignForm } from './_components/batch-sign-form'

export const metadata = {
  title: 'Sign Prescriptions',
}

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const LINE_SELECT = `order_id, status, patient_id, provider_id, pharmacy_id, medication_snapshot, pharmacy_snapshot, sig_text,
  retail_price_snapshot, wholesale_price_snapshot, sig_mode, titration_steps, refill_of_order_id,
  package_label, package_count, created_at, ${RX_DETAIL_COLUMN_LIST}`

type LineRow = Record<string, unknown> & {
  order_id: string
  patient_id: string
  provider_id: string
  pharmacy_id: string | null
  created_at: string
}

function toLine(row: LineRow): BatchDraftLine {
  const med = (row['medication_snapshot'] ?? {}) as Record<string, unknown>
  const ph  = (row['pharmacy_snapshot'] ?? {}) as Record<string, unknown>
  const sigMode = row['sig_mode'] === 'titration' ? 'titration' : row['sig_mode'] === 'cycling' ? 'cycling' : 'standard'
  const schedule = med['dea_schedule']
  return {
    orderId:         row.order_id,
    patientId:       row.patient_id,
    medicationName:  typeof med['medication_name'] === 'string' ? med['medication_name'] : 'Prescription',
    form:            typeof med['form'] === 'string' ? med['form'] : '',
    dose:            typeof med['prescribed_dose'] === 'string' ? med['prescribed_dose'] : typeof med['dose'] === 'string' ? med['dose'] : '',
    pharmacyId:      row.pharmacy_id ?? '',
    pharmacyName:    typeof ph['name'] === 'string' ? ph['name'] : 'Unknown pharmacy',
    sigText:         typeof row['sig_text'] === 'string' ? row['sig_text'] : '',
    retailCents:     Math.round(Number(row['retail_price_snapshot'] ?? 0) * 100),
    wholesaleCents:  Math.round(Number(row['wholesale_price_snapshot'] ?? 0) * 100),
    shippingType:    typeof row['shipping_type'] === 'string' ? row['shipping_type'] : null,
    rxDetails:       rxDetailsFromRow(row as Parameters<typeof rxDetailsFromRow>[0]),
    deaSchedule:     typeof schedule === 'number' ? schedule : null,
    sigMode,
    titrationSteps:  sigMode === 'titration' ? parseTitrationSteps(row['titration_steps']) : [],
    refillOfOrderId: typeof row['refill_of_order_id'] === 'string' ? row['refill_of_order_id'] : null,
    packageLabel:    typeof row['package_label'] === 'string' ? row['package_label'] : null,
    packageCount:    typeof row['package_count'] === 'number' ? row['package_count'] : null,
  }
}

function Notice({ title, message }: { title: string; message: string }) {
  return (
    <main className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="text-xl font-semibold text-foreground">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{message}</p>
      <a href="/dashboard" className="mt-4 inline-block text-sm text-primary underline">Back to dashboard</a>
    </main>
  )
}

export default async function BatchSignPage({ searchParams }: PageProps) {
  const params = await searchParams

  // getUser(), never getSession(); no auth redirect() from this streamed
  // page body — see @/components/session-guard-notice.
  const supabaseAuth = await createServerClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return <SessionGuardNotice />

  if (user.user_metadata['app_role'] !== 'provider') {
    return <Notice title="Provider signature required" message="Only a provider can sign prescriptions. Ask a provider at your clinic to sign from their dashboard." />
  }
  const clinicId = typeof user.user_metadata['clinic_id'] === 'string' ? user.user_metadata['clinic_id'] as string : undefined
  if (!clinicId) {
    return <SessionGuardNotice title="No clinic linked" message="Your account is not linked to a clinic. Contact your administrator." />
  }

  const supabase = createServiceClient()
  const me = await resolveCurrentProvider(supabase, { userId: user.id, clinicId })
  if (!me) {
    return <Notice title="Provider record not found" message="Your login is not linked to a provider in this clinic, so nothing can be signed. Contact your administrator." />
  }

  const requested = parseOrdersParam(params['orders'])
  if (requested.length === 0) {
    return <Notice title="No prescriptions selected" message="Choose drafts to sign from the Drafts tab on your dashboard." />
  }

  // The requested drafts establish which patients this page is about.
  const { data: requestedRows, error: requestedError } = await supabase
    .from('orders')
    .select('order_id, status, patient_id')
    .in('order_id', requested)
    .eq('clinic_id', clinicId)
    .eq('is_active', true)
    .is('deleted_at', null)
  if (requestedError) {
    console.error('[batch-sign page] requested drafts could not be read:', requestedError.message)
    return <Notice title="Drafts could not be loaded" message="This is an error, not an empty list. Reload the page to try again." />
  }
  const patientIds = [...new Set((requestedRows ?? []).filter(r => r.status === 'DRAFT').map(r => r.patient_id))]
  if (patientIds.length === 0) {
    return <Notice title="Nothing left to sign" message="These prescriptions are no longer drafts — they may already have been signed." />
  }

  // Every draft of those patients: mine are signable, others need Sign as me.
  const [linesRes, patientsRes, clinicRes] = await Promise.all([
    supabase
      .from('orders')
      .select(LINE_SELECT)
      .eq('clinic_id', clinicId)
      .in('patient_id', patientIds)
      .eq('status', 'DRAFT')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('created_at', { ascending: true }),
    supabase
      .from('patients')
      .select('patient_id, first_name, last_name, date_of_birth, phone, state')
      .in('patient_id', patientIds),
    supabase.from('clinics').select('absorb_shipping').eq('clinic_id', clinicId).maybeSingle(),
  ])
  if (linesRes.error || patientsRes.error || clinicRes.error) {
    console.error('[batch-sign page] load failed:', (linesRes.error ?? patientsRes.error ?? clinicRes.error)?.message)
    return <Notice title="Drafts could not be loaded" message="This is an error, not an empty list. Reload the page to try again." />
  }
  const rows = (linesRes.data ?? []) as unknown as LineRow[]

  const otherProviderIds = [...new Set(rows.filter(r => r.provider_id !== me.provider_id).map(r => r.provider_id))]
  const { data: otherProviders } = otherProviderIds.length
    ? await supabase.from('providers').select('provider_id, first_name, last_name').in('provider_id', otherProviderIds)
    : { data: [] as Array<{ provider_id: string; first_name: string; last_name: string }> }
  const providerName = new Map((otherProviders ?? []).map(p => [p.provider_id, `${p.first_name} ${p.last_name}`]))

  let rates: Awaited<ReturnType<typeof loadShippingRates>>
  try {
    rates = await loadShippingRates(supabase, rows.map(r => r.pharmacy_id ?? ''))
  } catch (err) {
    console.error('[batch-sign page] shipping rates could not be read:', err instanceof Error ? err.message : err)
    return <Notice title="Shipping could not be loaded" message="This is an error, not free shipping. Reload the page to try again." />
  }

  const patients: BatchPatientView[] = patientIds.map(pid => {
    const p = (patientsRes.data ?? []).find(x => x.patient_id === pid)
    const mine = rows.filter(r => r.patient_id === pid && r.provider_id === me.provider_id)
    const theirs = rows.filter(r => r.patient_id === pid && r.provider_id !== me.provider_id)
    const others = [...new Set(theirs.map(r => r.provider_id))].map(providerId => {
      const own = theirs.filter(r => r.provider_id === providerId)
      return { providerId, providerName: providerName.get(providerId) ?? 'another provider', anchorOrderId: own[0]!.order_id, count: own.length }
    })
    return {
      patientId: pid,
      firstName: p?.first_name ?? '',
      lastName:  p?.last_name ?? '',
      dob:       p?.date_of_birth ?? '',
      phone:     p?.phone ?? '',
      state:     p?.state ?? '',
      lines:     mine.map(toLine),
      others,
    }
  })

  // Pre-selected: the requested drafts that are mine to sign.
  const signable = new Set(patients.flatMap(p => p.lines.map(l => l.orderId)))
  const preselected = requested.filter(id => signable.has(id))

  return (
    <>
      <HipaaTimeout />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground">Review &amp; Sign Prescriptions</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            One signature signs every selected prescription. Each patient gets one payment link, with shipping charged once per pharmacy.
          </p>
        </div>
        <BatchSignForm
          patients={patients}
          preselected={preselected}
          signer={{ providerId: me.provider_id, name: `${me.first_name} ${me.last_name}`, npi: me.npi_number }}
          rates={[...rates.values()]}
          absorbShipping={(clinicRes.data as { absorb_shipping?: boolean } | null)?.absorb_shipping === true}
        />
      </main>
    </>
  )
}
