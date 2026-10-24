/**
 * The order drawer starts over for each order it shows.
 *
 * Pinned before the drawer's per-order state moved out of effects
 * (eslint-plugin-react-hooks 7.1: set-state-in-effect, immutability).
 * Behaviour unchanged:
 *   - switching orders clears the previous order's failure line, stored
 *     record (shipping line), sibling picker and bundle details, then loads
 *     the new order's;
 *   - a grouped AWAITING_PAYMENT order shows "Loading bundle details" until
 *     the group link arrives, then its count and total;
 *   - Copy Bundle Payment Link re-fetches the group link when the load on
 *     open failed;
 *   - a non-AWAITING_PAYMENT order asks for neither siblings nor a group link.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { OrderDrawer } from '../_components/order-drawer'
import type { DashboardOrder } from '../page'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }),
}))
jest.mock('@/lib/notifications', () => ({
  notify: { success: jest.fn(), error: jest.fn() },
}))
jest.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            then: (resolve: (result: { data: never[] }) => void) => resolve({ data: [] }),
          }),
        }),
      }),
    }),
  }),
}))

const FAILED = 'f0000000-0000-4000-8000-000000000001'
const AWAITING = 'f0000000-0000-4000-8000-000000000002'
const GROUPED = 'f0000000-0000-4000-8000-000000000003'
const PENDING = 'f0000000-0000-4000-8000-000000000004'
const GROUP_ID = 'a0000000-0000-4000-8000-0000000000aa'

const base: DashboardOrder = {
  orderId:           FAILED,
  patientName:       'Demo, Alex',
  medicationName:    'Semaglutide Injectable 5 mg/mL',
  status:            'SUBMISSION_FAILED',
  submissionTier:    'TIER_4_FAX',
  createdAt:         '2026-09-18T10:00:00.000Z',
  updatedAt:         '2026-09-18T10:00:00.000Z',
  retailCents:       23100,
  wholesaleCents:    9500,
  platformFeeCents:  2040,
  clinicPayoutCents: 11560,
  isOverdue48h:      false,
  paymentGroupId:    null,
}
const failedOrder: DashboardOrder = base
const awaitingOrder: DashboardOrder = { ...base, orderId: AWAITING, status: 'AWAITING_PAYMENT' }
const groupedOrder: DashboardOrder = { ...base, orderId: GROUPED, status: 'AWAITING_PAYMENT', paymentGroupId: GROUP_ID }
const pendingRecordOrder: DashboardOrder = { ...base, orderId: PENDING, status: 'AWAITING_PAYMENT' }

const record = {
  shipping: { feeCents: 2200, shippingType: 'cold_chain', pharmacyName: 'Strive Pharmacy', absorbed: false },
  rxDetails: {
    daysSupply: 90, dispenseQuantity: 2.4, dispenseUnit: 'mL', refills: 0, substitutionAllowed: true,
    syringeOption: 'sc_kit', shippingType: 'cold_chain', clinicalDifference: null,
    diagnosisCode: null, diagnosisText: null, specialInstructions: null,
  },
  packageLabel: null,
  packageCount: null,
}

let groupLinkFails = 0
let resolveGroupLink: (() => void) | null = null
const ok = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
const fetchMock = jest.fn((url: string) => {
  if (url === `/api/orders/${FAILED}/failure-reason`) return ok({ failure: { pharmacyName: 'Strive Pharmacy', plainReason: null } })
  if (url === `/api/orders/${FAILED}/record`) return ok(record)
  if (url === `/api/orders/${PENDING}/record`) return new Promise(() => {})
  if (url.endsWith('/bundlable-siblings')) {
    return ok({
      anchorBundlable: true,
      anchor: { orderId: AWAITING, medicationName: 'Semaglutide', retailPrice: 231, createdAt: '2026-09-18T10:00:00.000Z', pharmacyId: null, shippingType: 'standard', wholesalePrice: 95 },
      siblings: [{ orderId: 'sib-bpc', medicationName: 'BPC-157', retailPrice: 130, createdAt: '2026-09-18T10:00:01.000Z', pharmacyId: null, shippingType: 'standard', wholesalePrice: 65 }],
    })
  }
  if (url === `/api/orders/${GROUPED}/group-link`) {
    if (groupLinkFails > 0) {
      groupLinkFails--
      return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ error: 'x' }) })
    }
    return new Promise(resolve => {
      resolveGroupLink = () => resolve({ ok: true, status: 200, json: () => Promise.resolve({ checkoutUrl: 'https://pay.test/g', orderCount: 2, totalCents: 36100 }) })
    })
  }
  return ok({})
})

beforeAll(() => { global.fetch = fetchMock as unknown as typeof fetch })
beforeEach(() => { fetchMock.mockClear(); groupLinkFails = 0; resolveGroupLink = null })

const drawer = (order: DashboardOrder | null) => <OrderDrawer order={order} onClose={() => {}} onGroupCreated={() => {}} />
const calledWith = (suffix: string) => fetchMock.mock.calls.some(([u]) => u.endsWith(suffix))

it('switching from a failed order to an awaiting-payment one clears the failure line and the record, then loads the new order', async () => {
  const { rerender } = render(drawer(failedOrder))
  await screen.findByTestId('submission-failure')
  await screen.findByTestId('drawer-shipping')
  expect(calledWith(`/api/orders/${FAILED}/bundlable-siblings`)).toBe(false)

  rerender(drawer(awaitingOrder))
  expect(screen.queryByTestId('submission-failure')).not.toBeInTheDocument()
  expect(screen.queryByTestId('drawer-shipping')).not.toBeInTheDocument()
  await screen.findByRole('checkbox', { name: /BPC-157/ })
  expect(calledWith(`/api/orders/${AWAITING}/record`)).toBe(true)
})

it('the sibling picker does not follow the drawer to the next order', async () => {
  const { rerender } = render(drawer(awaitingOrder))
  await screen.findByRole('checkbox', { name: /BPC-157/ })
  rerender(drawer(pendingRecordOrder))
  // The new order's probe has not answered yet: no picker from the previous order.
  expect(screen.queryByRole('checkbox', { name: /BPC-157/ })).not.toBeInTheDocument()
  await screen.findByRole('checkbox', { name: /BPC-157/ })
})

it('a grouped order: "Loading bundle details" until the group link arrives, then its count and total', async () => {
  render(drawer(groupedOrder))
  expect(await screen.findByText('Loading bundle details…')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Copy Bundle Payment Link' })).toBeDisabled()
  await act(async () => { resolveGroupLink?.() })
  await screen.findByText(/^2 prescriptions · \$361\.00\./)
  expect(screen.getByRole('button', { name: 'Copy Bundle Payment Link' })).toBeEnabled()
  expect(calledWith(`/api/orders/${GROUPED}/bundlable-siblings`)).toBe(false)
})

it('leaving a grouped order clears its bundle details', async () => {
  const { rerender } = render(drawer(groupedOrder))
  await act(async () => { resolveGroupLink?.() })
  await screen.findByText(/^2 prescriptions/)
  rerender(drawer(awaitingOrder))
  expect(screen.queryByText(/^2 prescriptions/)).not.toBeInTheDocument()
  expect(screen.queryByText('Loading bundle details…')).not.toBeInTheDocument()
  expect(screen.getByText('Ready for Patient Payment')).toBeInTheDocument()
})

it('Copy Bundle Payment Link re-fetches the group link when the load on open failed', async () => {
  groupLinkFails = 1
  const writeText = jest.fn(() => Promise.resolve())
  Object.assign(navigator, { clipboard: { writeText } })
  render(drawer(groupedOrder))
  await screen.findByText('The patient pays once for all bundled prescriptions.')
  const button = screen.getByRole('button', { name: 'Copy Bundle Payment Link' })
  await waitFor(() => expect(button).toBeEnabled())
  fireEvent.click(button)
  await waitFor(() => expect(resolveGroupLink).not.toBeNull())
  await act(async () => { resolveGroupLink?.() })
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://pay.test/g'))
  expect(fetchMock.mock.calls.filter(([u]) => u === `/api/orders/${GROUPED}/group-link`)).toHaveLength(2)
})

it('closing the drawer and opening another order shows only that order', async () => {
  const { rerender } = render(drawer(failedOrder))
  await screen.findByTestId('submission-failure')
  rerender(drawer(null))
  rerender(drawer(awaitingOrder))
  expect(screen.queryByTestId('submission-failure')).not.toBeInTheDocument()
  await screen.findByRole('checkbox', { name: /BPC-157/ })
})
