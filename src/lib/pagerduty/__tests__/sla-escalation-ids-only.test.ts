/**
 * @jest-environment node
 *
 * A Tier 3 SLA incident goes to PagerDuty, outside the BAA boundary. It
 * carries IDs, status enums and counts only. cascadeStatus was free text
 * ("Tier 1 failed → Cascading to Tier 4 (fax)") passed straight into
 * custom_details; it is replaced by structured fields: whether a cascade
 * was attempted (boolean) and the order status (validated against the
 * enum; anything else is dropped).
 */

import { triggerSlaEscalation } from '../client'

const fetchMock = jest.fn()

jest.mock('@/lib/env', () => ({ serverEnv: { pagerdutyRoutingKey: () => 'rk-test' } }))

beforeAll(() => { (global as { fetch: unknown }).fetch = fetchMock })
beforeEach(() => { fetchMock.mockReset().mockResolvedValue({ ok: true, status: 202, text: async () => '' }) })

const sentDetails = () => {
  const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string) as { payload: { custom_details: Record<string, unknown>; summary: string } }
  return body.payload
}

const BASE = {
  orderId:               'o-1',
  slaType:               'ADAPTER_SUBMISSION_ACK',
  escalationTier:        3,
  pharmacySlug:          'acme',
  integrationTier:       'TIER_1_API',
  breachDurationMinutes: 42,
}

it('sends ids, enums and counts, and never free text', async () => {
  await triggerSlaEscalation({
    ...BASE,
    orderStatus: 'SUBMISSION_PENDING',
    cascadeAttempted: true,
    // An old caller's free text must not get through.
    ...({ cascadeStatus: 'Janet Quixley Semaglutide: Tier 1 failed' } as object),
  } as Parameters<typeof triggerSlaEscalation>[0])

  const payload = sentDetails()
  expect(payload.custom_details).toEqual({
    order_id:                'o-1',
    sla_type:                'ADAPTER_SUBMISSION_ACK',
    escalation_tier:         3,
    pharmacy_slug:           'acme',
    integration_tier:        'TIER_1_API',
    order_status:            'SUBMISSION_PENDING',
    cascade_attempted:       true,
    breach_duration_minutes: 42,
  })
  expect(JSON.stringify(payload)).not.toContain('Janet')
})

it('an order status that is not an enum value is dropped', async () => {
  await triggerSlaEscalation({ ...BASE, orderStatus: 'rejected because Janet is allergic' })

  expect(sentDetails().custom_details).not.toHaveProperty('order_status')
  expect(JSON.stringify(sentDetails())).not.toContain('Janet')
})

it('an SLA type or tier that is not an enum value never reaches the summary', async () => {
  await triggerSlaEscalation({ ...BASE, slaType: 'Janet Quixley', integrationTier: 'Semaglutide' })

  const payload = sentDetails()
  expect(JSON.stringify(payload)).not.toContain('Janet')
  expect(JSON.stringify(payload)).not.toContain('Semaglutide')
})
