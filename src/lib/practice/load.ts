// ============================================================
// Practice dashboard — reading the numbers (WO-107)
// ============================================================
//
// Each section is { ok: true, data } or { ok: false, error }. A query that
// fails is an error the page shows with Retry — never a zero, never an
// empty table (#156).

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import {
  breakdown,
  practiceTotals,
  type BreakdownRow,
  type Dimension,
  type Period,
  type PracticeGroupShipping,
  type PracticeOrder,
  type PracticeTotals,
} from './metrics'

type Supabase = SupabaseClient<Database>

export type Section<T> = { ok: true; data: T } | { ok: false; error: string }

export interface PracticeNumbers {
  totals:     PracticeTotals
  breakdowns: Record<Dimension, BreakdownRow[]>
}

const cents = (v: number | string | null | undefined) => Math.round(Number(v ?? 0) * 100)

export async function loadPracticeOrders(
  supabase: Supabase,
  clinicId: string,
  period: Pick<Period, 'from' | 'to'>,
): Promise<Section<{ orders: PracticeOrder[]; groups: PracticeGroupShipping[]; absorbShipping: boolean }>> {
  const [clinicRes, ordersRes] = await Promise.all([
    supabase.from('clinics').select('absorb_shipping').eq('clinic_id', clinicId).maybeSingle(),
    supabase
      .from('orders')
      .select(`order_id, status, created_at, retail_price_snapshot, wholesale_price_snapshot, shipping_fee,
        payment_group_id, provider_id, pharmacy_id, medication_snapshot, pharmacy_snapshot,
        providers ( first_name, last_name )`)
      .eq('clinic_id', clinicId)
      .is('deleted_at', null)
      .gte('created_at', period.from)
      .lt('created_at', period.to),
  ])
  if (clinicRes.error || !clinicRes.data) {
    console.error('[practice] clinic could not be read:', clinicRes.error?.message ?? 'not found')
    return { ok: false, error: 'The clinic record could not be read.' }
  }
  if (ordersRes.error) {
    console.error('[practice] orders could not be read:', ordersRes.error.message)
    return { ok: false, error: 'Orders could not be read.' }
  }

  const orders: PracticeOrder[] = (ordersRes.data ?? []).map(raw => {
    const o = raw as unknown as Record<string, unknown>
    const med = (o['medication_snapshot'] ?? {}) as Record<string, unknown>
    const ph = (o['pharmacy_snapshot'] ?? {}) as Record<string, unknown>
    const pr = (Array.isArray(o['providers']) ? (o['providers'] as unknown[])[0] : o['providers']) as { first_name?: string; last_name?: string } | null
    return {
      orderId:          o['order_id'] as string,
      status:           o['status'] as string,
      createdAt:        o['created_at'] as string,
      retailCents:      cents(o['retail_price_snapshot'] as number | null),
      wholesaleCents:   cents(o['wholesale_price_snapshot'] as number | null),
      shippingFeeCents: cents(o['shipping_fee'] as number | null),
      paymentGroupId:   (o['payment_group_id'] as string | null) ?? null,
      providerId:       (o['provider_id'] as string | null) ?? null,
      providerName:     pr ? `${pr.first_name ?? ''} ${pr.last_name ?? ''}`.trim() || 'Unknown provider' : 'Unknown provider',
      pharmacyId:       (o['pharmacy_id'] as string | null) ?? null,
      pharmacyName:     typeof ph['name'] === 'string' && ph['name'] ? ph['name'] : 'Unknown pharmacy',
      medicationName:   typeof med['medication_name'] === 'string' && med['medication_name'] ? med['medication_name'] : 'Unknown medication',
    }
  })

  const groupIds = [...new Set(orders.map(o => o.paymentGroupId).filter((g): g is string => !!g))]
  let groups: PracticeGroupShipping[] = []
  if (groupIds.length > 0) {
    const { data, error } = await supabase
      .from('payment_groups')
      .select('group_id, shipping_total')
      .in('group_id', groupIds)
    if (error) {
      console.error('[practice] payment groups could not be read:', error.message)
      return { ok: false, error: 'Payment groups (shipping per payment) could not be read.' }
    }
    groups = (data ?? []).map(g => ({ groupId: g.group_id, shippingTotalCents: cents(g.shipping_total as number | null) }))
  }

  return {
    ok: true,
    data: { orders, groups, absorbShipping: (clinicRes.data as { absorb_shipping?: boolean }).absorb_shipping === true },
  }
}

export async function loadPracticeNumbers(
  supabase: Supabase,
  clinicId: string,
  period: Pick<Period, 'from' | 'to'>,
): Promise<Section<PracticeNumbers>> {
  const read = await loadPracticeOrders(supabase, clinicId, period)
  if (!read.ok) return read
  const { orders, groups, absorbShipping } = read.data
  return {
    ok: true,
    data: {
      totals: practiceTotals(orders, groups, { absorbShipping }),
      breakdowns: {
        provider:   breakdown(orders, 'provider'),
        pharmacy:   breakdown(orders, 'pharmacy'),
        medication: breakdown(orders, 'medication'),
      },
    },
  }
}
