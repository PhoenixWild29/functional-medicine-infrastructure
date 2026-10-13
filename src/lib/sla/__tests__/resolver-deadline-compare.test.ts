/**
 * @jest-environment node
 *
 * "Has this SLA breached?" was decided by comparing two timestamp STRINGS:
 * deadline_at as Postgres returns it ("+00:00", or another offset, with
 * or without fractional seconds) against new Date().toISOString() ("Z").
 * String order is not time order once the formats differ, so a breached
 * SLA could keep its PagerDuty incident open, or one that never breached
 * could be resolved. Both are now parsed and compared as instants; an
 * unparseable deadline counts as not breached and is logged.
 */

import { scriptedDb } from '@/__tests__/helpers/scripted-db'

let db = scriptedDb(() => undefined)
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
const resolveSlaEscalationMock = jest.fn()
jest.mock('@/lib/pagerduty/client', () => ({ resolveSlaEscalation: (o: string, t: string) => resolveSlaEscalationMock(o, t) }))

import { resolveSlasForTransition, manuallyResolveSla } from '../resolver'

const ORDER = 'b2000000-0000-4000-8000-000000000001'

function withDeadline(deadline_at: string) {
  db = scriptedDb(c => (c.table === 'order_sla_deadlines' && c.op === 'update'
    ? { data: [{ sla_type: 'ADAPTER_SUBMISSION_ACK', deadline_at }] }
    : undefined))
}

async function breachedAt(deadline: string, nowIso: string): Promise<boolean> {
  withDeadline(deadline)
  jest.setSystemTime(new Date(nowIso))
  resolveSlaEscalationMock.mockClear()
  await resolveSlasForTransition(ORDER, 'PHARMACY_ACKNOWLEDGED')
  return resolveSlaEscalationMock.mock.calls.length > 0
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] })
  resolveSlaEscalationMock.mockReset().mockResolvedValue(undefined)
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
})

it('(d) "+00:00" deadline half a second before a "Z" now: breached', async () => {
  expect(await breachedAt('2026-10-11T13:00:00+00:00', '2026-10-11T13:00:00.500Z')).toBe(true)
})

it('(d) "+00:00" deadline a millisecond after a "Z" now: not breached', async () => {
  expect(await breachedAt('2026-10-11T13:00:01+00:00', '2026-10-11T13:00:00.999Z')).toBe(false)
})

it('mixed formats with fractional seconds compare as instants', async () => {
  // Microseconds from Postgres, milliseconds from JS.
  expect(await breachedAt('2026-10-11T13:00:00.250123+00:00', '2026-10-11T13:00:00.251Z')).toBe(true)
  expect(await breachedAt('2026-10-11T13:00:00.900+00:00', '2026-10-11T13:00:00.100Z')).toBe(false)
  // Exactly at the deadline counts as breached.
  expect(await breachedAt('2026-10-11T13:00:00.5+00:00', '2026-10-11T13:00:00.500Z')).toBe(true)
})

it('a deadline with a non-UTC offset that has NOT passed is not breached', async () => {
  // 09:00:01-04:00 is 13:00:01Z; string order says it is earlier than 13:00.
  expect(await breachedAt('2026-10-11T09:00:01-04:00', '2026-10-11T13:00:00.999Z')).toBe(false)
})

it('a deadline with a non-UTC offset that HAS passed is breached', async () => {
  // 14:00:00+02:00 is 12:00:00Z; string order says it is later than 13:00.
  expect(await breachedAt('2026-10-11T14:00:00+02:00', '2026-10-11T13:00:00.500Z')).toBe(true)
})

it('an unparseable deadline is treated as not breached and logged', async () => {
  expect(await breachedAt('0000-not-a-date', '2026-10-11T13:00:00.500Z')).toBe(false)
  const logged = [
    ...(console.warn as jest.Mock).mock.calls,
    ...(console.error as jest.Mock).mock.calls,
  ].map(args => args.join(' '))
  expect(logged.some(l => l.includes(ORDER) && l.includes('ADAPTER_SUBMISSION_ACK'))).toBe(true)
})

it('manual resolve uses the same instant comparison', async () => {
  withDeadline('2026-10-11T14:00:00+02:00')
  jest.setSystemTime(new Date('2026-10-11T13:00:00.500Z'))
  await manuallyResolveSla({ orderId: ORDER, slaType: 'ADAPTER_SUBMISSION_ACK', resolvedBy: 'ops-user-id', resolutionNotes: 'x' })
  expect(resolveSlaEscalationMock).toHaveBeenCalledWith(ORDER, 'ADAPTER_SUBMISSION_ACK')
})
