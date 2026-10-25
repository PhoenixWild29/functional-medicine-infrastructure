/**
 * @jest-environment node
 *
 * casTransition enforces the state machine (B-2026-10-25-06):
 *   - an illegal transition is refused;
 *   - an actor the transition's rule does not allow is refused;
 *   - a status's REQUIRED_FIELDS_ON_ENTER must be set: checked in the
 *     UPDATE's own WHERE clause, so a missing field is refused (and the
 *     order is untouched), while an order that already moved on is still
 *     the usual no-op;
 *   - `patch` is written in the same UPDATE as the status.
 * Nothing is written, and no history row is added, when a transition is
 * refused. The corrected rules (DRAFT -> CANCELLED, REFUND_PENDING ->
 * REFUNDED, nothing required for SUBMISSION_PENDING) are pinned too.
 */

import { casTransition, CasTransitionRefused } from '../cas-transition'
import {
  TRANSITION_RULES, VALID_TRANSITIONS, REQUIRED_FIELDS_ON_ENTER, UNENFORCED_REQUIRED_FIELDS_ON_ENTER,
  canActorTransition, type OrderStatus,
} from '../state-machine'

const ORDER_ID = '45e03578-e208-468d-a35b-ab9bc82320ae'

// ── A one-table fake that applies eq / not-is-null filters for real ──
type Row = Record<string, unknown>
let orders: Row[] = []
const history: Row[] = []

function orderUpdate(patch: Row) {
  const filters: Array<(r: Row) => boolean> = []
  const chain = {
    eq: (col: string, v: unknown) => { filters.push(r => r[col] === v); return chain },
    not: (col: string, op: string, v: unknown) => {
      if (op !== 'is' || v !== null) throw new Error('fake supports not(col, is, null) only')
      filters.push(r => r[col] != null)
      return chain
    },
    select: async () => {
      const hit = orders.filter(r => filters.every(f => f(r)))
      for (const r of hit) Object.assign(r, patch)
      return { data: hit.map(r => ({ order_id: r['order_id'], status: r['status'] })), error: null }
    },
  }
  return chain
}

function orderSelect(cols: string) {
  const filters: Array<(r: Row) => boolean> = []
  const chain = {
    eq: (col: string, v: unknown) => { filters.push(r => r[col] === v); return chain },
    maybeSingle: async () => {
      const r = orders.find(o => filters.every(f => f(o)))
      if (!r) return { data: null, error: null }
      return { data: Object.fromEntries(cols.split(',').map(c => c.trim()).map(c => [c, r[c] ?? null])), error: null }
    },
  }
  return chain
}

const client = {
  from: (table: string) => {
    if (table === 'orders') return { update: (patch: Row) => orderUpdate(patch), select: (cols: string) => orderSelect(cols) }
    if (table === 'order_status_history') return { insert: async (rows: Row | Row[]) => { history.push(...([] as Row[]).concat(rows)); return { error: null } } }
    throw new Error(`unexpected table ${table}`)
  },
}
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => client }))
jest.spyOn(console, 'info').mockImplementation(() => {})
jest.spyOn(console, 'error').mockImplementation(() => {})

const order = (fields: Row) => { orders = [{ order_id: ORDER_ID, ...fields }] }
beforeEach(() => { orders = []; history.length = 0 })

const refusal = async (p: Promise<unknown>) => {
  try { await p } catch (e) { return e }
  throw new Error('expected a refusal')
}

// ── Legal transitions only ──
it('an illegal transition is refused; nothing written', async () => {
  order({ status: 'DRAFT' })
  const e = await refusal(casTransition({ orderId: ORDER_ID, expectedStatus: 'DRAFT', newStatus: 'SHIPPED', actor: 'x', actorRole: 'ops_admin' }))
  expect(e).toBeInstanceOf(CasTransitionRefused)
  expect((e as CasTransitionRefused).code).toBe('illegal_transition')
  expect(orders[0]!['status']).toBe('DRAFT')
  expect(history).toHaveLength(0)
})

// ── Actors ──
describe('actor rules', () => {
  it.each<[OrderStatus, OrderStatus, 'clinic_admin' | 'provider' | 'medical_assistant' | 'ops_admin' | 'system']>([
    ['AWAITING_PAYMENT', 'PAID_PROCESSING', 'ops_admin'],         // only the Stripe webhook
    ['FAX_QUEUED', 'FAX_DELIVERED', 'ops_admin'],                  // only the Documo webhook
    ['FAX_DELIVERED', 'PHARMACY_ACKNOWLEDGED', 'system'],          // only ops confirms a fax
    ['SUBMISSION_FAILED', 'REROUTE_PENDING', 'system'],            // only ops reroutes a failed submission
    ['PAYMENT_EXPIRED', 'CANCELLED', 'clinic_admin'],              // only ops
    ['DRAFT', 'CANCELLED', 'medical_assistant'],                   // a medical assistant cannot cancel
    ['READY_TO_SHIP', 'SHIPPED', 'provider'],
  ])('%s -> %s by %s is refused; nothing written', async (from, to, role) => {
    order({ status: from, tracking_number: 't', carrier: 'c', stripe_payment_intent_id: 'pi_1' })
    const e = await refusal(casTransition({ orderId: ORDER_ID, expectedStatus: from, newStatus: to, actor: 'someone', actorRole: role }))
    expect((e as CasTransitionRefused).code).toBe('actor_not_allowed')
    expect(orders[0]!['status']).toBe(from)
    expect(history).toHaveLength(0)
  })

  it('the allowed actor passes and the history row names the actor label', async () => {
    order({ status: 'FAX_DELIVERED' })
    const r = await casTransition({ orderId: ORDER_ID, expectedStatus: 'FAX_DELIVERED', newStatus: 'PHARMACY_ACKNOWLEDGED', actor: 'ops:ops@example.test', actorRole: 'ops_admin' })
    expect(r).toEqual({ success: true, wasAlreadyTransitioned: false, orderId: ORDER_ID })
    expect(orders[0]!['status']).toBe('PHARMACY_ACKNOWLEDGED')
    expect(history).toEqual([expect.objectContaining({ old_status: 'FAX_DELIVERED', new_status: 'PHARMACY_ACKNOWLEDGED', changed_by: 'ops:ops@example.test' })])
  })

  it('corrected: ops and the expiry cron may cancel a draft; clinic admins and providers still may', () => {
    for (const role of ['clinic_admin', 'provider', 'ops_admin', 'system'] as const) {
      expect({ role, ok: canActorTransition('DRAFT', 'CANCELLED', role) }).toEqual({ role, ok: true })
    }
  })

  it('corrected: ops may record REFUNDED (the cancel that refunds at once), as the cron and webhook may', () => {
    expect(canActorTransition('REFUND_PENDING', 'REFUNDED', 'ops_admin')).toBe(true)
    expect(canActorTransition('REFUND_PENDING', 'REFUNDED', 'system')).toBe(true)
    expect(canActorTransition('REFUND_PENDING', 'REFUNDED', 'clinic_admin')).toBe(false)
  })

  it('every legal transition has an actor rule (none is unreachable by accident)', () => {
    for (const [from, tos] of Object.entries(VALID_TRANSITIONS) as Array<[OrderStatus, ReadonlySet<OrderStatus>]>) {
      for (const to of tos) {
        const rule = TRANSITION_RULES[from]?.find(r => r.to === to)
        expect({ from, to, hasRule: !!rule && rule.actors.size > 0 }).toEqual({ from, to, hasRule: true })
      }
    }
  })
})

// ── Required fields ──
describe('required fields on entry', () => {
  it('PAID_PROCESSING without stripe_payment_intent_id is refused; the order stays AWAITING_PAYMENT', async () => {
    order({ status: 'AWAITING_PAYMENT', stripe_payment_intent_id: null })
    const e = await refusal(casTransition({ orderId: ORDER_ID, expectedStatus: 'AWAITING_PAYMENT', newStatus: 'PAID_PROCESSING', actor: 'stripe_webhook', actorRole: 'system' }))
    expect((e as CasTransitionRefused).code).toBe('missing_required_fields')
    expect((e as CasTransitionRefused).missingFields).toEqual(['stripe_payment_intent_id'])
    expect(orders[0]!['status']).toBe('AWAITING_PAYMENT')
    expect(history).toHaveLength(0)
  })

  it('PAID_PROCESSING with the payment intent passes', async () => {
    order({ status: 'AWAITING_PAYMENT', stripe_payment_intent_id: 'pi_1' })
    const r = await casTransition({ orderId: ORDER_ID, expectedStatus: 'AWAITING_PAYMENT', newStatus: 'PAID_PROCESSING', actor: 'stripe_webhook', actorRole: 'system' })
    expect(r.wasAlreadyTransitioned).toBe(false)
    expect(orders[0]!['status']).toBe('PAID_PROCESSING')
  })

  it('an order that already left the expected status is the usual no-op, not a refusal', async () => {
    order({ status: 'PAYMENT_EXPIRED', stripe_payment_intent_id: null })
    const r = await casTransition({ orderId: ORDER_ID, expectedStatus: 'AWAITING_PAYMENT', newStatus: 'PAID_PROCESSING', actor: 'stripe_webhook', actorRole: 'system' })
    expect(r).toEqual({ success: true, wasAlreadyTransitioned: true, orderId: ORDER_ID })
    expect(orders[0]!['status']).toBe('PAYMENT_EXPIRED')
    expect(history).toHaveLength(0)
  })

  it('AWAITING_PAYMENT needs every snapshot and locked_at', async () => {
    const full = {
      wholesale_price_snapshot: 10, retail_price_snapshot: 20, medication_snapshot: {}, shipping_state_snapshot: 'TX',
      provider_npi_snapshot: '1234567893', pharmacy_snapshot: {}, locked_at: '2026-10-25T00:00:00Z',
    }
    order({ status: 'PAYMENT_EXPIRED', ...full, provider_npi_snapshot: null, locked_at: null })
    const e = await refusal(casTransition({ orderId: ORDER_ID, expectedStatus: 'PAYMENT_EXPIRED', newStatus: 'AWAITING_PAYMENT', actor: 'ops:x', actorRole: 'ops_admin' }))
    expect((e as CasTransitionRefused).missingFields).toEqual(['provider_npi_snapshot', 'locked_at'])
    expect(orders[0]!['status']).toBe('PAYMENT_EXPIRED')

    order({ status: 'PAYMENT_EXPIRED', ...full })
    const r = await casTransition({ orderId: ORDER_ID, expectedStatus: 'PAYMENT_EXPIRED', newStatus: 'AWAITING_PAYMENT', actor: 'ops:x', actorRole: 'ops_admin' })
    expect(r.wasAlreadyTransitioned).toBe(false)
  })

  it('a patch that clears a required field is refused before any write; a patch that sets one counts', async () => {
    order({ status: 'AWAITING_PAYMENT', stripe_payment_intent_id: null })
    const e = await refusal(casTransition({ orderId: ORDER_ID, expectedStatus: 'AWAITING_PAYMENT', newStatus: 'PAID_PROCESSING', actor: 'x', actorRole: 'system', patch: { stripe_payment_intent_id: null } }))
    expect((e as CasTransitionRefused).code).toBe('missing_required_fields')
    const r = await casTransition({ orderId: ORDER_ID, expectedStatus: 'AWAITING_PAYMENT', newStatus: 'PAID_PROCESSING', actor: 'x', actorRole: 'system', patch: { stripe_payment_intent_id: 'pi_2' } })
    expect(r.wasAlreadyTransitioned).toBe(false)
    expect(orders[0]).toMatchObject({ status: 'PAID_PROCESSING', stripe_payment_intent_id: 'pi_2' })
  })

  it('corrected: entering SUBMISSION_PENDING requires nothing (the routing engine claims before it submits)', async () => {
    expect(REQUIRED_FIELDS_ON_ENTER['SUBMISSION_PENDING']).toBeUndefined()
    order({ status: 'PAID_PROCESSING', submission_tier: null, adapter_submission_id: null })
    const r = await casTransition({ orderId: ORDER_ID, expectedStatus: 'PAID_PROCESSING', newStatus: 'SUBMISSION_PENDING', actor: 'routing_engine', actorRole: 'system' })
    expect(r.wasAlreadyTransitioned).toBe(false)
  })

  it('left for Sam: SHIPPED tracking is declared but not enforced (a webhook without tracking still ships)', async () => {
    expect(REQUIRED_FIELDS_ON_ENTER['SHIPPED']).toBeUndefined()
    expect(UNENFORCED_REQUIRED_FIELDS_ON_ENTER['SHIPPED']).toEqual(['tracking_number', 'carrier'])
    order({ status: 'READY_TO_SHIP', tracking_number: null, carrier: null })
    const r = await casTransition({ orderId: ORDER_ID, expectedStatus: 'READY_TO_SHIP', newStatus: 'SHIPPED', actor: 'pharmacy_webhook', actorRole: 'system' })
    expect(r.wasAlreadyTransitioned).toBe(false)
  })
})

// ── patch ──
it('patch is written in the same UPDATE as the status (the ops reroute)', async () => {
  order({ status: 'SUBMISSION_FAILED', reroute_count: 0, pharmacy_id: 'p1' })
  await casTransition({
    orderId: ORDER_ID, expectedStatus: 'SUBMISSION_FAILED', newStatus: 'REROUTE_PENDING', actor: 'ops:x', actorRole: 'ops_admin',
    patch: { reroute_count: 1, pharmacy_id: 'p2' },
  })
  expect(orders[0]).toMatchObject({ status: 'REROUTE_PENDING', reroute_count: 1, pharmacy_id: 'p2' })
  // A no-op changes nothing, patch included.
  await casTransition({
    orderId: ORDER_ID, expectedStatus: 'SUBMISSION_FAILED', newStatus: 'REROUTE_PENDING', actor: 'ops:x', actorRole: 'ops_admin',
    patch: { reroute_count: 9 },
  })
  expect(orders[0]!['reroute_count']).toBe(1)
})

it('a patch may not set the status itself', async () => {
  order({ status: 'SUBMISSION_FAILED' })
  await expect(casTransition({
    orderId: ORDER_ID, expectedStatus: 'SUBMISSION_FAILED', newStatus: 'REROUTE_PENDING', actor: 'ops:x', actorRole: 'ops_admin',
    patch: { status: 'SHIPPED' } as never,
  })).rejects.toThrow('patch may not set status')
})
