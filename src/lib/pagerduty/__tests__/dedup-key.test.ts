/**
 * @jest-environment node
 *
 * #200: the PagerDuty dedup key is built from the normalized SLA type.
 * triggerSlaEscalation put the raw type in the key, so a caller passing
 * " fax_delivery" opened an incident resolveSlaEscalation("FAX_DELIVERY")
 * could never close, and free text in slaType reached PagerDuty (outside
 * the BAA) inside the key. The SLA type list is also checked against the
 * database enum, so a new sla_type_enum value fails the build until the
 * list knows it.
 */

import { slaDedupKey, triggerSlaEscalation, resolveSlaEscalation, PAGERDUTY_SLA_TYPES } from '../client'
import { Constants } from '@/types/database.types'

const fetchMock = jest.fn()
jest.mock('@/lib/env', () => ({ serverEnv: { pagerdutyRoutingKey: () => 'rk-test' } }))

beforeAll(() => { (global as { fetch: unknown }).fetch = fetchMock })
beforeEach(() => { fetchMock.mockReset().mockResolvedValue({ ok: true, status: 202, text: async () => '' }) })

const sentKeys = () => fetchMock.mock.calls.map(c => (JSON.parse(c[1].body as string) as { dedup_key: string }).dedup_key)

it('normalizes case and whitespace', () => {
  expect(slaDedupKey('o-1', ' fax_delivery ')).toBe('sla-o-1-FAX_DELIVERY')
  expect(slaDedupKey('o-1', 'FAX_DELIVERY')).toBe('sla-o-1-FAX_DELIVERY')
})

it('a value that is not an SLA type never reaches the key', () => {
  expect(slaDedupKey('o-1', 'Patient Jane Doe called')).toBe('sla-o-1-UNKNOWN')
})

it('trigger and resolve build the same key from differently spelled types', async () => {
  await triggerSlaEscalation({
    orderId: 'o-1', slaType: 'fax_delivery', escalationTier: 3, pharmacySlug: 'acme',
    integrationTier: 'TIER_4_FAX', breachDurationMinutes: 5,
  })
  await resolveSlaEscalation('o-1', 'FAX_DELIVERY')
  const [opened, resolved] = sentKeys()
  expect(opened).toBe('sla-o-1-FAX_DELIVERY')
  expect(resolved).toBe(opened)
})

it('the SLA type list matches the database enum exactly', () => {
  expect([...PAGERDUTY_SLA_TYPES].sort()).toEqual([...Constants.public.Enums.sla_type_enum].sort())
})
