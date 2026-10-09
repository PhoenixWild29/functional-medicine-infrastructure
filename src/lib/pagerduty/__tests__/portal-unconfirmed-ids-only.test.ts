/**
 * @jest-environment node
 *
 * A Tier 2 (portal) order whose submission SLA breached is not faxed
 * automatically; ops gets a PagerDuty incident instead. PagerDuty is
 * outside the BAA boundary: the incident carries IDs, enums and counts
 * only, and shares the SLA's dedup key so a later Tier 3 escalation of the
 * same SLA joins the same incident.
 */

import { triggerPortalSubmissionUnconfirmed, slaDedupKey } from '../client'

const fetchMock = jest.fn()

jest.mock('@/lib/env', () => ({ serverEnv: { pagerdutyRoutingKey: () => 'rk-test' } }))

beforeAll(() => { (global as { fetch: unknown }).fetch = fetchMock })
beforeEach(() => { fetchMock.mockReset().mockResolvedValue({ ok: true, status: 202, text: async () => '' }) })

const sent = () => JSON.parse(fetchMock.mock.calls[0]![1].body as string) as {
  dedup_key: string
  payload: { custom_details: Record<string, unknown>; summary: string; severity: string }
}

it('sends ids, enums and counts, on the SLA dedup key', async () => {
  await triggerPortalSubmissionUnconfirmed({
    orderId: 'o-1', pharmacySlug: 'acme', orderStatus: 'SUBMISSION_PENDING', breachDurationMinutes: 42,
    ...({ patientName: 'Janet Quixley' } as object),
  } as Parameters<typeof triggerPortalSubmissionUnconfirmed>[0])

  const body = sent()
  expect(body.dedup_key).toBe(slaDedupKey('o-1', 'ADAPTER_SUBMISSION_ACK'))
  expect(body.payload.custom_details).toEqual({
    order_id:                'o-1',
    sla_type:                'ADAPTER_SUBMISSION_ACK',
    pharmacy_slug:           'acme',
    integration_tier:        'TIER_2_PORTAL',
    order_status:            'SUBMISSION_PENDING',
    auto_fax:                false,
    breach_duration_minutes: 42,
  })
  expect(body.payload.summary).toBe('Portal submission not confirmed, not faxed: Order o-1')
  expect(JSON.stringify(body)).not.toContain('Janet')
})

it('an order status that is not an enum value is dropped', async () => {
  await triggerPortalSubmissionUnconfirmed({ orderId: 'o-1', pharmacySlug: 'acme', orderStatus: 'Janet called', breachDurationMinutes: 1 })
  expect(sent().payload.custom_details).not.toHaveProperty('order_status')
})
