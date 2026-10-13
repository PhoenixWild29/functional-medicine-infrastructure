/**
 * @jest-environment node
 *
 * Backfill: paid orders with no ledger lines get them, from the same
 * snapshots, keyed 'backfill:<order_id>'. Dry run by default: counts
 * only, nothing written.
 *
 * Reconciliation (read-only against Stripe): for one UTC day, Stripe's
 * balance transactions (charges, refunds, dispute adjustments) are matched
 * by Stripe object id with the ledger's lines; a run row is recorded; any
 * mismatch alerts ops with IDs and amounts only.
 */

import { scriptedDb, type Script } from '@/__tests__/helpers/scripted-db'

const sendSlackAlertMock = jest.fn().mockResolvedValue(undefined)
jest.mock('@/lib/slack/client', () => ({
  ...jest.requireActual('@/lib/slack/client'),
  sendSlackAlert: (p: unknown) => sendSlackAlertMock(p),
}))
jest.spyOn(console, 'error').mockImplementation(() => {})
jest.spyOn(console, 'info').mockImplementation(() => {})
jest.spyOn(console, 'warn').mockImplementation(() => {})

import { backfillLedger } from '../backfill'
import { reconcileDay, dayBounds } from '../reconcile'

const CLINIC = 'c0000000-0000-4000-8000-000000000001'
const PHARM  = 'f0000000-0000-4000-8000-000000000001'
const O1 = 'a0000000-0000-4000-8000-000000000001'
const O2 = 'a0000000-0000-4000-8000-000000000002'
const order = (id: string, over: Record<string, unknown> = {}) => ({
  order_id: id, clinic_id: CLINIC, pharmacy_id: PHARM, payment_group_id: null, status: 'DELIVERED', stripe_payment_intent_id: `pi_${id.slice(-1)}`,
  retail_price_snapshot: 200, wholesale_price_snapshot: 100, shipping_fee: 9, ...over,
})

describe('backfillLedger', () => {
  function world(extra?: Script) {
    return scriptedDb(call => {
      const a = extra?.(call)
      if (a) return a
      if (call.table === 'orders' && call.op === 'select') return { data: call.single ? order(O1) : [order(O1), order(O2)] }
      if (call.table === 'ledger_entries' && call.op === 'select') return { data: [{ order_id: O2 }] }
      if (call.table === 'clinics') return { data: { clinic_id: CLINIC, absorb_shipping: false } }
      if (call.table === 'ledger_entries' && call.op === 'upsert') return { data: (call.payload as unknown[]).map(() => ({})) }
      return undefined
    })
  }

  it('is a dry run by default: it counts and writes nothing', async () => {
    const d = world()
    const res = await backfillLedger(d.client)
    expect(res).toEqual({ dryRun: true, paidOrders: 2, alreadyRecorded: 1, toBackfill: 1, written: 0, failed: 0 })
    expect(d.calls.filter(c => c.op !== 'select')).toEqual([])
  })

  it('with apply, writes lines keyed backfill:<order_id> for the missing orders only', async () => {
    const d = world()
    const res = await backfillLedger(d.client, { apply: true })
    expect(res).toEqual(expect.objectContaining({ dryRun: false, toBackfill: 1, written: 1, failed: 0 }))
    const ls = d.to('ledger_entries', 'upsert').flatMap(c => c.payload as Array<{ source_event_id: string; order_id: string }>)
    expect(ls.length).toBe(4)
    expect(ls.every(l => l.source_event_id === `backfill:${O1}` && l.order_id === O1)).toBe(true)
  })

  it('only looks at paid orders', async () => {
    const d = world()
    await backfillLedger(d.client)
    const [q] = d.to('orders', 'select')
    expect(q!.filters['status:in']).toEqual(expect.arrayContaining(['PAID_PROCESSING', 'SHIPPED', 'DELIVERED']))
    expect(q!.filters['status:in']).not.toContain('AWAITING_PAYMENT')
  })
})

describe('reconcileDay', () => {
  const DAY = '2026-10-09'

  function stripeWith(txns: Array<Record<string, unknown>>) {
    const list = jest.fn().mockResolvedValue({ data: txns, has_more: false })
    return { client: { balanceTransactions: { list } } as never, list }
  }
  function ledgerWith(rows: Array<Record<string, unknown>>) {
    return scriptedDb(call => {
      if (call.table === 'ledger_entries' && call.op === 'select') return { data: rows }
      return undefined
    })
  }

  beforeEach(() => sendSlackAlertMock.mockClear())

  it('reads the previous UTC day from Stripe, read-only', async () => {
    const s = stripeWith([])
    await reconcileDay(ledgerWith([]).client, s.client, DAY)
    const { gte, lt } = dayBounds(DAY)
    expect(s.list).toHaveBeenCalledWith(expect.objectContaining({ created: { gte, lt }, limit: 100 }))
    expect(lt - gte).toBe(86400)
  })

  it('a day that matches records a matched run and alerts nobody', async () => {
    const s = stripeWith([
      { id: 'txn_1', type: 'charge', source: 'ch_1', amount: 20900, reporting_category: 'charge' },
      { id: 'txn_2', type: 'refund', source: 're_1', amount: -5000, reporting_category: 'refund' },
    ])
    const d = ledgerWith([
      { entry_type: 'charge', stripe_object_id: 'ch_1', amount_cents: 12000 },
      { entry_type: 'charge', stripe_object_id: 'ch_1', amount_cents: 8900 },   // a bundle: two orders, one charge
      { entry_type: 'refund', stripe_object_id: 're_1', amount_cents: -5000 },
    ])
    const res = await reconcileDay(d.client, s.client, DAY)
    expect(res.status).toBe('matched')
    const [run] = d.to('reconciliation_runs', 'insert')
    expect(run!.payload).toEqual(expect.objectContaining({ recon_date: DAY, status: 'matched', mismatch_count: 0 }))
    expect(sendSlackAlertMock).not.toHaveBeenCalled()
  })

  it('a mismatch is recorded with IDs and amounts, and ops are alerted with IDs and amounts only', async () => {
    const s = stripeWith([
      { id: 'txn_1', type: 'charge', source: 'ch_1', amount: 20900, reporting_category: 'charge' },
      { id: 'txn_3', type: 'charge', source: 'ch_missing', amount: 15000, reporting_category: 'charge' },
      { id: 'txn_4', type: 'adjustment', source: 'du_1', amount: -20900, reporting_category: 'dispute' },
    ])
    const d = ledgerWith([
      { entry_type: 'charge', stripe_object_id: 'ch_1', amount_cents: 20000 },
      { entry_type: 'dispute', stripe_object_id: 'du_1', amount_cents: -20900 },
    ])
    const res = await reconcileDay(d.client, s.client, DAY)
    expect(res.status).toBe('mismatch')
    const run = d.to('reconciliation_runs', 'insert')[0]!.payload as Record<string, unknown>
    expect(run['mismatch_count']).toBe(2)
    expect(run['details']).toEqual(expect.arrayContaining([
      { stripe_object_id: 'ch_1', kind: 'charge', ledger_cents: 20000, stripe_cents: 20900 },
      { stripe_object_id: 'ch_missing', kind: 'charge', ledger_cents: 0, stripe_cents: 15000 },
    ]))
    expect(sendSlackAlertMock).toHaveBeenCalledTimes(1)
    const text = JSON.stringify(sendSlackAlertMock.mock.calls[0]![0])
    expect(text).toContain('ch_missing')
    expect(text).toContain(DAY)
    expect(text).not.toMatch(/patient|@/i)
  })

  it('Stripe that cannot be read records an error run and alerts', async () => {
    const list = jest.fn().mockRejectedValue(new Error('stripe down'))
    const d = ledgerWith([])
    const res = await reconcileDay(d.client, { balanceTransactions: { list } } as never, DAY)
    expect(res.status).toBe('error')
    expect((d.to('reconciliation_runs', 'insert')[0]!.payload as Record<string, unknown>)['status']).toBe('error')
    expect(sendSlackAlertMock).toHaveBeenCalledTimes(1)
  })
})
