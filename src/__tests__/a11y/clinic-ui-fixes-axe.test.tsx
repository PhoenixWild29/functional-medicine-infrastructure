/**
 * @jest-environment jsdom
 *
 * Click-through fixes, 14 Oct: axe (WCAG 2.0/2.1 A and AA, best practice)
 * on every view the fixes touched, in the states they added:
 *   - dashboard: KPI cards; the orders list with the month-to-date chip,
 *     the Pending Payment "N expired" badge, an empty tab, a row with
 *     "No refills left", and the order drawer open;
 *   - Practice with the Custom date fields and Cancel;
 *   - the Settings side nav with a marked section;
 *   - the refill picker with a titration line;
 *   - the sidebar's icon-only Sign out;
 *   - the patient import page with Back to Settings.
 * jsdom cannot compute colour contrast; the new colour pairs are the
 * existing ones (amber-800 on amber-100, text-foreground on bg-muted).
 */

import { render, screen, cleanup } from '@testing-library/react'
import { configureAxe } from 'jest-axe'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { OrdersDashboard } from '@/app/(clinic-app)/dashboard/_components/orders-dashboard'
import { RevenueSummary } from '@/app/(clinic-app)/dashboard/_components/revenue-summary'
import { OrderDrawer } from '@/app/(clinic-app)/dashboard/_components/order-drawer'
import { PracticeDashboard } from '@/app/(clinic-app)/practice/_components/practice-dashboard'
import { SettingsSectionNav } from '@/app/(clinic-app)/settings/_components/settings-section-nav'
import { RefillPicker } from '@/app/(clinic-app)/refill/_components/refill-picker'
import { PrescriptionSessionProvider } from '@/app/(clinic-app)/new-prescription/_context/prescription-session'
import { SidebarNav } from '@/components/sidebar-nav'
import ImportPatientsPage from '@/app/(clinic-app)/settings/patients/import/page'
import type { DashboardOrder } from '@/app/(clinic-app)/dashboard/page'

let mockSearch = new URLSearchParams()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => mockSearch,
  usePathname: () => '/dashboard',
}))
jest.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({
    auth: { signOut: jest.fn() },
    from: () => ({
      select: () => ({
        eq: () => ({
          is: () => ({ order: () => Promise.resolve({ data: null, error: { message: 'offline in test' } }) }),
          order: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }),
  }),
}))
jest.mock('@/lib/auth/redirect-to-login', () => ({ redirectToLogin: jest.fn() }))
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u', app_metadata: { app_role: 'clinic_admin', clinic_id: 'c1' } } }, error: null }) } }),
}))
jest.mock('@/app/(clinic-app)/settings/patients/import/_components/import-wizard', () => ({ ImportWizard: () => <h1>Import patients</h1> }))

const axe = configureAxe({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } })
async function violations(container: Element = document.body): Promise<string[]> {
  const results = await axe(container)
  return results.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)
}

const HOUR = 60 * 60 * 1000
const ago = (h: number) => new Date(Date.now() - h * HOUR).toISOString()
const order = (id: string, over: Partial<DashboardOrder> = {}): DashboardOrder => ({
  orderId: `d1000000-0000-0000-0000-00000000000${id}`, patientName: `Demo, ${id}`, medicationName: `Med ${id}`, status: 'DELIVERED',
  submissionTier: 'TIER_4_FAX', createdAt: ago(2), updatedAt: ago(2), retailCents: 100, wholesaleCents: 50, platformFeeCents: 7, clinicPayoutCents: 43,
  isOverdue48h: false, paymentGroupId: null, providerId: 'p', refills: 1, refillOfOrderId: null, ...over,
})
const ORDERS = [
  order('1'), order('2', { refills: 0 }),
  order('3', { status: 'PAYMENT_EXPIRED', lockedAt: ago(200), createdAt: ago(200) }),
]

beforeEach(() => {
  global.fetch = jest.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })) as unknown as typeof fetch
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { cleanup(); jest.restoreAllMocks() })

function dashboard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(<QueryClientProvider client={queryClient}><main><OrdersDashboard initialOrders={ORDERS} stripeConnectStatus="ACTIVE" clinicId="c-1" /></main></QueryClientProvider>)
}

describe('dashboard', () => {
  it('KPI cards', async () => {
    const { container } = render(<main><RevenueSummary totalOrdersMtd={1} totalRevenueCents={100} pendingPaymentCount={0} expiredPaymentCount={1} shippedMtd={1} priorYearOrdersMtd={0} priorYearRevenueCents={0} /></main>)
    expect(await violations(container)).toEqual([])
  })

  it.each([
    ['all, month to date', 'tab=all&period=mtd'],
    ['Pending Payment with expired links', 'tab=awaiting_payment'],
    ['an empty Submitting tab', 'tab=submitting'],
  ])('orders list: %s', async (_n, query) => {
    mockSearch = new URLSearchParams(query)
    const { container } = dashboard()
    expect(await violations(container)).toEqual([])
  })

  it('the order drawer, open', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={queryClient}><main><h1>Dashboard</h1></main><OrderDrawer order={ORDERS[1]!} allOrders={ORDERS} onClose={() => {}} onGroupCreated={() => {}} /></QueryClientProvider>)
    expect(screen.getByTestId('drawer-no-refills')).toBeInTheDocument()
    expect(await violations()).toEqual([])
  })
})

it('Practice: Custom with the date fields and Cancel', async () => {
  const { container } = render(<main><PracticeDashboard viewerIsProvider={false} /></main>)
  screen.getByTestId('period-custom').click()
  await screen.findByRole('button', { name: 'Cancel' })
  expect(await violations(container)).toEqual([])
})

it('Settings side nav with a marked section', async () => {
  const el = document.createElement('div'); el.id = 'notifications'; document.body.appendChild(el)
  const { container } = render(<nav aria-label="Settings sections"><SettingsSectionNav items={[{ href: '#notifications', label: 'Notifications' }, { href: '/settings/agreements', label: 'Agreements' }]} /></nav>)
  expect(screen.getByRole('link', { name: 'Notifications' })).toHaveAttribute('aria-current', 'location')
  expect(await violations(container)).toEqual([])
})

it('refill picker with a titration line', async () => {
  const { container } = render(
    <PrescriptionSessionProvider>
      <main>
        <RefillPicker provider={null} preselectOrderId="o-1" patients={[{
          patient: { patient_id: 'p', first_name: 'Alex', last_name: 'Demo', date_of_birth: '1985-06-15', phone: '+15125550000', state: 'TX', sms_opt_in: true },
          orders: [{ orderId: 'o-1', medicationName: 'Semaglutide', dose: '5mg/mL', pharmacyId: 'ph', pharmacyName: 'Strive', createdAt: ago(100), status: 'DELIVERED', isTitration: true, packageLabel: null, packageCount: null, refillsUsed: 0, refillsAuthorized: 2, refillable: true, blockedReason: null }],
        }]} />
      </main>
    </PrescriptionSessionProvider>,
  )
  expect(await violations(container)).toEqual([])
})

it('patient import page with Back to Settings', async () => {
  const { container } = render(await ImportPatientsPage())
  expect(screen.getByRole('link', { name: 'Back to Settings' })).toBeInTheDocument()
  expect(await violations(container)).toEqual([])
})

it('sidebar with the icon-only Sign out', async () => {
  localStorage.setItem('sidebar-collapsed', 'true')
  const { container } = render(<SidebarNav userEmail="lauren@clinic.example" userRole="clinic_admin" />)
  // The sidebar renders an xl and an md–lg copy; a browser hides one with
  // display:none (axe skips it), jsdom applies no CSS, so both nav
  // landmarks are seen here. Not a page-level duplicate.
  const results = await configureAxe({
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
    rules: { 'landmark-unique': { enabled: false } },
  })(container)
  expect(results.violations.map(v => v.id)).toEqual([])
})
