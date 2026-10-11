/**
 * Clinics onboarded through the portal: payouts are set up at launch, so
 * the dashboard does not send them to Stripe onboarding. The New
 * Prescription button stays disabled until payouts are active.
 *
 * Existing clinics (not onboarded through the portal) see exactly what
 * they see today.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { OrdersDashboard } from '../_components/orders-dashboard'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/dashboard',
}))
jest.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ is: () => ({ order: () => new Promise(() => {}) }) }) }) }),
  }),
}))

const CLINIC = 'c0000000-0000-4000-8000-000000000001'
const LAUNCH = 'Ordering opens at launch, once payouts are set up. CompoundIQ will contact you.'

function renderDashboard(payoutsAtLaunch: boolean | undefined, status: 'PENDING' | 'ACTIVE' = 'PENDING') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <OrdersDashboard initialOrders={[]} stripeConnectStatus={status} clinicId={CLINIC} initialTab="all" {...(payoutsAtLaunch === undefined ? {} : { payoutsAtLaunch })} />
    </QueryClientProvider>,
  )
}

describe('portal-onboarded clinic, payouts not active yet', () => {
  it('the New Prescription note and the empty state say ordering opens at launch; no Stripe wording', () => {
    renderDashboard(true)
    expect(screen.getByRole('tooltip')).toHaveTextContent(LAUNCH)
    expect(screen.getAllByText(LAUNCH)).toHaveLength(2)
    expect(document.body.textContent).not.toMatch(/Stripe onboarding/i)
  })

  it('New Prescription stays disabled', () => {
    renderDashboard(true)
    expect(screen.getByRole('button', { name: '+ New Prescription' })).toBeDisabled()
  })
})

describe('existing clinic, payouts not active', () => {
  it.each([false, undefined])('payoutsAtLaunch=%s: today\'s Stripe wording, unchanged', (flag) => {
    renderDashboard(flag)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Stripe onboarding required. Complete setup in Settings.')
    expect(document.body.textContent).toContain('Complete Stripe onboarding in Settings to enable order creation.')
    expect(screen.queryByText(LAUNCH)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ New Prescription' })).toBeDisabled()
  })
})

it('once payouts are active, a portal clinic sees the same dashboard as any other', () => {
  renderDashboard(true, 'ACTIVE')
  expect(screen.queryByText(LAUNCH)).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '+ New Prescription' })).toBeEnabled()
})

it('the dashboard page decides it on the server, from the clinic in the claims', () => {
  const page = readFileSync(join(process.cwd(), 'src/app/(clinic-app)/dashboard/page.tsx'), 'utf8')
  expect(page).toMatch(/isPortalOnboardedClinic\(\s*createServiceClient\(\),\s*clinicId\s*\)/)
  expect(page).toMatch(/payoutsAtLaunch=\{payoutsAtLaunch\}/)
  expect(page).toMatch(/getUserClinicId\(user\)/)
})
