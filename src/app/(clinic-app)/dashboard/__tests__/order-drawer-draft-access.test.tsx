/**
 * WO-98 × WO-100 — draft actions in the order drawer depend on who is looking.
 *
 * Rule: a provider who is not the draft's provider must reassign the
 * draft via Sign as me before editing it or adding lines. So, on a DRAFT:
 *
 *   - provider viewing ANOTHER provider's draft → one "Sign as me to edit"
 *     action (opens the Sign as me panel on the sign page); no Edit, no
 *     + Add prescription
 *   - provider whose login is not linked to a provider row → same (the
 *     sign page explains the problem)
 *   - provider viewing their OWN draft → Edit prescription + Add prescription
 *   - medical assistant / clinic admin → Edit prescription + Add
 *     prescription regardless of the draft's provider (unchanged)
 *   - no viewer passed (older callers) → WO-98 behaviour
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { OrderDrawer } from '../_components/order-drawer'
import type { DashboardOrder } from '../page'
import type { DraftViewer } from '@/lib/orders/draft-edit-access'
import { draftEditMode } from '@/lib/orders/draft-edit-access'

const pushMock = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn(), push: pushMock }),
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

const ORDER_ID  = '11111111-1111-4111-8111-111111111111'
const DR_PATEL  = '22222222-2222-4222-8222-222222222222'
const DR_CHEN   = '33333333-3333-4333-8333-333333333333'

const draft: DashboardOrder = {
  orderId:           ORDER_ID,
  patientName:       'Demo, Alex',
  medicationName:    'Semaglutide 5mg/mL Injectable',
  status:            'DRAFT',
  submissionTier:    null,
  createdAt:         '2026-09-13T12:00:00.000Z',
  updatedAt:         '2026-09-13T12:00:00.000Z',
  retailCents:       19000,
  wholesaleCents:    9500,
  platformFeeCents:  1425,
  clinicPayoutCents: 8075,
  isOverdue48h:      false,
  paymentGroupId:    null,
  providerId:        DR_PATEL,
}

beforeAll(() => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({}) }) as unknown as typeof fetch
})

beforeEach(() => {
  jest.clearAllMocks()
})

function renderDrawer(viewer?: DraftViewer, order: DashboardOrder = draft) {
  const onClose = jest.fn()
  render(<OrderDrawer order={order} onClose={onClose} onGroupCreated={jest.fn()} viewer={viewer} />)
  return { onClose }
}

describe('OrderDrawer — draft actions by viewer (WO-98 × WO-100)', () => {
  it("provider viewing another provider's draft sees only 'Sign as me to edit', which opens the Sign as me panel", async () => {
    const { onClose } = renderDrawer({ isProvider: true, providerId: DR_CHEN })

    const signAsMe = await screen.findByRole('button', { name: 'Sign as me to edit' })
    expect(screen.queryByRole('button', { name: 'Edit prescription' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '+ Add prescription' })).not.toBeInTheDocument()
    // The primary Review & Sign CTA stays.
    expect(screen.getByRole('button', { name: 'Review & Sign This Prescription' })).toBeInTheDocument()

    fireEvent.click(signAsMe)
    expect(onClose).toHaveBeenCalled()
    // The sign page renders SignAsMePanel when the draft is not the caller's.
    expect(pushMock).toHaveBeenCalledWith(`/new-prescription/sign/${ORDER_ID}`)
  })

  it('a provider login not linked to a provider row is routed to Sign as me too', async () => {
    renderDrawer({ isProvider: true, providerId: null })
    expect(await screen.findByRole('button', { name: 'Sign as me to edit' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit prescription' })).not.toBeInTheDocument()
  })

  it('provider viewing their own draft keeps Edit prescription and + Add prescription', async () => {
    renderDrawer({ isProvider: true, providerId: DR_PATEL })

    fireEvent.click(await screen.findByRole('button', { name: 'Edit prescription' }))
    expect(pushMock).toHaveBeenCalledWith(`/new-prescription/search?editOrder=${ORDER_ID}`)
    fireEvent.click(screen.getByRole('button', { name: '+ Add prescription' }))
    expect(pushMock).toHaveBeenCalledWith(`/new-prescription/search?addToOrder=${ORDER_ID}`)
    expect(screen.queryByRole('button', { name: 'Sign as me to edit' })).not.toBeInTheDocument()
  })

  it('medical assistant / clinic admin behaviour is unchanged for any provider’s draft', async () => {
    renderDrawer({ isProvider: false, providerId: null })
    expect(await screen.findByRole('button', { name: 'Edit prescription' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ Add prescription' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign as me to edit' })).not.toBeInTheDocument()
  })

  it('without a viewer (older callers) the WO-98 actions render', async () => {
    renderDrawer(undefined)
    expect(await screen.findByRole('button', { name: 'Edit prescription' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ Add prescription' })).toBeInTheDocument()
  })

  it('non-draft orders show none of the draft actions', async () => {
    renderDrawer({ isProvider: true, providerId: DR_CHEN }, { ...draft, status: 'AWAITING_PAYMENT' })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Review & Sign This Prescription' })).not.toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Sign as me to edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit prescription' })).not.toBeInTheDocument()
  })
})

describe('draftEditMode', () => {
  it.each([
    [{ isProvider: true,  providerId: 'a' }, 'b',  'sign-as-me'],
    [{ isProvider: true,  providerId: null }, 'b', 'sign-as-me'],
    [{ isProvider: true,  providerId: 'a' }, 'a',  'edit'],
    [{ isProvider: false, providerId: null }, 'b', 'edit'],
    [null,                                    'b', 'edit'],
    [{ isProvider: true,  providerId: 'a' }, null, 'edit'],
  ] as const)('%j on draft provider %s → %s', (viewer, draftProvider, expected) => {
    expect(draftEditMode(viewer, draftProvider)).toBe(expected)
  })
})
