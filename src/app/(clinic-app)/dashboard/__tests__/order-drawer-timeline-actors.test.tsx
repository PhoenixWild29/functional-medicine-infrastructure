/**
 * WO-96 fix (item 7): the drawer's "Draft edited" timeline entry names the
 * actor instead of printing a raw auth user id; the id shows only when no
 * name resolves.
 */

import { render, screen } from '@testing-library/react'
import { OrderDrawer } from '../_components/order-drawer'
import type { DashboardOrder } from '../page'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }),
}))
jest.mock('@/lib/notifications', () => ({
  notify: { success: jest.fn(), error: jest.fn() },
}))

const CHEN_UID = '11111111-1111-4111-8111-111111111111'
const UNKNOWN_UID = '99999999-9999-4999-8999-999999999999'

const HISTORY = [
  { old_status: 'DRAFT', new_status: 'DRAFT', changed_by: CHEN_UID, created_at: '2026-09-13T12:00:00.000Z',
    metadata: { event: 'draft_edited', diff: { 'medication_snapshot.prescribed_dose': { from: '10 units', to: '15 units' } } } },
  { old_status: 'DRAFT', new_status: 'DRAFT', changed_by: UNKNOWN_UID, created_at: '2026-09-13T12:05:00.000Z',
    metadata: { event: 'draft_line_removed' } },
]

jest.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            then: (resolve: (result: { data: unknown[] }) => void) => resolve({ data: HISTORY }),
          }),
        }),
      }),
    }),
  }),
}))

const draft: DashboardOrder = {
  orderId:           'a6000000-0000-0000-0000-000000000001',
  patientName:       'Demo, Alex',
  medicationName:    'Semaglutide 5mg/mL Injectable',
  status:            'DRAFT',
  submissionTier:    null,
  createdAt:         '2026-09-13T11:00:00.000Z',
  updatedAt:         '2026-09-13T12:05:00.000Z',
  retailCents:       19000,
  wholesaleCents:    9500,
  platformFeeCents:  1425,
  clinicPayoutCents: 8075,
  isOverdue48h:      false,
  paymentGroupId:    null,
  providerId:        'prov-chen',
}

it('renders "Draft edited · Sarah Chen" and falls back to the id for an unresolved actor', async () => {
  const fetchMock = jest.fn((url: string) => {
    if (url.endsWith('/timeline-actors')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ actors: { [CHEN_UID]: { name: 'Sarah Chen', role: 'provider' } } }),
      })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  })
  global.fetch = fetchMock as unknown as typeof fetch

  render(<OrderDrawer order={draft} onClose={jest.fn()} onGroupCreated={jest.fn()} />)

  expect(await screen.findByText(/changed dose · Sarah Chen/)).toBeInTheDocument()
  expect(screen.queryByText(new RegExp(CHEN_UID))).not.toBeInTheDocument()
  expect(screen.getByText(new RegExp(`still a draft · ${UNKNOWN_UID}`))).toBeInTheDocument()
  expect(fetchMock).toHaveBeenCalledWith(`/api/orders/${draft.orderId}/timeline-actors`)
})
