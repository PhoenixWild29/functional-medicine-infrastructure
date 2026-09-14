// ============================================================
// WO-102: write per-order shipping for a bundle (server)
// ============================================================
//
// The Review page sends one checkout link per order, so "once per
// pharmacy per bundle" has to be recorded on the orders before any link
// goes out: each pharmacy's fee sits on the first of its orders in the
// bundle and 0 on the rest (orders.shipping_fee). Computed here from the
// database — pharmacy rates, each order's shipping_type and wholesale —
// never from numbers the client sends.
//
// Only DRAFT orders are (re)allocated: once an order is signed its
// shipping is what the patient's link charges.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import {
  allocateShippingToOrders,
  computeBundleShipping,
  dollarsToCents,
  ratesFromPharmacyRow,
  type BundleShipping,
  type PharmacyShippingRates,
} from './shipping'

type ServiceClient = SupabaseClient<Database>

export const MAX_BUNDLE_ORDERS = 25

export type ApplyBundleShippingResult =
  | { ok: true; shipping: BundleShipping; feesByOrder: Record<string, number> }
  | { ok: false; status: 400 | 404 | 409 | 500; error: string }

/** Rates for a set of pharmacies, keyed by pharmacy id. */
export async function loadShippingRates(
  supabase: ServiceClient,
  pharmacyIds: ReadonlyArray<string>,
): Promise<Map<string, PharmacyShippingRates>> {
  const ids = [...new Set(pharmacyIds.filter(Boolean))]
  if (ids.length === 0) return new Map()
  const { data, error } = await supabase
    .from('pharmacies')
    .select('pharmacy_id, name, shipping_fee_standard, shipping_fee_cold_chain, free_shipping_threshold')
    .in('pharmacy_id', ids)
  if (error) throw new Error(`pharmacy shipping rates lookup failed: ${error.message}`)
  return new Map((data ?? []).map(r => [r.pharmacy_id, ratesFromPharmacyRow(r)]))
}

/**
 * Allocate shipping across `orderIds` (one bundle, in the given order) and
 * write orders.shipping_fee. All orders must be DRAFTs of `clinicId`.
 */
export async function applyBundleShipping(
  supabase: ServiceClient,
  clinicId: string,
  orderIds: ReadonlyArray<string>,
): Promise<ApplyBundleShippingResult> {
  try {
    return await allocate(supabase, clinicId, orderIds)
  } catch (err) {
    console.error('[bundle-shipping] allocation failed:', err instanceof Error ? err.message : err)
    return { ok: false, status: 500, error: 'Failed to allocate shipping' }
  }
}

async function allocate(
  supabase: ServiceClient,
  clinicId: string,
  orderIds: ReadonlyArray<string>,
): Promise<ApplyBundleShippingResult> {
  const ids = [...new Set(orderIds)]
  if (ids.length === 0) return { ok: false, status: 400, error: 'orderIds required' }
  if (ids.length > MAX_BUNDLE_ORDERS) return { ok: false, status: 400, error: `at most ${MAX_BUNDLE_ORDERS} orders per bundle` }

  const { data: rows, error } = await supabase
    .from('orders')
    .select('order_id, clinic_id, status, pharmacy_id, shipping_type, wholesale_price_snapshot, shipping_fee')
    .in('order_id', ids)
    .eq('clinic_id', clinicId)
    .eq('is_active', true)
    .is('deleted_at', null)
  if (error) {
    console.error('[bundle-shipping] order lookup failed:', error.message)
    return { ok: false, status: 500, error: 'Failed to load orders' }
  }
  const byId = new Map((rows ?? []).map(r => [r.order_id, r]))
  if (byId.size !== ids.length) return { ok: false, status: 404, error: 'Order not found' }
  if ([...byId.values()].some(r => r.status !== 'DRAFT')) {
    return { ok: false, status: 409, error: 'Shipping can only be allocated to draft orders' }
  }

  const orders = ids.map(id => {
    const r = byId.get(id)!
    return {
      orderId:        r.order_id,
      pharmacyId:     r.pharmacy_id ?? '',
      shippingType:   r.shipping_type,
      wholesaleCents: dollarsToCents(r.wholesale_price_snapshot),
      currentCents:   dollarsToCents(r.shipping_fee),
    }
  })

  let rates: Map<string, PharmacyShippingRates>
  try {
    rates = await loadShippingRates(supabase, orders.map(o => o.pharmacyId))
  } catch (err) {
    console.error('[bundle-shipping]', err instanceof Error ? err.message : err)
    return { ok: false, status: 500, error: 'Failed to load pharmacy shipping rates' }
  }

  const shipping = computeBundleShipping(orders, rates)
  const allocation = allocateShippingToOrders(orders, shipping)

  for (const o of orders) {
    const fee = allocation.get(o.orderId) ?? 0
    if (fee === o.currentCents) continue
    const { error: updateError } = await supabase
      .from('orders')
      .update({ shipping_fee: fee / 100 })
      .eq('order_id', o.orderId)
      .eq('status', 'DRAFT')
    if (updateError) {
      console.error('[bundle-shipping] shipping_fee update failed:', updateError.message)
      return { ok: false, status: 500, error: 'Failed to save shipping' }
    }
  }

  return { ok: true, shipping, feesByOrder: Object.fromEntries(allocation) }
}

/**
 * WO-98 draft lines: a patient's active DRAFTs under one provider are the
 * bundle a provider signs from the draft page. Re-allocate after a draft
 * line is added, edited (pharmacy / shipping type may change) or removed.
 * Non-fatal: shipping is re-derived again at the next change.
 */
export async function reallocateDraftSiblingShipping(
  supabase: ServiceClient,
  clinicId: string,
  patientId: string,
  providerId: string,
): Promise<void> {
  try {
    const { data, error } = await supabase
      .from('orders')
      .select('order_id')
      .eq('clinic_id', clinicId)
      .eq('patient_id', patientId)
      .eq('provider_id', providerId)
      .eq('status', 'DRAFT')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(MAX_BUNDLE_ORDERS)
    if (error) throw new Error(error.message)
    const ids = (data ?? []).map(r => r.order_id)
    if (ids.length === 0) return
    const result = await applyBundleShipping(supabase, clinicId, ids)
    if (!result.ok) console.warn('[bundle-shipping] draft sibling reallocation skipped:', result.error)
  } catch (err) {
    console.warn('[bundle-shipping] draft sibling reallocation failed (non-fatal):', err instanceof Error ? err.message : err)
  }
}
