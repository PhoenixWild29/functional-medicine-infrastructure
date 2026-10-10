// ============================================================
// Which orders a PaymentIntent paid for (group first, then solo)
// ============================================================
//
// A bundle's PaymentIntent is on payment_groups and, once it is paid, on
// every member order too (orders.stripe_payment_intent_id is stamped at
// payment_intent.succeeded). A single order's is on the order alone. So a
// lookup by PaymentIntent checks the GROUP first: an order lookup alone
// would find several member orders, and a .maybeSingle() over them errors.
//
// The metadata group id, when Stripe sent it, is cross-checked: a group
// whose recorded PaymentIntent is a different one is not this payment.
//
// A database error THROWS (the route answers 500 and Stripe redelivers);
// nothing found returns null.

import type { createServiceClient } from '@/lib/supabase/service'

type Supabase = ReturnType<typeof createServiceClient>

export interface PaidOrderRow {
  order_id:                 string
  status:                   string
  payment_group_id:         string | null
  stripe_payment_intent_id: string | null
  retail_price_snapshot:    number | null
}

export type PaymentTarget =
  | { kind: 'group'; groupId: string; groupStatus: string; orders: PaidOrderRow[] }
  | { kind: 'solo';  orders: [PaidOrderRow] }

const ORDER_COLUMNS = 'order_id, status, payment_group_id, stripe_payment_intent_id, retail_price_snapshot'

export async function resolvePaymentTarget(
  supabase: Supabase,
  paymentIntentId: string,
  metadataGroupId: string | null,
): Promise<PaymentTarget | null> {
  type GroupRow = { group_id: string; status: string; stripe_payment_intent_id: string | null }
  let group: GroupRow | null = null

  if (metadataGroupId) {
    const { data, error } = await supabase
      .from('payment_groups')
      .select('group_id, status, stripe_payment_intent_id')
      .eq('group_id', metadataGroupId)
      .maybeSingle()
    if (error) throw new Error(`payment group ${metadataGroupId} lookup failed: ${error.message}`)
    const row = data as GroupRow | null
    if (row && (row.stripe_payment_intent_id == null || row.stripe_payment_intent_id === paymentIntentId)) group = row
  }

  if (!group) {
    const { data, error } = await supabase
      .from('payment_groups')
      .select('group_id, status, stripe_payment_intent_id')
      .eq('stripe_payment_intent_id', paymentIntentId)
      .maybeSingle()
    if (error) throw new Error(`payment group lookup by PaymentIntent ${paymentIntentId} failed: ${error.message}`)
    group = data as GroupRow | null
  }

  if (group) {
    const { data, error } = await supabase
      .from('orders')
      .select(ORDER_COLUMNS)
      .eq('payment_group_id', group.group_id)
      .is('deleted_at', null)
    if (error) throw new Error(`payment group ${group.group_id} members could not be loaded: ${error.message}`)
    return { kind: 'group', groupId: group.group_id, groupStatus: group.status, orders: (data ?? []) as PaidOrderRow[] }
  }

  const { data, error } = await supabase
    .from('orders')
    .select(ORDER_COLUMNS)
    .eq('stripe_payment_intent_id', paymentIntentId)
    .is('payment_group_id', null)
    .maybeSingle()
  if (error) throw new Error(`order lookup by PaymentIntent ${paymentIntentId} failed: ${error.message}`)
  return data ? { kind: 'solo', orders: [data as PaidOrderRow] } : null
}
