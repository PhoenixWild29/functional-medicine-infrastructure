/**
 * @jest-environment node
 *
 * A failed order_status_history insert must reach a person.
 *
 * With the log_order_status_changes trigger dropped, a failed application
 * insert leaves a status change with no audit row. These tests pin:
 *   - a failed insert (returned error or thrown) raises a Slack alert
 *     through sendSlackAlert, naming the order id, transition and actor
 *   - the transition still succeeds (the insert stays non-fatal)
 *   - a Slack failure is swallowed too
 *   - a successful insert raises no alert
 */

import { casTransition } from '../cas-transition'
import { insertStatusHistory } from '../status-history'
import { writeDraftAudit } from '../draft-edit'

const ORDER_ID = '45e03578-e208-468d-a35b-ab9bc82320ae'

const sendSlackAlertMock = jest.fn()
jest.mock('@/lib/slack/client', () => ({
  ...jest.requireActual('@/lib/slack/client'),
  sendSlackAlert: (payload: unknown) => sendSlackAlertMock(payload),
}))

type InsertResult = { error: { message: string } | null }
let historyInsert: (rows: unknown) => Promise<InsertResult>
const inserted: unknown[] = []

const client = {
  from: (table: string) => {
    if (table === 'orders') {
      return {
        update: () => ({
          eq: () => ({
            eq: () => ({
              select: async () => ({ data: [{ order_id: ORDER_ID, status: 'PAID_PROCESSING' }], error: null }),
            }),
          }),
        }),
      }
    }
    return { insert: (rows: unknown) => { inserted.push(rows); return historyInsert(rows) } }
  },
}
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => client }))

const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
jest.spyOn(console, 'info').mockImplementation(() => {})

beforeEach(() => {
  sendSlackAlertMock.mockReset().mockResolvedValue(undefined)
  errorSpy.mockClear()
  inserted.length = 0
  historyInsert = async () => ({ error: null })
})

const transition = () => casTransition({
  orderId: ORDER_ID, expectedStatus: 'AWAITING_PAYMENT', newStatus: 'PAID_PROCESSING', actor: 'stripe_webhook',
})

function alertText(): string {
  expect(sendSlackAlertMock).toHaveBeenCalledTimes(1)
  return JSON.stringify(sendSlackAlertMock.mock.calls[0]![0])
}

describe('casTransition — failed status-history insert', () => {
  it('raises an alert naming the order, transition and actor, and the transition still succeeds', async () => {
    historyInsert = async () => ({ error: { message: 'connection terminated' } })

    await expect(transition()).resolves.toEqual({ success: true, wasAlreadyTransitioned: false, orderId: ORDER_ID })

    const text = alertText()
    expect(text).toContain(ORDER_ID)
    expect(text).toContain('AWAITING_PAYMENT → PAID_PROCESSING')
    expect(text).toContain('stripe_webhook')
    expect(text).toContain('casTransition')
    expect(text).toContain('connection terminated')
  })

  it('a thrown insert also alerts and does not fail the transition', async () => {
    historyInsert = () => Promise.reject(new Error('fetch failed'))
    await expect(transition()).resolves.toMatchObject({ success: true, wasAlreadyTransitioned: false })
    expect(alertText()).toContain('fetch failed')
  })

  it('a Slack failure is logged, not thrown', async () => {
    historyInsert = async () => ({ error: { message: 'boom' } })
    sendSlackAlertMock.mockRejectedValue(new Error('Slack alert failed: 500'))
    await expect(transition()).resolves.toMatchObject({ success: true })
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('alert for missing audit row failed'), 'Slack alert failed: 500')
  })

  it('a successful insert raises no alert', async () => {
    await expect(transition()).resolves.toMatchObject({ success: true })
    expect(inserted).toHaveLength(1)
    expect(sendSlackAlertMock).not.toHaveBeenCalled()
  })
})

describe('insertStatusHistory — every caller', () => {
  it('alerts once per row of a failed batch', async () => {
    historyInsert = async () => ({ error: { message: 'boom' } })
    const rows = ['o-1', 'o-2'].map(id => ({
      order_id: id, old_status: 'DRAFT' as const, new_status: 'DRAFT' as const, changed_by: 'user-1', metadata: null,
    }))
    await expect(insertStatusHistory(client as never, rows, 'reassign-to-me')).resolves.toBe(false)
    expect(sendSlackAlertMock).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(sendSlackAlertMock.mock.calls[1]![0])).toContain('o-2')
  })

  it('draft audit rows alert too', async () => {
    historyInsert = async () => ({ error: { message: 'boom' } })
    await expect(writeDraftAudit(client as never, ORDER_ID, {
      event: 'draft_edited', actor: { user_id: 'user-1', role: 'provider' },
    } as never)).resolves.toBe(false)
    const text = alertText()
    expect(text).toContain(ORDER_ID)
    expect(text).toContain('user-1')
    expect(text).toContain('draft-edit:draft_edited')
  })
})
