/**
 * Empty states say what to do next, with a button (first-run coaching):
 *   - no patients (Select Patient): "Add a patient" opens the new patient form
 *   - no orders (dashboard): "New Prescription"
 *   - no protocols (Protocols panel): "Save this session as a protocol"
 *     opens the protocol form
 *   - no team (Settings > Team, clinic admin): what to do, in the shared
 *     EmptyState (no in-app add flow exists after approval yet)
 * One shared EmptyState component.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { EmptyState } from '../empty-state'
import { PrescriptionSessionProvider } from '@/app/(clinic-app)/new-prescription/_context/prescription-session'
import { PatientProviderSelector } from '@/app/(clinic-app)/new-prescription/_components/patient-provider-selector'
import { QuickActionsPanel } from '@/app/(clinic-app)/new-prescription/_components/quick-actions-panel'
import { OrdersDashboard } from '@/app/(clinic-app)/dashboard/_components/orders-dashboard'

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/dashboard',
}))
jest.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ is: () => ({ order: () => Promise.resolve({ data: null, error: { message: 'offline in test' } }) }) }) }) }),
  }),
}))

beforeEach(() => {
  mockPush.mockClear()
  sessionStorage.clear()
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => [] })) as unknown as typeof fetch
})

describe('EmptyState', () => {
  it('a title, what to do, and a link button', () => {
    render(<EmptyState title="No patients yet" body="Add your first patient." action={{ label: 'Add a patient', href: '/x' }} />)
    expect(screen.getByText('No patients yet')).toBeInTheDocument()
    expect(screen.getByText('Add your first patient.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Add a patient' })).toHaveAttribute('href', '/x')
  })
  it('or an action button', () => {
    const onClick = jest.fn()
    render(<EmptyState title="T" action={{ label: 'Do it', onClick }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Do it' }))
    expect(onClick).toHaveBeenCalled()
  })
})

it('no patients: "Add a patient" opens the new patient form', () => {
  render(<PrescriptionSessionProvider><PatientProviderSelector patients={[]} providers={[]} /></PrescriptionSessionProvider>)
  expect(screen.getByText('No patients yet')).toBeInTheDocument()
  expect(screen.getByText('Add your first patient to start a prescription.')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Add a patient' }))
  expect(screen.getByRole('button', { name: '+ New patient' })).toHaveAttribute('aria-expanded', 'true')
})

it('no orders: what to do and New Prescription', () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  render(<QueryClientProvider client={queryClient}><OrdersDashboard initialOrders={[]} stripeConnectStatus="ACTIVE" clinicId="c-1" /></QueryClientProvider>)
  expect(screen.getByText('No orders yet')).toBeInTheDocument()
  expect(screen.getByText('Choose or add a patient, then pick the medication. Your first prescription takes a few minutes.')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'New Prescription' }))
  expect(mockPush).toHaveBeenCalledWith('/new-prescription')
})

it('no protocols: "Save this session as a protocol" opens the protocol form', async () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  render(
    <QueryClientProvider client={queryClient}>
      <PrescriptionSessionProvider>
        <QuickActionsPanel onLoadFavorite={jest.fn()} initialPanel="protocols" />
      </PrescriptionSessionProvider>
    </QueryClientProvider>,
  )
  expect(await screen.findByText('No protocols yet')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Save this session as a protocol' }))
  expect(screen.getByTestId('new-protocol-form')).toBeInTheDocument()
})

it('no team: Settings > Team uses the shared empty state with what to do next', () => {
  const page = readFileSync(join(process.cwd(), 'src', 'app', '(clinic-app)', 'settings', 'team', 'page.tsx'), 'utf8')
  expect(page).toMatch(/<EmptyState/)
  expect(page).toContain('No providers yet')
})
