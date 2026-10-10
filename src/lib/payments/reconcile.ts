// ============================================================
// Daily Stripe reconciliation (read-only against Stripe)
// ============================================================
//
// Payment and Order Flow v1.1, build step 3. For one UTC day, Stripe's
// balance transactions on the platform account (charges, refunds and
// dispute adjustments) are matched by Stripe object id with the ledger's
// charge, refund and dispute lines. Each id's amounts are summed on both
// sides (a bundle has one charge and a line per member order).
//
// One reconciliation_runs row per run: matched, mismatch (with every
// differing id and both amounts) or error. A mismatch or an error alerts
// ops in Slack with the day, counts and Stripe IDs with amounts only:
// never patient data, never free text.
//
// The only Stripe call is balanceTransactions.list. Nothing is changed in
// Stripe or in the ledger.
//
// Known timing edge: the ledger side is the lines written during the day
// plus, for any Stripe id not found among them, that id's lines from any
// day. A line written just after midnight for a charge Stripe dated the
// day before is found for that day, but also shows as ledger-only on the
// next day's run. Such a mismatch clears on review; it is never silent.

import type Stripe from 'stripe'
import type { createServiceClient } from '@/lib/supabase/service'
import { buildOpsAlert, sendSlackAlert } from '@/lib/slack/client'

type Supabase = ReturnType<typeof createServiceClient>
type StripeReader = Pick<Stripe, 'balanceTransactions'>

export type ReconKind = 'charge' | 'refund' | 'dispute'

export interface ReconMismatch {
  stripe_object_id: string
  kind:             ReconKind
  ledger_cents:     number
  stripe_cents:     number
}

export interface ReconResult {
  status:        'matched' | 'mismatch' | 'error'
  mismatchCount: number
}

/** The day's bounds in Unix seconds: [gte, lt). */
export function dayBounds(day: string): { gte: number; lt: number } {
  const gte = Math.floor(Date.parse(`${day}T00:00:00.000Z`) / 1000)
  return { gte, lt: gte + 86400 }
}

/** What a balance transaction is, for the ledger; null for those the ledger does not record (fees, transfers, payouts). */
function kindOf(txn: { type: string; reporting_category?: string | null }): ReconKind | null {
  if (txn.type === 'charge' || txn.type === 'payment') return 'charge'
  if (txn.type === 'refund' || txn.type === 'payment_refund') return 'refund'
  if (txn.type === 'adjustment' && txn.reporting_category === 'dispute') return 'dispute'
  if (txn.reporting_category === 'dispute' || txn.reporting_category === 'dispute_reversal') return 'dispute'
  return null
}

const sourceId = (s: unknown): string | null =>
  typeof s === 'string' ? s : s && typeof s === 'object' && typeof (s as { id?: unknown }).id === 'string' ? (s as { id: string }).id : null

async function stripeTotals(stripe: StripeReader, day: string) {
  const created = dayBounds(day)
  const totals = new Map<string, { kind: ReconKind; cents: number }>()
  let count = 0
  let startingAfter: string | undefined
  for (let page = 0; page < 1000; page++) {
    const res = await stripe.balanceTransactions.list({ created, limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) })
    for (const txn of res.data) {
      const kind = kindOf(txn)
      const id = sourceId(txn.source)
      if (!kind || !id) continue
      count++
      const t = totals.get(id) ?? { kind, cents: 0 }
      t.cents += txn.amount
      totals.set(id, t)
    }
    if (!res.has_more || res.data.length === 0) break
    startingAfter = res.data[res.data.length - 1]!.id
  }
  return { totals, count }
}

const LEDGER_KINDS: ReconKind[] = ['charge', 'refund', 'dispute']

async function ledgerTotals(supabase: Supabase, day: string, stripeIds: string[]) {
  const { gte, lt } = dayBounds(day)
  const from = new Date(gte * 1000).toISOString()
  const to = new Date(lt * 1000).toISOString()
  const { data, error } = await supabase
    .from('ledger_entries')
    .select('entry_type, stripe_object_id, amount_cents')
    .in('entry_type', LEDGER_KINDS)
    .gte('created_at', from)
    .lt('created_at', to)
  if (error) throw new Error(`ledger_entries: ${error.message}`)
  const rows = (data ?? []) as Array<{ entry_type: string; stripe_object_id: string | null; amount_cents: number }>

  const seen = new Set(rows.map(r => r.stripe_object_id).filter((v): v is string => !!v))
  const missing = stripeIds.filter(id => !seen.has(id))
  if (missing.length > 0) {
    const { data: more, error: moreError } = await supabase
      .from('ledger_entries')
      .select('entry_type, stripe_object_id, amount_cents')
      .in('entry_type', LEDGER_KINDS)
      .in('stripe_object_id', missing)
    if (moreError) throw new Error(`ledger_entries: ${moreError.message}`)
    const wanted = new Set(missing)
    for (const r of (more ?? []) as typeof rows) if (r.stripe_object_id && wanted.has(r.stripe_object_id)) rows.push(r)
  }

  const totals = new Map<string, { kind: ReconKind; cents: number }>()
  for (const r of rows) {
    if (!r.stripe_object_id || !LEDGER_KINDS.includes(r.entry_type as ReconKind)) continue
    const t = totals.get(r.stripe_object_id) ?? { kind: r.entry_type as ReconKind, cents: 0 }
    t.cents += Number(r.amount_cents)
    totals.set(r.stripe_object_id, t)
  }
  return totals
}

/** Stripe IDs with both amounts, as one Slack token (at most 120 characters); the run row has the full list. */
function mismatchToken(mismatches: ReconMismatch[]): string {
  let out = ''
  for (const m of mismatches) {
    const next = `${out ? `${out},` : ''}${m.stripe_object_id}:${m.ledger_cents}/${m.stripe_cents}`
    if (next.length > 120) break
    out = next
  }
  return out
}

async function recordRun(supabase: Supabase, row: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from('reconciliation_runs').insert(row as never)
  if (error) console.error('[reconcile-stripe] run not recorded:', error.message)
}

async function alert(payload: Parameters<typeof buildOpsAlert>[0]): Promise<void> {
  try {
    await sendSlackAlert(buildOpsAlert(payload))
  } catch (err) {
    console.error('[reconcile-stripe] alert not sent:', err instanceof Error ? err.message : err)
  }
}

export async function reconcileDay(supabase: Supabase, stripe: StripeReader, day: string): Promise<ReconResult> {
  let stripeSide: Awaited<ReturnType<typeof stripeTotals>>
  let ledgerSide: Map<string, { kind: ReconKind; cents: number }>
  try {
    stripeSide = await stripeTotals(stripe, day)
    ledgerSide = await ledgerTotals(supabase, day, [...stripeSide.totals.keys()])
  } catch (err) {
    const error = (err instanceof Error ? err.message : String(err)).slice(0, 500)
    console.error(`[reconcile-stripe] ${day} could not be reconciled:`, error)
    await recordRun(supabase, { recon_date: day, status: 'error', mismatch_count: 0, details: [], error })
    await alert({ type: 'reconciliation_failed', details: { recon_date: day } })
    return { status: 'error', mismatchCount: 0 }
  }

  const mismatches: ReconMismatch[] = []
  for (const id of new Set([...stripeSide.totals.keys(), ...ledgerSide.keys()])) {
    const s = stripeSide.totals.get(id)
    const l = ledgerSide.get(id)
    const stripeCents = s?.cents ?? 0
    const ledgerCents = l?.cents ?? 0
    if (stripeCents !== ledgerCents) {
      mismatches.push({ stripe_object_id: id, kind: (s ?? l)!.kind, ledger_cents: ledgerCents, stripe_cents: stripeCents })
    }
  }

  const sum = (m: Map<string, { cents: number }>) => [...m.values()].reduce((a, t) => a + t.cents, 0)
  const ledgerTotal = sum(ledgerSide)
  const stripeTotal = sum(stripeSide.totals)
  const status = mismatches.length === 0 ? 'matched' : 'mismatch'
  await recordRun(supabase, {
    recon_date: day, status, ledger_cents: ledgerTotal, stripe_cents: stripeTotal,
    stripe_count: stripeSide.count, mismatch_count: mismatches.length, details: mismatches,
  })

  if (status === 'mismatch') {
    console.warn(`[reconcile-stripe] ${day}: ${mismatches.length} mismatch(es)`)
    await alert({
      type: 'reconciliation_mismatch',
      details: {
        recon_date: day, mismatch_count: mismatches.length, mismatches: mismatchToken(mismatches),
        ledger_total: ledgerTotal, stripe_total: stripeTotal, stripe_count: stripeSide.count,
      },
      notes: ['reconciliation_review'],
    })
  } else {
    console.info(`[reconcile-stripe] ${day}: matched (${stripeSide.count} Stripe transaction(s))`)
  }
  return { status, mismatchCount: mismatches.length }
}
