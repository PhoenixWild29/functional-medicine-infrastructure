/**
 * @jest-environment node
 *
 * charge.refunded writes the payments ledger through the real hook
 * (lib/payments/ledger-hook), keyed on the refund id:
 *   - a refund made in the Stripe Dashboard writes the refund and its
 *     reversals (and takes the pharmacy's share off its unpaid payable);
 *   - a Dashboard refund on a bundle is spread over the members;
 *   - a refund our API path already recorded (ops Cancel + Refund, the
 *     refund-retry cron) is written once when the webhook arrives after
 *     it, and the payable is adjusted once;
 *   - a ledger that fails, or throws, never fails the webhook sync.
 * Stripe and the database are mocked.
 */

import type Stripe from 'stripe'
import { scriptedDb, type ScriptedCall } from '@/__tests__/helpers/scripted-db'

let db: ReturnType<typeof scriptedDb>
let serviceThrows = false
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
    if (serviceThrows) throw new Error('no service client')
    return db.client
  },
}))

import { handleChargeRefunded } from '../handle-charge-refunded'
import { recordRefundInLedger } from '@/lib/payments/ledger-hook'
import { recordRefundLedger } from '@/lib/payments/ledger'

const CLINIC = 'c0000000-0000-4000-8000-000000000001'
const PHARM  = 'f0000000-0000-4000-8000-000000000001'
const GROUP  = 'a5000000-0000-4000-8000-000000000001'

type Order = { order_id: string; status: string; payment_group_id: string | null; retail_price_snapshot: number; wholesale_price_snapshot: number; shipping_fee: number }
type Row = { order_id: string; new_status?: string; metadata: Record<string, unknown> | null }

interface World { orders: Order[]; group?: boolean; ledgerDown?: boolean; payableStatus?: string }

function world(w: World) {
  const history: Row[] = []
  const ledgerKeys = new Set<string>()
  const ledgerRows: Array<Record<string, unknown>> = []
  db = scriptedDb((c: ScriptedCall) => {
    if (c.table === 'payment_groups') return { data: w.group ? { group_id: GROUP, status: 'PAID', stripe_payment_intent_id: 'pi_1' } : null }
    if (c.table === 'orders') {
      const rows = w.orders.map(o => ({ clinic_id: CLINIC, pharmacy_id: PHARM, stripe_payment_intent_id: 'pi_1', ...o }))
      const wanted = c.filters['order_id'] ?? null
      const pick = wanted ? rows.filter(r => r.order_id === wanted) : rows
      return { data: c.single ? pick[0] ?? null : pick }
    }
    if (c.table === 'clinics') return { data: { clinic_id: CLINIC, absorb_shipping: false } }
    if (c.table === 'order_status_history' && c.op === 'insert') { history.push(...(c.payload as Row[])); return { data: null } }
    if (c.table === 'order_status_history') {
      const contains = (c.filters['metadata:contains'] ?? {}) as Record<string, unknown>
      const found = history.filter(r => Object.entries(contains).every(([k, v]) => r.metadata?.[k] === v))
      return { data: c.single ? found[0] ?? null : found }
    }
    if (c.table === 'ledger_entries' && c.op === 'upsert') {
      if (w.ledgerDown) return { error: { message: 'ledger down' } }
      const fresh = (c.payload as Array<Record<string, unknown>>).filter(l => {
        const key = `${l['source_event_id']}|${l['line_key']}`
        if (ledgerKeys.has(key)) return false
        ledgerKeys.add(key)
        return true
      })
      ledgerRows.push(...fresh)
      return { data: fresh.map((_, i) => ({ entry_id: `e${ledgerRows.length + i}` })) }
    }
    if (c.table === 'pharmacy_payables' && c.op === 'select') {
      return { data: { payable_id: 'p1', amount_cents: 10900, reversed_cents: 0, status: w.payableStatus ?? 'owed' } }
    }
    return undefined
  })
  return { history, ledgerRows }
}

const order = (id: string, over: Partial<Order> = {}): Order => ({
  order_id: id, status: 'DELIVERED', payment_group_id: null, retail_price_snapshot: 200, wholesale_price_snapshot: 100, shipping_fee: 9, ...over,
})
const charge = (over: Partial<Stripe.Charge> = {}) => ({
  id: 'ch_1', payment_intent: 'pi_1', amount: 20900, amount_refunded: 20900, refunded: true,
  transfer: 'tr_1', application_fee: 'fee_1', metadata: { platform: '8090ai' }, ...over,
}) as unknown as Stripe.Charge
const refund = (over: Partial<Stripe.Refund> = {}) =>
  ({ id: 're_dash', amount: 20900, currency: 'usd', status: 'succeeded', transfer_reversal: null, ...over }) as unknown as Stripe.Refund

function stripeMock(refunds: Stripe.Refund[]) {
  return {
    refunds:         { list: jest.fn().mockResolvedValue({ data: refunds }) },
    transfers:       { retrieve: jest.fn().mockResolvedValue({ amount: 8500, amount_reversed: 0 }), createReversal: jest.fn().mockResolvedValue({ id: 'trr_1' }) },
    applicationFees: { retrieve: jest.fn().mockResolvedValue({ amount: 12400, amount_refunded: 0 }), createRefund: jest.fn().mockResolvedValue({ id: 'fr_1' }) },
  }
}

const run = (stripe: ReturnType<typeof stripeMock>, ch = charge(), eventId = 'evt_ref_1') =>
  handleChargeRefunded(ch, eventId, {
    supabase: db.client as never, stripe: stripe as never,
    casTransition: jest.fn().mockResolvedValue({ success: true, wasAlreadyTransitioned: false }) as never,
    sendSlackAlert: jest.fn().mockResolvedValue(undefined), buildStripePaymentAlert: ((p: unknown) => p) as never,
    recordRefundInLedger,
  })

const sum = (rows: Array<Record<string, unknown>>) => rows.reduce((a, r) => a + Number(r['amount_cents']), 0)
const payableUpdates = () => db.to('pharmacy_payables', 'update')

beforeEach(() => {
  serviceThrows = false
  for (const l of ['info', 'warn', 'error'] as const) jest.spyOn(console, l).mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe('a refund made in the Stripe Dashboard', () => {
  it('writes the refund and its reversals, keyed on the refund id, and takes the pharmacy share off the payable', async () => {
    const { ledgerRows } = world({ orders: [order('o-1')] })
    await run(stripeMock([refund()]))

    expect(ledgerRows).toHaveLength(4)
    expect(ledgerRows.every(r => r['source_event_id'] === 're_dash' && r['stripe_object_id'] === 're_dash' && r['order_id'] === 'o-1')).toBe(true)
    expect(ledgerRows.find(r => r['entry_type'] === 'refund')).toEqual(expect.objectContaining({ party: 'platform', amount_cents: -20900 }))
    expect(sum(ledgerRows.filter(r => r['entry_type'] === 'reversal'))).toBe(-20900)
    expect(payableUpdates()).toHaveLength(1)
    expect(payableUpdates()[0]!.payload).toEqual(expect.objectContaining({ reversed_cents: 10900, status: 'void' }))
  })

  it('on a bundle, spreads the refund over the members in proportion to what each was charged', async () => {
    const { ledgerRows } = world({
      group: true,
      orders: [order('o-a', { payment_group_id: GROUP }), order('o-b', { payment_group_id: GROUP, shipping_fee: 0 })],
    })
    await run(stripeMock([refund({ amount: 10000 })]), charge({ amount: 40900, amount_refunded: 10000, refunded: false, metadata: { platform: '8090ai', payment_group_id: GROUP } }))

    const refunds = ledgerRows.filter(r => r['entry_type'] === 'refund')
    expect(refunds.map(r => r['order_id']).sort()).toEqual(['o-a', 'o-b'])
    expect(sum(refunds)).toBe(-10000)
    expect(refunds.find(r => r['order_id'] === 'o-a')!['amount_cents']).toBe(-Math.round(10000 * 20900 / 40900))
  })

  it('a redelivery of the same event writes nothing more', async () => {
    const { ledgerRows } = world({ orders: [order('o-1')] })
    await run(stripeMock([refund()]))
    await recordRefundInLedger({ refundId: 're_dash', paymentIntentId: 'pi_1', chargeId: 'ch_1', amountCents: 20900, currency: 'usd', orderIds: ['o-1'], paymentGroupId: null, reversedByWebhook: true })
    expect(ledgerRows).toHaveLength(4)
    expect(payableUpdates()).toHaveLength(1)
  })
})

describe('an API refund followed by its charge.refunded webhook', () => {
  it('is written once: the webhook finds the lines the API path wrote, and the payable is adjusted once', async () => {
    const { ledgerRows } = world({ orders: [order('o-1', { status: 'REFUNDED' })] })
    // The ops Cancel + Refund action (or the retry cron) records it first.
    expect(await recordRefundLedger(db.client, { orderId: 'o-1', refundId: 're_api', amountCents: null, currency: 'usd' })).toEqual({ ok: true, inserted: 4 })

    await run(stripeMock([refund({ id: 're_api', transfer_reversal: 'trr_auto' as never })]))

    expect(ledgerRows).toHaveLength(4)
    expect(ledgerRows.every(r => r['source_event_id'] === 're_api')).toBe(true)
    expect(payableUpdates()).toHaveLength(1)
  })
})

describe('a ledger failure never fails the webhook', () => {
  it('a ledger write that fails: the sync completes and is recorded', async () => {
    const { history } = world({ orders: [order('o-1')], ledgerDown: true })
    await expect(run(stripeMock([refund()]))).resolves.toBeUndefined()
    expect(history.some(r => r.metadata?.['refund_id'] === 're_dash')).toBe(true)
  })

  it('a ledger that throws (no database client): the hook resolves and the sync completes', async () => {
    const { history } = world({ orders: [order('o-1')] })
    serviceThrows = true
    await expect(recordRefundInLedger({ refundId: 're_x', paymentIntentId: 'pi_1', chargeId: 'ch_1', amountCents: 1, currency: 'usd', orderIds: ['o-1'], paymentGroupId: null, reversedByWebhook: false })).resolves.toBeUndefined()
    await expect(run(stripeMock([refund()]))).resolves.toBeUndefined()
    expect(history.some(r => r.metadata?.['refund_id'] === 're_dash')).toBe(true)
  })
})
