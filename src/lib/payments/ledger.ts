// ============================================================
// Payments ledger: writing the money splits (record-only)
// ============================================================
//
// Payment and Order Flow v1.1, build step 2. Every paid order's split is
// recorded, one line per party and type, from the frozen wholesale /
// retail / shipping snapshots (computeOrderSplit, the same arithmetic as
// the destination charge):
//
//   charge           platform  + what the patient paid
//   clinic_transfer  clinic    + charge less the application fee
//   platform_fee     platform  + 15% of the margin
//   pharmacy_payable pharmacy  + wholesale + shipping, and a
//                                pharmacy_payables row ('owed')
//
// Refunds add a negative refund line and negative reversals per party;
// disputes add a negative dispute line. Every line is keyed by
// (source_event_id, line_key): the Stripe event id, or the refund id for
// refunds made through the API (no event of ours exists for those), so a
// redelivery or a retry writes nothing twice.
//
// Nothing here moves money or calls Stripe. A write that fails is logged
// and reported, never thrown: the ledger must never fail a webhook, a
// refund or fulfilment. Reconciliation (reconcile.ts) and the backfill
// (backfill.ts) catch what is missing.
//
// IDs and amounts only: no patient data in the ledger or in the logs.

import type { createServiceClient } from '@/lib/supabase/service'
import { computeOrderSplit, prorateRefund } from './split'

type Supabase = ReturnType<typeof createServiceClient>

export type LedgerResult = { ok: true; inserted: number } | { ok: false; error: string }

export type LedgerParty = 'platform' | 'clinic' | 'pharmacy'
export type LedgerEntryType = 'charge' | 'platform_fee' | 'clinic_transfer' | 'pharmacy_payable' | 'refund' | 'dispute' | 'reversal'

export interface LedgerLine {
  entry_type:       LedgerEntryType
  party:            LedgerParty
  amount_cents:     number
  currency:         string
  order_id:         string | null
  payment_group_id: string | null
  clinic_id:        string | null
  pharmacy_id:      string | null
  stripe_object_id: string | null
  status:           'succeeded' | 'pending' | 'open' | 'won' | 'lost' | 'failed'
  source_event_id:  string
  line_key:         string
}

/** The order columns the split needs. */
export const LEDGER_ORDER_COLUMNS =
  'order_id, clinic_id, pharmacy_id, payment_group_id, retail_price_snapshot, wholesale_price_snapshot, shipping_fee'

export interface LedgerOrder {
  order_id:                 string
  clinic_id:                string
  pharmacy_id:              string | null
  payment_group_id:         string | null
  retail_price_snapshot:    number | string | null
  wholesale_price_snapshot: number | string | null
  shipping_fee:             number | string | null
}

const lineKey = (type: LedgerEntryType, party: LedgerParty, orderId: string | null, groupId: string | null) =>
  `${type}:${party}:${orderId ?? `group:${groupId}`}`

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

function fail(where: string, err: unknown): LedgerResult {
  const error = message(err)
  console.error(`[payments-ledger] ${where} not recorded:`, error)
  return { ok: false, error }
}

/** Inserts lines; a line already recorded (same source and key) is skipped. Returns how many were new. */
async function insertLines(supabase: Supabase, lines: LedgerLine[]): Promise<number> {
  if (lines.length === 0) return 0
  const { data, error } = await supabase
    .from('ledger_entries')
    .upsert(lines, { onConflict: 'source_event_id,line_key', ignoreDuplicates: true })
    .select('entry_id')
  if (error) throw new Error(`ledger_entries: ${error.message}`)
  return (data ?? []).length
}

/** Whether each clinic absorbs shipping (it changes what the patient was charged). */
export async function loadAbsorbShipping(supabase: Supabase, clinicIds: string[]): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>()
  for (const clinicId of new Set(clinicIds)) {
    const { data, error } = await supabase
      .from('clinics')
      .select('clinic_id, absorb_shipping')
      .eq('clinic_id', clinicId)
      .maybeSingle()
    if (error) throw new Error(`clinics: ${error.message}`)
    out.set(clinicId, data?.absorb_shipping === true)
  }
  return out
}

export interface PaymentLinesInput {
  orders:          LedgerOrder[]
  absorbByClinic:  Map<string, boolean>
  eventId:         string
  /** The Stripe charge; the PaymentIntent id when the charge is not known. */
  stripeObjectId:  string | null
  currency:        string
  paymentGroupId:  string | null
}

/**
 * The payment lines and owed payables for orders already loaded. Shared by
 * the webhook writer and the backfill. Throws on a failed write.
 */
export async function writePaymentLines(supabase: Supabase, input: PaymentLinesInput): Promise<number> {
  const lines: LedgerLine[] = []
  const payables: Array<Record<string, unknown>> = []
  for (const order of input.orders) {
    const split = computeOrderSplit(order, input.absorbByClinic.get(order.clinic_id))
    const groupId = input.paymentGroupId ?? order.payment_group_id ?? null
    const base = {
      currency: input.currency, order_id: order.order_id, payment_group_id: groupId,
      clinic_id: order.clinic_id, pharmacy_id: order.pharmacy_id, status: 'succeeded' as const,
      source_event_id: input.eventId,
    }
    const add = (entry_type: LedgerEntryType, party: LedgerParty, amount_cents: number, stripe_object_id: string | null) =>
      lines.push({ ...base, entry_type, party, amount_cents, stripe_object_id, line_key: lineKey(entry_type, party, order.order_id, groupId) })
    add('charge', 'platform', split.chargeCents, input.stripeObjectId)
    add('clinic_transfer', 'clinic', split.clinicTransferCents, input.stripeObjectId)
    add('platform_fee', 'platform', split.platformFeeCents, input.stripeObjectId)
    add('pharmacy_payable', 'pharmacy', split.pharmacyPayableCents, input.stripeObjectId)
    if (order.pharmacy_id) {
      payables.push({
        order_id: order.order_id, payment_group_id: groupId, pharmacy_id: order.pharmacy_id, clinic_id: order.clinic_id,
        wholesale_cents: split.wholesaleCents, shipping_cents: split.shippingCents, amount_cents: split.pharmacyPayableCents,
        currency: input.currency, status: 'owed',
      })
    }
  }

  const inserted = await insertLines(supabase, lines)
  if (payables.length > 0) {
    // One payable per order; a redelivery leaves the existing row (and its status) alone.
    const { error } = await supabase
      .from('pharmacy_payables')
      .upsert(payables as never, { onConflict: 'order_id', ignoreDuplicates: true })
    if (error) throw new Error(`pharmacy_payables: ${error.message}`)
  }
  return inserted
}

export interface PaymentLedgerInput {
  eventId:         string
  paymentIntentId: string
  chargeId:        string | null
  currency:        string
  orderIds:        string[]
  paymentGroupId:  string | null
}

/** payment_intent.succeeded: the paid orders' lines (a bundle: every member). */
export async function recordPaymentLedger(supabase: Supabase, input: PaymentLedgerInput): Promise<LedgerResult> {
  try {
    if (input.orderIds.length === 0) return { ok: true, inserted: 0 }
    const { data, error } = await supabase
      .from('orders')
      .select(LEDGER_ORDER_COLUMNS)
      .in('order_id', input.orderIds)
    if (error) throw new Error(`orders: ${error.message}`)
    const orders = (data ?? []) as unknown as LedgerOrder[]
    if (orders.length === 0) throw new Error('no orders found for the payment')
    const absorbByClinic = await loadAbsorbShipping(supabase, orders.map(o => o.clinic_id))
    const inserted = await writePaymentLines(supabase, {
      orders, absorbByClinic, eventId: input.eventId, stripeObjectId: input.chargeId ?? input.paymentIntentId,
      currency: input.currency, paymentGroupId: input.paymentGroupId,
    })
    return { ok: true, inserted }
  } catch (err) {
    return fail(`payment ${input.paymentIntentId}`, err)
  }
}

export interface RefundLedgerInput {
  orderId:     string
  refundId:    string
  /** null = a full refund of the order. */
  amountCents: number | null
  currency:    string
}

/**
 * A refund Stripe confirmed: a negative refund line and the reversals
 * (Stripe reverses the clinic's transfer and refunds the application fee
 * in proportion). The pharmacy's reversal comes off its payable while it
 * is unpaid; a full reversal voids it.
 */
export async function recordRefundLedger(supabase: Supabase, input: RefundLedgerInput): Promise<LedgerResult> {
  try {
    const { data: order, error } = await supabase
      .from('orders')
      .select(LEDGER_ORDER_COLUMNS)
      .eq('order_id', input.orderId)
      .maybeSingle()
    if (error) throw new Error(`orders: ${error.message}`)
    if (!order) throw new Error('order not found')
    const o = order as unknown as LedgerOrder
    const absorb = await loadAbsorbShipping(supabase, [o.clinic_id])
    const split = computeOrderSplit(o, absorb.get(o.clinic_id))
    const refundCents = input.amountCents ?? split.chargeCents
    const parts = prorateRefund(split, refundCents)

    const base = {
      currency: input.currency, order_id: o.order_id, payment_group_id: o.payment_group_id,
      clinic_id: o.clinic_id, pharmacy_id: o.pharmacy_id, status: 'succeeded' as const,
      stripe_object_id: input.refundId, source_event_id: input.refundId,
    }
    const line = (entry_type: LedgerEntryType, party: LedgerParty, amount_cents: number): LedgerLine =>
      ({ ...base, entry_type, party, amount_cents, line_key: lineKey(entry_type, party, o.order_id, o.payment_group_id) })
    const inserted = await insertLines(supabase, [
      line('refund', 'platform', -refundCents),
      line('reversal', 'clinic', -parts.clinic),
      line('reversal', 'platform', -parts.platform),
      line('reversal', 'pharmacy', -parts.pharmacy),
    ])
    // Already recorded (a retry of the same refund): the payable was adjusted then.
    if (inserted === 0) return { ok: true, inserted }

    const { data: payable, error: payableError } = await supabase
      .from('pharmacy_payables')
      .select('payable_id, amount_cents, reversed_cents, status')
      .eq('order_id', o.order_id)
      .maybeSingle()
    if (payableError) throw new Error(`pharmacy_payables: ${payableError.message}`)
    if (payable && (payable.status === 'owed' || payable.status === 'scheduled') && parts.pharmacy > 0) {
      const reversed = Math.min(Number(payable.amount_cents), Number(payable.reversed_cents) + parts.pharmacy)
      const patch: Record<string, unknown> = { reversed_cents: reversed, updated_at: new Date().toISOString() }
      if (reversed >= Number(payable.amount_cents)) patch['status'] = 'void'
      const { error: updateError } = await supabase
        .from('pharmacy_payables')
        .update(patch as never)
        .eq('order_id', o.order_id)
        .in('status', ['owed', 'scheduled'])
      if (updateError) throw new Error(`pharmacy_payables: ${updateError.message}`)
    }
    return { ok: true, inserted }
  } catch (err) {
    return fail(`refund ${input.refundId}`, err)
  }
}

export interface DisputeLedgerInput {
  eventId:        string
  disputeId:      string
  amountCents:    number
  currency:       string
  status:         string
  orderId:        string | null
  paymentGroupId: string | null
  clinicId:       string | null
}

/** charge.dispute.created: the disputed amount, an open negative platform line. */
export async function recordDisputeLedger(supabase: Supabase, input: DisputeLedgerInput): Promise<LedgerResult> {
  try {
    if (!input.orderId && !input.paymentGroupId) throw new Error('dispute has no order or payment group')
    const inserted = await insertLines(supabase, [{
      entry_type: 'dispute', party: 'platform', amount_cents: -Math.abs(input.amountCents), currency: input.currency,
      order_id: input.orderId, payment_group_id: input.paymentGroupId, clinic_id: input.clinicId, pharmacy_id: null,
      stripe_object_id: input.disputeId, status: 'open', source_event_id: input.eventId,
      line_key: lineKey('dispute', 'platform', input.orderId, input.paymentGroupId),
    }])
    return { ok: true, inserted }
  } catch (err) {
    return fail(`dispute ${input.disputeId}`, err)
  }
}

export interface LatePaymentLedgerInput {
  eventId:         string
  paymentIntentId: string
  chargeId:        string | null
  amountCents:     number
  currency:        string
  paymentGroupId:  string
  clinicId:        string | null
  /** The automatic full refund; null when it could not be made. */
  refundId:        string | null
}

/** A payment on a bundle that had already expired: the charge and its automatic full refund, on the group. */
export async function recordLatePaymentLedger(supabase: Supabase, input: LatePaymentLedgerInput): Promise<LedgerResult> {
  try {
    const base = {
      currency: input.currency, order_id: null, payment_group_id: input.paymentGroupId, clinic_id: input.clinicId,
      pharmacy_id: null, status: 'succeeded' as const, source_event_id: input.eventId,
    }
    const lines: LedgerLine[] = [{
      ...base, entry_type: 'charge', party: 'platform', amount_cents: input.amountCents,
      stripe_object_id: input.chargeId ?? input.paymentIntentId, line_key: lineKey('charge', 'platform', null, input.paymentGroupId),
    }]
    if (input.refundId) {
      lines.push({
        ...base, entry_type: 'refund', party: 'platform', amount_cents: -input.amountCents,
        stripe_object_id: input.refundId, line_key: lineKey('refund', 'platform', null, input.paymentGroupId),
      })
    }
    return { ok: true, inserted: await insertLines(supabase, lines) }
  } catch (err) {
    return fail(`late payment ${input.paymentIntentId}`, err)
  }
}
