/**
 * The patient record (order drawer) shows "Changes from EHR" for the
 * order's patient, loaded from /api/patients/[patientId]/ehr-changes. No
 * patient on the order: nothing is asked for.
 */

import { render, screen, waitFor } from '@testing-library/react'
import { OrderDrawer } from '../_components/order-drawer'
import type { DashboardOrder } from '../page'

jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }) }))
jest.mock('@/lib/notifications', () => ({ notify: { success: jest.fn(), error: jest.fn() } }))
jest.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ order: () => ({ then: (resolve: (r: { data: never[] }) => void) => resolve({ data: [] }) }) }) }) }),
  }),
}))

const PATIENT = 'a1000000-0000-4000-8000-000000000001'
const order: DashboardOrder = {
  orderId: '45e03578-e208-468d-a35b-ab9bc82320ae', patientName: 'Demo, Alex', patientId: PATIENT,
  medicationName: 'Semaglutide Injectable 5 mg/mL', status: 'AWAITING_PAYMENT', submissionTier: 'TIER_4_FAX',
  createdAt: '2026-09-18T10:00:00.000Z', updatedAt: '2026-09-18T10:00:00.000Z',
  retailCents: 23100, wholesaleCents: 9500, platformFeeCents: 2040, clinicPayoutCents: 11560, isOverdue48h: false, paymentGroupId: null,
}

const fetchMock = jest.fn(async (url: string) => {
  if (url.endsWith('/ehr-changes')) {
    return { ok: true, status: 200, json: async () => ({ changes: [{ changeId: 'c1', field: 'city', ourValue: 'Round Rock', ehrValue: 'Austin', applied: false, changedAt: '2026-10-12T15:00:00Z' }] }) }
  }
  return { ok: false, status: 404, json: async () => ({}) }
})
beforeAll(() => { global.fetch = fetchMock as unknown as typeof fetch })
beforeEach(() => fetchMock.mockClear())

it('shows Changes from EHR for the order\'s patient', async () => {
  render(<OrderDrawer order={order} onClose={() => {}} onGroupCreated={() => {}} />)
  expect(await screen.findByRole('region', { name: 'Changes from EHR' })).toHaveTextContent('Kept (patient entered)')
  expect(fetchMock).toHaveBeenCalledWith(`/api/patients/${PATIENT}/ehr-changes`, expect.anything())
})

it('no patient on the order: nothing is asked for', async () => {
  render(<OrderDrawer order={{ ...order, patientId: null }} onClose={() => {}} onGroupCreated={() => {}} />)
  await waitFor(() => expect(fetchMock).toHaveBeenCalled())
  expect(fetchMock.mock.calls.map(c => String(c[0])).some(u => u.includes('/ehr-changes'))).toBe(false)
  expect(screen.queryByRole('region', { name: 'Changes from EHR' })).toBeNull()
})
