// ============================================================
// Pharmacy payables: what each pharmacy is owed (record-only)
// ============================================================
//
// One pharmacy_payables row per paid order: wholesale + shipping, less
// any refund reversed against it while unpaid. Ops schedule and mark them
// paid on /ops/payables, with a reference and a date; every change is
// logged in payable_events. Marking a payable paid records a payment ops
// made outside this system: nothing here moves money.
//
// IDs and amounts only: no patient data.

import type { createServiceClient } from '@/lib/supabase/service'

type Supabase = ReturnType<typeof createServiceClient>

export type PayableStatus = 'owed' | 'scheduled' | 'paid' | 'void'

export interface PayableLine {
  payableId:      string
  orderId:        string
  orderNumber:    string | null
  paymentGroupId: string | null
  status:         PayableStatus
  wholesaleCents: number
  shippingCents:  number
  reversedCents:  number
  /** Wholesale + shipping, less reversals. */
  netCents:       number
  paidOn:         string | null
  paidReference:  string | null
  createdAt:      string
}

export interface PharmacyPayables {
  pharmacyId:     string
  name:           string
  owedCents:      number
  scheduledCents: number
  paidCents:      number
  lines:          PayableLine[]
}

export interface PayablesView {
  pharmacies: PharmacyPayables[]
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A real calendar date, YYYY-MM-DD. */
export function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const d = new Date(`${v}T00:00:00.000Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

export const PAYABLE_COLUMNS =
  'payable_id, pharmacy_id, order_id, payment_group_id, status, wholesale_cents, shipping_cents, amount_cents, reversed_cents, paid_on, paid_reference, created_at'

interface PayableRow {
  payable_id:       string
  pharmacy_id:      string
  order_id:         string
  payment_group_id: string | null
  status:           PayableStatus
  wholesale_cents:  number
  shipping_cents:   number
  amount_cents:     number
  reversed_cents:   number
  paid_on:          string | null
  paid_reference:   string | null
  created_at:       string
  orders?:          { order_number: string | null } | null
  pharmacies?:      { name: string | null } | null
}

export function toLine(r: PayableRow): PayableLine {
  return {
    payableId: r.payable_id, orderId: r.order_id, orderNumber: r.orders?.order_number ?? null,
    paymentGroupId: r.payment_group_id, status: r.status,
    wholesaleCents: Number(r.wholesale_cents), shippingCents: Number(r.shipping_cents), reversedCents: Number(r.reversed_cents),
    netCents: Number(r.amount_cents) - Number(r.reversed_cents),
    paidOn: r.paid_on, paidReference: r.paid_reference, createdAt: r.created_at,
  }
}

/** Every payable, grouped by pharmacy, with totals. Throws when they cannot be read. */
export async function loadPayables(supabase: Supabase): Promise<PayablesView> {
  const { data, error } = await supabase
    .from('pharmacy_payables')
    .select(`${PAYABLE_COLUMNS}, orders(order_number), pharmacies(name)`)
    .order('created_at', { ascending: true })
    .limit(5000)
  if (error) throw new Error(`pharmacy_payables: ${error.message}`)

  const byPharmacy = new Map<string, PharmacyPayables>()
  for (const r of (data ?? []) as unknown as PayableRow[]) {
    const p = byPharmacy.get(r.pharmacy_id) ?? {
      pharmacyId: r.pharmacy_id, name: r.pharmacies?.name ?? r.pharmacy_id, owedCents: 0, scheduledCents: 0, paidCents: 0, lines: [],
    }
    const line = toLine(r)
    if (line.status === 'owed') p.owedCents += line.netCents
    if (line.status === 'scheduled') p.scheduledCents += line.netCents
    if (line.status === 'paid') p.paidCents += line.netCents
    p.lines.push(line)
    byPharmacy.set(r.pharmacy_id, p)
  }
  return { pharmacies: [...byPharmacy.values()].sort((a, b) => a.name.localeCompare(b.name)) }
}

export const formatCents = (c: number) =>
  (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
