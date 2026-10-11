/**
 * @jest-environment node
 *
 * PagerDuty incidents close when their SLA does. resolveSlaEscalation
 * (src/lib/pagerduty/client.ts) was never called, so an incident opened
 * for an SLA breach stayed open after the order moved on.
 *
 *   - resolveSlasForTransition resolves the incident of each SLA it
 *     resolves that had breached (only breached SLAs page), e.g. when the
 *     order reaches PHARMACY_ACKNOWLEDGED or is CANCELLED.
 *   - manuallyResolveSla does the same for the SLA ops resolves.
 *   - A PagerDuty failure is logged, never thrown: the SLA row is already
 *     resolved and the caller (a webhook) must not fail on it.
 */

import { scriptedDb, type Script } from '@/__tests__/helpers/scripted-db'

let db = scriptedDb(() => undefined)
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
const resolveSlaEscalationMock = jest.fn()
jest.mock('@/lib/pagerduty/client', () => ({ resolveSlaEscalation: (o: string, t: string) => resolveSlaEscalationMock(o, t) }))

import { resolveSlasForTransition, manuallyResolveSla } from '../resolver'

const ORDER = 'b1000000-0000-4000-8000-000000000001'
const PAST = '2026-10-01T00:00:00.000Z'
const FUTURE = '2099-01-01T00:00:00.000Z'

function world(resolved: Array<{ sla_type: string; deadline_at: string }>, more: Script = () => undefined) {
  db = scriptedDb(c => more(c) ?? (c.table === 'order_sla_deadlines' && c.op === 'update' ? { data: resolved } : undefined))
}

beforeEach(() => {
  resolveSlaEscalationMock.mockReset().mockResolvedValue(undefined)
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

it('PHARMACY_ACKNOWLEDGED: the breached ADAPTER_SUBMISSION_ACK incident is resolved; an SLA that never breached is not paged', async () => {
  world([{ sla_type: 'ADAPTER_SUBMISSION_ACK', deadline_at: PAST }, { sla_type: 'PHARMACY_ACKNOWLEDGE', deadline_at: FUTURE }])
  await resolveSlasForTransition(ORDER, 'PHARMACY_ACKNOWLEDGED')
  expect(resolveSlaEscalationMock).toHaveBeenCalledTimes(1)
  expect(resolveSlaEscalationMock).toHaveBeenCalledWith(ORDER, 'ADAPTER_SUBMISSION_ACK')
})

it('CANCELLED: every breached SLA it resolves has its incident resolved', async () => {
  world([{ sla_type: 'FAX_DELIVERY', deadline_at: PAST }, { sla_type: 'PHARMACY_ACKNOWLEDGE', deadline_at: PAST }])
  await resolveSlasForTransition(ORDER, 'CANCELLED')
  expect(resolveSlaEscalationMock.mock.calls).toEqual([[ORDER, 'FAX_DELIVERY'], [ORDER, 'PHARMACY_ACKNOWLEDGE']])
})

it('nothing resolved (already resolved, idempotent): nothing paged', async () => {
  world([])
  await resolveSlasForTransition(ORDER, 'PHARMACY_ACKNOWLEDGED')
  expect(resolveSlaEscalationMock).not.toHaveBeenCalled()
})

it('a PagerDuty failure is logged, not thrown', async () => {
  world([{ sla_type: 'ADAPTER_SUBMISSION_ACK', deadline_at: PAST }])
  resolveSlaEscalationMock.mockRejectedValue(new Error('pd down'))
  await expect(resolveSlasForTransition(ORDER, 'PHARMACY_ACKNOWLEDGED')).resolves.toBeUndefined()
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining('PagerDuty'), expect.anything())
})

it('manual resolve: the incident of the SLA ops resolved is resolved', async () => {
  world([{ sla_type: 'FAX_DELIVERY', deadline_at: PAST }])
  await manuallyResolveSla({ orderId: ORDER, slaType: 'FAX_DELIVERY', resolvedBy: 'ops-user-id', resolutionNotes: 'Called the pharmacy' })
  expect(resolveSlaEscalationMock).toHaveBeenCalledWith(ORDER, 'FAX_DELIVERY')
})

it('manual resolve of an SLA already resolved: nothing paged', async () => {
  world([])
  await manuallyResolveSla({ orderId: ORDER, slaType: 'FAX_DELIVERY', resolvedBy: 'ops-user-id', resolutionNotes: 'x' })
  expect(resolveSlaEscalationMock).not.toHaveBeenCalled()
})
