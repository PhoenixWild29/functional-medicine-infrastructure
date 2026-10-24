/**
 * Lauren, 23 Oct: the order history of an expired order.
 *   - "Draft created" said "still a draft" after the order had moved on
 *     (signed, then the payment link expired). It says that only while the
 *     order IS a draft; afterwards, "saved as a draft".
 *   - The expiry was attributed to "cron:payment-expiry". Any cron:* actor
 *     shows as "CompoundIQ (automatic)".
 * axe clean with the history shown.
 */

import { render, screen } from '@testing-library/react'
import { configureAxe } from 'jest-axe'
import { OrderDrawer } from '../_components/order-drawer'
import { actorDisplayName } from '@/lib/orders/timeline-actors'
import type { DashboardOrder } from '../page'

jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }) }))
jest.mock('@/lib/notifications', () => ({ notify: { success: jest.fn(), error: jest.fn() } }))

const CHEN_UID = '11111111-1111-4111-8111-111111111111'
let mockHistory: unknown[] = []
jest.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ order: () => ({ then: (resolve: (r: { data: unknown[] }) => void) => resolve({ data: mockHistory }) }) }) }) }),
  }),
}))

const order = (status: DashboardOrder['status']): DashboardOrder => ({
  orderId: 'a6000000-0000-0000-0000-000000000001', patientName: 'Demo, Alex', medicationName: 'Semaglutide', status,
  submissionTier: null, createdAt: '2026-09-13T11:00:00.000Z', updatedAt: '2026-09-17T12:00:00.000Z',
  retailCents: 19000, wholesaleCents: 9500, platformFeeCents: 0, clinicPayoutCents: 9500,
  isOverdue48h: false, paymentGroupId: null, providerId: 'prov-chen',
})

const CREATED = { old_status: 'DRAFT', new_status: 'DRAFT', changed_by: CHEN_UID, created_at: '2026-09-13T11:00:00.000Z', metadata: { event: 'draft_created' } }
const SIGNED = { old_status: 'DRAFT', new_status: 'AWAITING_PAYMENT', changed_by: CHEN_UID, created_at: '2026-09-14T09:00:00.000Z', metadata: null }
const EXPIRED = { old_status: 'AWAITING_PAYMENT', new_status: 'PAYMENT_EXPIRED', changed_by: 'cron:payment-expiry', created_at: '2026-09-17T09:00:00.000Z', metadata: null }

beforeEach(() => {
  global.fetch = jest.fn(async (url: string) => (url.endsWith('/timeline-actors')
    ? { ok: true, json: async () => ({ actors: { [CHEN_UID]: { name: 'Sarah Chen', role: 'provider' } } }) }
    : { ok: true, json: async () => ({}) })) as unknown as typeof fetch
})

it('an expired order: "Draft created" does not say "still a draft", and the expiry is CompoundIQ (automatic)', async () => {
  mockHistory = [EXPIRED, SIGNED, CREATED]
  render(<OrderDrawer order={order('PAYMENT_EXPIRED')} onClose={jest.fn()} onGroupCreated={jest.fn()} />)
  expect(await screen.findByText(/saved as a draft · Sarah Chen/)).toBeInTheDocument()
  expect(screen.queryByText(/still a draft/)).toBeNull()
  expect(screen.getByText(/CompoundIQ \(automatic\)/)).toBeInTheDocument()
  expect(screen.queryByText(/cron:payment-expiry/)).toBeNull()
})

it('while the order is still a draft, it says so', async () => {
  mockHistory = [CREATED]
  render(<OrderDrawer order={order('DRAFT')} onClose={jest.fn()} onGroupCreated={jest.fn()} />)
  expect(await screen.findByText(/still a draft · Sarah Chen/)).toBeInTheDocument()
})

it.each(['cron:payment-expiry', 'cron:refund-retry', 'cron:anything'])('%s shows as CompoundIQ (automatic)', actor => {
  expect(actorDisplayName({}, actor)).toBe('CompoundIQ (automatic)')
})

it('a person still shows by name, an unresolved id as itself', () => {
  expect(actorDisplayName({ [CHEN_UID]: { name: 'Sarah Chen', role: 'provider' } } as never, CHEN_UID)).toBe('Sarah Chen')
  expect(actorDisplayName({}, 'u-unknown')).toBe('u-unknown')
})

it('is axe clean with the history shown', async () => {
  mockHistory = [EXPIRED, SIGNED, CREATED]
  render(<main><h1>Dashboard</h1><OrderDrawer order={order('PAYMENT_EXPIRED')} onClose={jest.fn()} onGroupCreated={jest.fn()} /></main>)
  await screen.findByText(/CompoundIQ \(automatic\)/)
  const axe = configureAxe({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } })
  expect((await axe(document.body)).violations.map(v => v.id)).toEqual([])
})
