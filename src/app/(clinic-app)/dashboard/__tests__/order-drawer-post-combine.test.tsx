/**
 * QA post-combine fix — drawer state after "Combine and Copy Payment Link".
 *
 * Bug: after a successful combine, the drawer kept showing the solo
 * "Copy Payment Link" button (dead for grouped orders — the server 409s
 * it) because the parent's selectedOrder snapshot was never updated with
 * the new payment_group_id. The fix threads an onGroupCreated callback
 * from the drawer to the dashboard, which patches the polling cache so
 * the drawer's `order` prop gains paymentGroupId immediately.
 *
 * These tests pin the drawer's side of that contract:
 *   1. combine success calls onGroupCreated(groupId, [anchor, ...siblings])
 *   2. it fires even when the clipboard write fails (group exists anyway)
 *   3. when the order prop gains paymentGroupId (parent cache patch), the
 *      solo block unmounts and the bundle block renders
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { OrderDrawer } from '../_components/order-drawer'
import type { DashboardOrder } from '../page'

const refreshMock = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock, push: jest.fn() }),
}))

jest.mock('@/lib/notifications', () => ({
  notify: { success: jest.fn(), error: jest.fn() },
}))

// Thenable chain stub for the status-history query in the drawer's effect.
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

const ANCHOR_ID  = '11111111-1111-4111-8111-111111111111'
const SIBLING_ID = '22222222-2222-4222-8222-222222222222'
const GROUP_ID   = '33333333-3333-4333-8333-333333333333'

const baseOrder: DashboardOrder = {
  orderId:           ANCHOR_ID,
  patientName:       'Doe, Jane',
  medicationName:    'LDN 4.5mg Capsules',
  status:            'AWAITING_PAYMENT',
  submissionTier:    null,
  createdAt:         '2026-08-15T12:00:00.000Z',
  updatedAt:         '2026-08-15T12:00:00.000Z',
  retailCents:       5000,
  wholesaleCents:    2000,
  platformFeeCents:  450,
  clinicPayoutCents: 2550,
  isOverdue48h:      false,
  paymentGroupId:    null,
}

const fetchMock = jest.fn()
const writeTextMock = jest.fn()

beforeAll(() => {
  global.fetch = fetchMock as unknown as typeof fetch
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: writeTextMock },
    configurable: true,
  })
})

beforeEach(() => {
  jest.clearAllMocks()
  writeTextMock.mockResolvedValue(undefined)
  fetchMock.mockImplementation((url: string) => {
    if (url.includes('/bundlable-siblings')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          anchorBundlable: true,
          siblings: [{
            orderId:        SIBLING_ID,
            medicationName: 'B12 Injection',
            retailPrice:    25,
            createdAt:      '2026-08-15T11:00:00.000Z',
          }],
        }),
      })
    }
    if (url.includes('/group-and-send')) {
      return Promise.resolve({
        ok: true,
        status: 201,
        json: () => Promise.resolve({
          checkoutUrl:           'https://example.test/checkout/tok',
          expiresAt:             '2026-08-18T12:00:00.000Z',
          groupId:               GROUP_ID,
          stripePaymentIntentId: 'pi_test',
          totalCents:            7500,
          orderCount:            2,
        }),
      })
    }
    if (url.includes('/group-link')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          checkoutUrl: 'https://example.test/checkout/tok',
          orderCount:  2,
          totalCents:  7500,
        }),
      })
    }
    throw new Error(`Unexpected fetch: ${url}`)
  })
})

async function combineViaPicker(onGroupCreated: jest.Mock) {
  render(<OrderDrawer order={baseOrder} onClose={jest.fn()} onGroupCreated={onGroupCreated} />)

  // Sibling picker appears after the bundlable-siblings probe resolves.
  await screen.findByText('Combine into one payment link')
  fireEvent.click(screen.getByRole('button', { name: 'Combine and Copy Payment Link' }))

  await waitFor(() => expect(onGroupCreated).toHaveBeenCalled())
}

describe('<OrderDrawer /> post-combine group state', () => {
  it('combine success reports the groupId and ALL member order ids to the parent', async () => {
    const onGroupCreated = jest.fn()
    await combineViaPicker(onGroupCreated)

    expect(onGroupCreated).toHaveBeenCalledTimes(1)
    expect(onGroupCreated).toHaveBeenCalledWith(GROUP_ID, [ANCHOR_ID, SIBLING_ID])
  })

  it('still reports the group when the clipboard write fails (group exists server-side)', async () => {
    writeTextMock.mockRejectedValue(new Error('clipboard blocked'))
    const onGroupCreated = jest.fn()
    await combineViaPicker(onGroupCreated)

    expect(onGroupCreated).toHaveBeenCalledWith(GROUP_ID, [ANCHOR_ID, SIBLING_ID])
    // Manual-copy fallback still offered.
    await screen.findByText('Copy the bundle link manually')
  })

  it('swaps the solo block for the bundle block when the order gains paymentGroupId', async () => {
    const onGroupCreated = jest.fn()
    const { rerender } = render(
      <OrderDrawer order={baseOrder} onClose={jest.fn()} onGroupCreated={onGroupCreated} />,
    )
    expect(await screen.findByRole('button', { name: 'Copy Payment Link' })).toBeInTheDocument()
    expect(screen.queryByText('Part of a Payment Bundle')).not.toBeInTheDocument()

    // Simulate the parent's post-combine cache patch flowing back down.
    rerender(
      <OrderDrawer
        order={{ ...baseOrder, paymentGroupId: GROUP_ID }}
        onClose={jest.fn()}
        onGroupCreated={onGroupCreated}
      />,
    )

    expect(screen.getByText('Part of a Payment Bundle')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy Bundle Payment Link' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy Payment Link' })).not.toBeInTheDocument()
  })
})
