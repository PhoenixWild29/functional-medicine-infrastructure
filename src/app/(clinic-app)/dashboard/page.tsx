// ============================================================
// Revenue & Order Dashboard — WO-30 + WO-31
// /dashboard
// ============================================================
//
// Server Component: fetches clinic data and orders (SSR initial data),
// then delegates interactive features to Client Components.
//
// WO-30 — REQ-CAD-004: Revenue dashboard (financial summaries).
// WO-31 — REQ-GDB-001: Filterable order table + Kanban toggle.
// WO-31 — REQ-GDB-002: Order detail slide-out drawer.
// WO-31 — REQ-GDB-003: "+ New Prescription" button with Stripe gate.
// WO-31 — REQ-GDB-004: Loading/empty/offline states.
// REQ-OAS-011: HIPAA 30-minute inactivity timeout.
//
// HC-01: All monetary arithmetic in integer cents.
//   retail_price_snapshot / wholesale_price_snapshot are NUMERIC(10,2)
//   (dollars) in the DB → converted with Math.round(n * 100).

import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { HipaaTimeout }      from '@/components/hipaa-timeout'
import { RevenueSummary }    from './_components/revenue-summary'
import { OrdersDashboard }   from './_components/orders-dashboard'
import type { OrderStatusEnum, StripeConnectStatusEnum } from '@/types/database.types'

export const metadata = {
  title: 'Dashboard',
}

// DashboardOrder: shared type used by all dashboard Client Components
export interface DashboardOrder {
  orderId:           string
  patientName:       string
  medicationName:    string
  status:            OrderStatusEnum
  submissionTier:    string | null    // from pharmacy_snapshot.integration_tier
  createdAt:         string
  updatedAt:         string
  retailCents:       number
  wholesaleCents:    number
  platformFeeCents:  number
  clinicPayoutCents: number
  isOverdue48h:      boolean          // AWAITING_PAYMENT + created > 48h ago
}

export default async function DashboardPage() {
  const supabaseAuth = await createServerClient()
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (!session) redirect('/login')

  const clinicId = typeof session.user.user_metadata['clinic_id'] === 'string'
    ? session.user.user_metadata['clinic_id'] as string
    : undefined

  if (!clinicId) redirect('/login')

  const supabase = createServiceClient()

  // MTD window: first day of current month 00:00:00 UTC
  const nowDate    = new Date()
  const mtdStart   = new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), 1)).toISOString()
  // Prior-year same-month window for trend comparison
  const pyStart    = new Date(Date.UTC(nowDate.getUTCFullYear() - 1, nowDate.getUTCMonth(), 1)).toISOString()
  const pyEnd      = new Date(Date.UTC(nowDate.getUTCFullYear() - 1, nowDate.getUTCMonth() + 1, 1)).toISOString()

  // Fetch clinic (for stripe status gate — REQ-GDB-003) + orders in parallel
  const [clinicResult, ordersResult, priorYearResult] = await Promise.all([
    supabase
      .from('clinics')
      .select('stripe_connect_status')
      .eq('clinic_id', clinicId)
      .is('deleted_at', null)
      .maybeSingle(),

    supabase
      .from('orders')
      .select(`
        order_id, status, created_at, updated_at,
        retail_price_snapshot, wholesale_price_snapshot,
        medication_snapshot, pharmacy_snapshot,
        patients!inner(first_name, last_name)
      `)
      .eq('clinic_id', clinicId)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false }),

    // Prior-year same month — count + revenue only (no joins needed)
    supabase
      .from('orders')
      .select('status, retail_price_snapshot, wholesale_price_snapshot')
      .eq('clinic_id', clinicId)
      .is('deleted_at', null)
      .gte('created_at', pyStart)
      .lt('created_at', pyEnd),
  ])

  const clinicData = clinicResult.data as { stripe_connect_status: string } | null
  if (!clinicData) redirect('/login')

  const stripeConnectStatus = clinicData.stripe_connect_status as StripeConnectStatusEnum

  // Build DashboardOrder rows with HC-01 integer-cent arithmetic
  const now = Date.now()

  const orders: DashboardOrder[] = (ordersResult.data ?? []).map(o => {
    const retailCents     = Math.round((o.retail_price_snapshot     ?? 0) * 100)
    const wholesaleCents  = Math.round((o.wholesale_price_snapshot  ?? 0) * 100)
    const marginCents     = Math.max(0, retailCents - wholesaleCents)
    const platformFeeCents = Math.round(marginCents * 15 / 100)
    const clinicPayoutCents = marginCents - platformFeeCents

    const snap = o.medication_snapshot as { medication_name?: string } | null
    const pharmacySnap = o.pharmacy_snapshot as { integration_tier?: string } | null
    const medicationName = snap?.medication_name ?? '—'
    const submissionTier = pharmacySnap?.integration_tier ?? null

    // patients!inner returns object for many-to-one (orders → patients)
    const patient = Array.isArray(o.patients)
      ? (o.patients as Array<{ first_name: string; last_name: string }>)[0]
      : o.patients as { first_name: string; last_name: string } | null
    const patientName = patient ? `${patient.last_name}, ${patient.first_name}` : '—'

    // BLK-04: PAYMENT_EXPIRED also counts as unpaid (patient didn't pay before link expired)
    const isOverdue48h =
      (o.status === 'AWAITING_PAYMENT' || o.status === 'PAYMENT_EXPIRED') &&
      new Date(o.created_at).getTime() < now - 48 * 60 * 60 * 1000

    return {
      orderId:           o.order_id,
      patientName,
      medicationName,
      status:            o.status as OrderStatusEnum,
      submissionTier,
      createdAt:         o.created_at,
      updatedAt:         o.updated_at,
      retailCents,
      wholesaleCents,
      platformFeeCents,
      clinicPayoutCents,
      isOverdue48h,
    }
  })

  // Exclude non-revenue statuses (HC-01)
  const EXCLUDED_FROM_REVENUE = new Set([
    'DRAFT', 'PAYMENT_EXPIRED', 'CANCELLED', 'REFUNDED', 'REFUND_PENDING',
  ])

  // MTD metrics (current month)
  const mtdOrders = orders.filter(o => o.createdAt >= mtdStart)
  let mtdRevenueCents = 0
  let mtdCompletedCount = 0
  let pendingPaymentCount = 0

  for (const o of mtdOrders) {
    if (!EXCLUDED_FROM_REVENUE.has(o.status)) mtdRevenueCents += o.retailCents
    if (o.status === 'DELIVERED') mtdCompletedCount++
    if (o.status === 'AWAITING_PAYMENT') pendingPaymentCount++
  }

  // Prior-year same month totals for trend
  const pyRows = priorYearResult.data ?? []
  let priorYearRevenueCents = 0
  let priorYearOrdersMtd    = 0
  for (const o of pyRows) {
    if (!EXCLUDED_FROM_REVENUE.has(o.status)) {
      priorYearRevenueCents += Math.round((o.retail_price_snapshot ?? 0) * 100)
      priorYearOrdersMtd++
    }
  }

  return (
    <>
      {/* REQ-OAS-011: HIPAA 30-minute inactivity timeout */}
      <HipaaTimeout />

      <main className="mx-auto max-w-6xl px-4 py-8 space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Revenue overview and order management for your clinic.
          </p>
        </div>

        {/* Metric cards — WO-71 */}
        <RevenueSummary
          totalOrdersMtd={mtdOrders.length}
          totalRevenueCents={mtdRevenueCents}
          pendingPaymentCount={pendingPaymentCount}
          completedMtd={mtdCompletedCount}
          priorYearOrdersMtd={priorYearOrdersMtd}
          priorYearRevenueCents={priorYearRevenueCents}
        />

        {/* Interactive order management — REQ-GDB-001/002/003/004 */}
        <OrdersDashboard
          initialOrders={orders}
          stripeConnectStatus={stripeConnectStatus}
          clinicId={clinicId}
        />
      </main>
    </>
  )
}
