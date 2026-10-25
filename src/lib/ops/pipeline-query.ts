// ============================================================
// Ops pipeline orders query — WO-33, REQ-OPV-002 / 003
// ============================================================
//
// One query for the page's first render and the API route's polls, so
// the two cannot filter differently.
//
// Tier: PostgREST filters the parent rows on an embedded column only
// when the embed is inner (pharmacies!inner); with a plain embed,
// .eq('pharmacies.integration_tier', …) only blanks the pharmacy on the
// other rows and every order still comes back. The inner embed is used
// only when a tier is chosen, so orders with no pharmacy yet still list
// without one.

import type { createServiceClient } from '@/lib/supabase/service'
import type { OrderStatusEnum, IntegrationTierEnum } from '@/types/database.types'
import type { PipelineOrder } from '@/types/pipeline'
import { slaSortComparator } from '@/lib/ops/sla-sort'
import { deadlinePassed } from '@/lib/sla/deadline'
import { dateFromBound, dateToBound, type PipelineFilters } from '@/lib/ops/pipeline-filters'

type ServiceClient = ReturnType<typeof createServiceClient>

/** Rows per load; the most recently updated orders that match. */
export const PIPELINE_ROW_LIMIT = 500

const ORDER_COLUMNS = `
  order_id, order_number, status, clinic_id, pharmacy_id,
  submission_tier, reroute_count, tracking_number, carrier,
  stripe_payment_intent_id, created_at, updated_at, ops_assignee,
  clinics(name)`

interface PipelineOrderRow {
  order_id:                 string
  order_number:             string | null
  status:                   OrderStatusEnum
  clinic_id:                string
  pharmacy_id:              string | null
  submission_tier:          IntegrationTierEnum | null
  reroute_count:            number | null
  tracking_number:          string | null
  carrier:                  string | null
  stripe_payment_intent_id: string | null
  created_at:               string
  updated_at:               string
  ops_assignee:             string | null
  clinics:                  { name: string } | null
  pharmacies:               { name: string; integration_tier: IntegrationTierEnum | null } | null
}

export type PipelineOrdersResult =
  | { orders: PipelineOrder[]; error: null }
  | { orders: null; error: string }

export async function fetchPipelineOrders(
  supabase: ServiceClient,
  filters:  PipelineFilters,
  nowMs:    number,
): Promise<PipelineOrdersResult> {
  const pharmacyEmbed = filters.tier
    ? 'pharmacies!inner(name, integration_tier)'
    : 'pharmacies(name, integration_tier)'

  let query = supabase
    .from('orders')
    .select(`${ORDER_COLUMNS}, ${pharmacyEmbed}`)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(PIPELINE_ROW_LIMIT)

  if (filters.clinicId)        query = query.eq('clinic_id',   filters.clinicId)
  if (filters.pharmacyId)      query = query.eq('pharmacy_id', filters.pharmacyId)
  if (filters.tier)            query = query.eq('pharmacies.integration_tier', filters.tier)
  if (filters.statuses.length) query = query.in('status', filters.statuses)
  if (filters.dateFrom)        query = query.gte('created_at', dateFromBound(filters.dateFrom))
  if (filters.dateTo)          query = query.lt('created_at',  dateToBound(filters.dateTo))

  const [ordersResult, slasResult] = await Promise.all([
    query,
    // Active unresolved SLA deadlines, earliest first: the first one seen
    // per order is its nearest.
    supabase
      .from('order_sla_deadlines')
      .select('order_id, deadline_at, resolved_at')
      .is('resolved_at', null)
      .eq('is_active', true)
      .order('deadline_at', { ascending: true }),
  ])

  if (ordersResult.error) return { orders: null, error: ordersResult.error.message }
  // Without the deadlines every order would read as on time: an error, not
  // a pipeline with no breaches.
  if (slasResult.error) return { orders: null, error: `SLA deadlines: ${slasResult.error.message}` }

  const slaMap = new Map<string, { nearestDeadline: string; hasBreach: boolean }>()
  for (const sla of (slasResult.data ?? [])) {
    const isBreached = deadlinePassed(sla.deadline_at, nowMs)
    const existing   = slaMap.get(sla.order_id)
    slaMap.set(sla.order_id, existing
      ? { nearestDeadline: existing.nearestDeadline, hasBreach: existing.hasBreach || isBreached }
      : { nearestDeadline: sla.deadline_at, hasBreach: isBreached })
  }

  const rows = (ordersResult.data ?? []) as unknown as PipelineOrderRow[]
  const orders: PipelineOrder[] = rows.map(o => {
    const sla = slaMap.get(o.order_id)
    return {
      orderId:               o.order_id,
      orderNumber:           o.order_number ?? null,
      status:                o.status,
      clinicId:              o.clinic_id,
      clinicName:            o.clinics?.name ?? '—',
      pharmacyId:            o.pharmacy_id ?? null,
      pharmacyName:          o.pharmacies?.name ?? null,
      pharmacyTier:          o.pharmacies?.integration_tier ?? null,
      submissionTier:        o.submission_tier ?? null,
      rerouteCount:          o.reroute_count ?? 0,
      trackingNumber:        o.tracking_number ?? null,
      carrier:               o.carrier ?? null,
      stripePaymentIntentId: o.stripe_payment_intent_id ?? null,
      createdAt:             o.created_at,
      updatedAt:             o.updated_at,
      opsAssignee:           o.ops_assignee ?? null,
      nearestSlaDeadline:    sla?.nearestDeadline ?? null,
      hasSlaBreached:        sla?.hasBreach ?? false,
    }
  })

  // REQ-OPV-003: breached first, then nearest deadline, then most recently updated
  orders.sort(slaSortComparator)
  return { orders, error: null }
}
