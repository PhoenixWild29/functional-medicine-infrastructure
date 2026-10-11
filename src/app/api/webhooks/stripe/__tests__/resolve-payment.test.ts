/**
 * @jest-environment node
 *
 * Payment Flow v1.1: which orders a PaymentIntent paid for. A paid
 * bundle's members carry its PaymentIntent too, so the group is checked
 * first, then the order's own PaymentIntent. This is the lookup the solo
 * dispute handler now uses: a group dispute (even one whose metadata was
 * stripped) resolves to the group, a solo dispute to its one order.
 */

import { scriptedDb, DB_DOWN, type ScriptedCall } from '@/__tests__/helpers/scripted-db'
import { resolvePaymentTarget } from '../resolve-payment'

const GROUP = 'a5000000-0000-4000-8000-000000000001'

function db(opts: { groupByPi?: boolean; groupById?: { stripe_payment_intent_id: string | null } | null; solo?: boolean; fail?: boolean }) {
  return scriptedDb((c: ScriptedCall) => {
    if (opts.fail) return DB_DOWN
    if (c.table === 'payment_groups') {
      if ('group_id' in c.filters) return { data: opts.groupById ? { group_id: GROUP, status: 'PAID', ...opts.groupById } : null }
      return { data: opts.groupByPi ? { group_id: GROUP, status: 'PAID', stripe_payment_intent_id: 'pi_1' } : null }
    }
    if (c.table === 'orders') {
      if ('payment_group_id' in c.filters) {
        return { data: [
          { order_id: 'o-1', status: 'PAID_PROCESSING', payment_group_id: GROUP, stripe_payment_intent_id: 'pi_1', retail_price_snapshot: 50 },
          { order_id: 'o-2', status: 'PAID_PROCESSING', payment_group_id: GROUP, stripe_payment_intent_id: 'pi_1', retail_price_snapshot: 50 },
        ] }
      }
      return { data: opts.solo ? { order_id: 'o-solo', status: 'SHIPPED', payment_group_id: null, stripe_payment_intent_id: 'pi_1', retail_price_snapshot: 90 } : null }
    }
    return undefined
  })
}

it('a group dispute (metadata stripped): the group and every member, never an order lookup by PI', async () => {
  const d = db({ groupByPi: true })
  const target = await resolvePaymentTarget(d.client as never, 'pi_1', null)
  expect(target).toEqual(expect.objectContaining({ kind: 'group', groupId: GROUP }))
  expect(target!.orders.map(o => o.order_id)).toEqual(['o-1', 'o-2'])
  expect(d.calls.some(c => c.table === 'orders' && c.filters['stripe_payment_intent_id'] === 'pi_1')).toBe(false)
})

it('a solo dispute: no group, then the one order with that PaymentIntent and no group', async () => {
  const d = db({ solo: true })
  const target = await resolvePaymentTarget(d.client as never, 'pi_1', null)
  expect(target).toEqual({ kind: 'solo', orders: [expect.objectContaining({ order_id: 'o-solo' })] })
  const orderLookup = d.calls.find(c => c.table === 'orders')!
  expect(orderLookup.filters).toEqual(expect.objectContaining({ stripe_payment_intent_id: 'pi_1', 'payment_group_id:is': null }))
})

it('the metadata group id is used when its PaymentIntent matches', async () => {
  const d = db({ groupById: { stripe_payment_intent_id: 'pi_1' } })
  expect((await resolvePaymentTarget(d.client as never, 'pi_1', GROUP))?.kind).toBe('group')
})

it('a metadata group whose recorded PaymentIntent is another one is not this payment', async () => {
  const d = db({ groupById: { stripe_payment_intent_id: 'pi_other' }, solo: true })
  expect((await resolvePaymentTarget(d.client as never, 'pi_1', GROUP))?.kind).toBe('solo')
})

it('nothing found: null', async () => {
  expect(await resolvePaymentTarget(db({}).client as never, 'pi_1', null)).toBeNull()
})

it('a database error throws (the webhook answers 500 and Stripe redelivers)', async () => {
  await expect(resolvePaymentTarget(db({ fail: true }).client as never, 'pi_1', null)).rejects.toThrow()
})
