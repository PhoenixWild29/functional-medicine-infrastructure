/**
 * Payment Flow v1.1: the clinic order drawer says "Payment failed, awaiting
 * retry" while the order awaits payment and its newest history row is a
 * failed payment attempt. The Stripe event row is not a timeline step.
 */

import { render, screen, waitFor } from '@testing-library/react'
import { OrderDrawer } from '../_components/order-drawer'
import type { DashboardOrder } from '../page'

let historyRows: Array<Record<string, unknown>> = []

jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }) }))
jest.mock('@/lib/notifications', () => ({ notify: { success: jest.fn(), error: jest.fn() } }))
jest.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({ then: (resolve: (result: { data: unknown[] }) => void) => resolve({ data: historyRows }) }),
        }),
      }),
    }),
  }),
}))

const order: DashboardOrder = {
  orderId:           '45e03578-e208-468d-a35b-ab9bc82320ae',
  patientName:       'Demo, Alex',
  medicationName:    'Semaglutide Injectable 5 mg/mL',
  status:            'AWAITING_PAYMENT',
  submissionTier:    'TIER_4_FAX',
  createdAt:         '2026-10-10T08:00:00.000Z',
  updatedAt:         '2026-10-10T08:00:00.000Z',
  retailCents:       23100,
  wholesaleCents:    9500,
  platformFeeCents:  2040,
  clinicPayoutCents: 11560,
  isOverdue48h:      false,
  paymentGroupId:    null,
}

const SIGNED = { old_status: 'DRAFT', new_status: 'AWAITING_PAYMENT', changed_by: null, created_at: '2026-10-10T09:00:00Z', metadata: null }
const FAILED = { old_status: 'AWAITING_PAYMENT', new_status: 'AWAITING_PAYMENT', changed_by: 'stripe_webhook', created_at: '2026-10-10T10:00:00Z', metadata: { event: 'stripe_payment_failed', failure_code: 'card_declined' } }

beforeAll(() => {
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })) as unknown as typeof fetch
})

it('shows the label when the newest row is a failed payment, and keeps the row out of the timeline', async () => {
  historyRows = [SIGNED, FAILED]
  render(<OrderDrawer order={order} onClose={() => {}} onGroupCreated={() => {}} />)
  expect(await screen.findByTestId('payment-failed-label')).toHaveTextContent('Payment failed, awaiting retry')
  expect(screen.queryByText(/from Awaiting Payment/i)).not.toBeInTheDocument()
})

it('no label without a failed payment', async () => {
  historyRows = [SIGNED]
  render(<OrderDrawer order={order} onClose={() => {}} onGroupCreated={() => {}} />)
  await waitFor(() => expect(screen.getByText(/Awaiting Payment/i)).toBeInTheDocument())
  expect(screen.queryByTestId('payment-failed-label')).not.toBeInTheDocument()
})

it('no label once the order is paid', async () => {
  historyRows = [SIGNED, FAILED]
  render(<OrderDrawer order={{ ...order, status: 'PAID_PROCESSING' }} onClose={() => {}} onGroupCreated={() => {}} />)
  await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument())
  expect(screen.queryByTestId('payment-failed-label')).not.toBeInTheDocument()
})
