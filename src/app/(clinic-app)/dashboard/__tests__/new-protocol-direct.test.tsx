/**
 * Lauren, 18 Oct: "+ New Protocol" only opened New Prescription. It now
 * opens protocol creation directly (/protocols/new, no patient), coming
 * back to the dashboard, where "Protocol saved" is shown.
 */

import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { OrdersDashboard } from '../_components/orders-dashboard'
import { ProtocolSavedNotice } from '../_components/protocol-saved-notice'

const mockPush = jest.fn()
const mockReplace = jest.fn()
let mockSearch = new URLSearchParams()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, refresh: jest.fn() }),
  useSearchParams: () => mockSearch,
  usePathname: () => '/dashboard',
}))
jest.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ is: () => ({ order: () => Promise.resolve({ data: null, error: { message: 'offline in test' } }) }) }) }) }),
  }),
}))

beforeEach(() => { mockPush.mockClear(); mockReplace.mockClear(); mockSearch = new URLSearchParams() })

it('+ New Protocol opens protocol creation, with no patient step', () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  render(<QueryClientProvider client={queryClient}><OrdersDashboard initialOrders={[]} stripeConnectStatus="ACTIVE" clinicId="c-1" /></QueryClientProvider>)
  fireEvent.click(screen.getByRole('button', { name: '+ New Protocol' }))
  expect(mockPush).toHaveBeenCalledWith('/protocols/new?from=%2Fdashboard')
})

it('after a save the dashboard says "Protocol saved" with its name, and can be dismissed', () => {
  mockSearch = new URLSearchParams('protocolSaved=Weight%20loss%20starter&tab=all')
  render(<ProtocolSavedNotice />)
  const status = screen.getByRole('status')
  expect(status).toHaveTextContent('Protocol saved: Weight loss starter. It is in your Protocols list on New Prescription.')
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
  expect(mockReplace).toHaveBeenCalledWith('/dashboard?tab=all', { scroll: false })
})

it('no notice without ?protocolSaved', () => {
  render(<ProtocolSavedNotice />)
  expect(screen.queryByRole('status')).toBeNull()
})
