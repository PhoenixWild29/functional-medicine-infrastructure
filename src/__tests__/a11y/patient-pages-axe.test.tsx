/**
 * @jest-environment jsdom
 *
 * Compliance C10 (WCAG 2.1 AA): the patient-facing checkout pages and the
 * login page, every state, checked with axe. A new violation fails CI.
 *
 * jsdom cannot compute colour contrast, so axe reports contrast as
 * "incomplete" here; e2e/accessibility.spec.ts runs the same pages in a
 * real browser, contrast included. The explicit assertions below cover
 * what axe does not: names, error association and focus styles.
 */

import { render, screen, fireEvent, act, waitFor, cleanup } from '@testing-library/react'
import { configureAxe } from 'jest-axe'

// ── Mocks ────────────────────────────────────────────────────
const confirmPaymentMock = jest.fn().mockResolvedValue({ error: { type: 'card_error', code: 'card_declined' } })
jest.mock('@stripe/stripe-js', () => ({ loadStripe: () => Promise.resolve({}) }))
jest.mock('@stripe/react-stripe-js', () => ({
  Elements:       ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PaymentElement: ({ onReady }: { onReady?: () => void }) => {
    if (onReady) setTimeout(onReady, 0)
    return <div data-testid="payment-element" />
  },
  useStripe:   () => ({ confirmPayment: confirmPaymentMock }),
  useElements: () => ({}),
}))
jest.mock('@/lib/env', () => ({ clientEnv: { stripePublishableKey: 'pk_test_x' } }))

let orderRow: unknown = null
let groupRow: unknown = null
function chain(result: () => unknown) {
  const node: Record<string, unknown> = {}
  node['select']      = () => node
  node['eq']          = () => node
  node['maybeSingle'] = () => Promise.resolve({ data: result(), error: null })
  // Awaited for the member count, or .maybeSingle() after it (the order
  // lookup also filters payment_group_id IS NULL, Payment Flow v1.1).
  node['is']          = () => Object.assign(Promise.resolve({ count: 2, error: null }), { maybeSingle: node['maybeSingle'] })
  return node
}
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => chain(() => (table === 'orders' ? orderRow : table === 'payment_groups' ? groupRow : null)),
  }),
}))

const signInMock = jest.fn().mockResolvedValue({ data: { session: null, user: null }, error: { message: 'bad' } })
jest.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({ auth: { signInWithPassword: signInMock } }),
}))
let searchParams = new URLSearchParams()
jest.mock('next/navigation', () => ({
  useRouter:       () => ({ push: jest.fn(), refresh: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => searchParams,
}))

import { CheckoutPageContent } from '@/app/checkout/[token]/_components/checkout-page-content'
import CheckoutSuccessPage from '@/app/checkout/success/page'
import CheckoutExpiredPage from '@/app/checkout/expired/page'
import LoginPage from '@/app/login/page'

// WCAG 2.0/2.1 A and AA, plus best practices (one h1, landmarks).
const axe = configureAxe({
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
  rules: { region: { enabled: true } },
})

async function violations(): Promise<string[]> {
  const results = await axe(document.body)
  return results.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)
}

function renderCheckout(state: 'active' | 'paid' | 'cancelled_expired', smsConsent = true) {
  return render(
    <CheckoutPageContent
      token="tok" kind="solo" orderCount={1} retailCents={20000} subtotalCents={18000} shippingCents={2000}
      clinicName="Test Clinic" logoUrl={null} checkoutState={state} smsConsent={smsConsent}
    />,
    { container: document.body.appendChild(document.createElement('div')) },
  )
}

async function renderSuccess(params: { payment_intent?: string; redirect_status?: string }) {
  const ui = await CheckoutSuccessPage({ searchParams: Promise.resolve(params) })
  render(ui)
}

const SOLO_ORDER = {
  order_id: 'o1234567890', retail_price_snapshot: 200, shipping_fee: 0, clinic_id: 'c1',
  clinics: { name: 'Test Clinic', absorb_shipping: false, contact_phone: '+15125550100', contact_email: 'care@clinic.test' },
  patients: { sms_opt_in: true },
  pharmacies: { supports_real_time_status: true, average_turnaround_days: null },
}

const fetchMock = jest.fn()
beforeEach(() => {
  orderRow = null
  groupRow = null
  searchParams = new URLSearchParams()
  confirmPaymentMock.mockClear()
  fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({ clientSecret: 'cs_test' }) })
  global.fetch = fetchMock as unknown as typeof fetch
})
afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

// ── /checkout/[token] ────────────────────────────────────────
describe('/checkout/[token]', () => {
  it('open: no axe violations', async () => {
    renderCheckout('active')
    await screen.findByTestId('payment-element')
    expect(await violations()).toEqual([])
  })

  it('open: has one h1, and the Stripe Payment Element sits in a named group', async () => {
    renderCheckout('active')
    await screen.findByTestId('payment-element')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    const group = screen.getByRole('group', { name: 'Payment details' })
    expect(group).toContainElement(screen.getByTestId('payment-element'))
  })

  it('open: the email field is described by its help text', async () => {
    renderCheckout('active')
    const email = await screen.findByLabelText('Email (optional)')
    expect(email).toHaveAccessibleDescription('We’ll text you to confirm your payment and when your order ships.')
  })

  it('open, no SMS consent: no help text, so the email field points at nothing missing', async () => {
    renderCheckout('active', false)
    const email = await screen.findByLabelText('Email (optional)')
    expect(email).not.toHaveAttribute('aria-describedby')
    expect(await violations()).toEqual([])
  })

  it('open: the amount due is read with its label', async () => {
    renderCheckout('active')
    await screen.findByTestId('payment-element')
    expect(screen.getByTestId('checkout-amount-due')).toHaveTextContent(/Amount due/)
    expect(screen.getByTestId('checkout-amount-due')).toHaveTextContent('$200.00')
  })

  it('open: a declined card is announced and the email field is not blamed', async () => {
    renderCheckout('active')
    await screen.findByTestId('payment-element')
    const pay = await screen.findByRole('button', { name: /Pay/ })
    await act(async () => { fireEvent.submit(pay.closest('form')!) })
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Your card was declined.')
    expect(screen.getByLabelText('Email (optional)')).not.toHaveAttribute('aria-invalid', 'true')
    expect(await violations()).toEqual([])
  })

  it('open: a rejected email is announced and tied to the email field', async () => {
    renderCheckout('active')
    await screen.findByTestId('payment-element')
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Please enter a valid email address.' }) })
    fireEvent.change(screen.getByLabelText('Email (optional)'), { target: { value: 'x@y.invalid' } })
    await act(async () => { fireEvent.submit(screen.getByRole('button', { name: /Pay/ }).closest('form')!) })
    expect(await screen.findByRole('alert')).toHaveTextContent('Please enter a valid email address.')
    const email = screen.getByLabelText('Email (optional)')
    expect(email).toHaveAttribute('aria-invalid', 'true')
    expect(email).toHaveAccessibleDescription(/Please enter a valid email address\./)
    expect(await violations()).toEqual([])
  })

  it('error (payment form could not load): announced, no axe violations', async () => {
    fetchMock.mockReset().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'boom' }) })
    jest.spyOn(console, 'error').mockImplementation(() => {})
    renderCheckout('active')
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load the payment form')
    expect(await violations()).toEqual([])
  })

  it('loading: the skeleton is a named status', async () => {
    fetchMock.mockReset().mockReturnValue(new Promise(() => {}))
    renderCheckout('active')
    expect(screen.getByRole('status', { name: 'Loading payment form' })).toBeInTheDocument()
    expect(await violations()).toEqual([])
  })

  it('paid: no axe violations, one h1', async () => {
    renderCheckout('paid')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(await violations()).toEqual([])
  })

  it('cancelled or expired order: no axe violations, one h1', async () => {
    renderCheckout('cancelled_expired')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(await violations()).toEqual([])
  })
})

// ── /checkout/expired ────────────────────────────────────────
describe('/checkout/expired', () => {
  it('no axe violations', async () => {
    render(<CheckoutExpiredPage />)
    expect(await violations()).toEqual([])
  })
})

// ── /checkout/success ────────────────────────────────────────
describe('/checkout/success', () => {
  it('paid (solo): no axe violations; no faded text; sections are headed', async () => {
    orderRow = SOLO_ORDER
    await renderSuccess({ payment_intent: 'pi_1', redirect_status: 'succeeded' })
    expect(await violations()).toEqual([])
    expect(screen.getByRole('heading', { level: 2, name: /What happens next/i })).toBeInTheDocument()
    // Reduced-opacity muted text measured about 2.3:1 on white (AA needs 4.5:1).
    expect(document.body.innerHTML).not.toMatch(/text-muted-foreground\/\d+/)
  })

  it('paid (bundle): no axe violations', async () => {
    groupRow = { group_id: 'g1234567890', total_cents: 40000, clinic_id: 'c1', clinics: { name: 'Test Clinic', contact_phone: null, contact_email: null } }
    await renderSuccess({ payment_intent: 'pi_1', redirect_status: 'succeeded' })
    expect(await violations()).toEqual([])
    expect(document.body.innerHTML).not.toMatch(/text-muted-foreground\/\d+/)
  })

  it('pending confirmation: no axe violations', async () => {
    await renderSuccess({ payment_intent: 'pi_unknown', redirect_status: 'succeeded' })
    expect(await violations()).toEqual([])
  })

  it('payment unsuccessful: no axe violations', async () => {
    await renderSuccess({ payment_intent: 'pi_1', redirect_status: 'failed' })
    expect(await violations()).toEqual([])
  })
})

// ── /login ───────────────────────────────────────────────────
describe('/login', () => {
  it('no axe violations; one main landmark and one h1 a screen reader can reach', async () => {
    render(<LoginPage />)
    await screen.findByLabelText('Email address')
    expect(await violations()).toEqual([])
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('a failed sign-in is announced and tied to both fields', async () => {
    render(<LoginPage />)
    fireEvent.change(await screen.findByLabelText('Email address'), { target: { value: 'a@b.test' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } })
    await act(async () => { fireEvent.submit(screen.getByRole('button', { name: 'Sign in' }).closest('form')!) })
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Invalid email or password.')
    for (const label of ['Email address', 'Password']) {
      const input = screen.getByLabelText(label)
      expect(input).toHaveAttribute('aria-invalid', 'true')
      expect(input).toHaveAccessibleDescription(/Invalid email or password\./)
    }
    await waitFor(async () => expect(await violations()).toEqual([]))
  })

  it('the error from the auth callback is announced and the error text has enough contrast', async () => {
    searchParams = new URLSearchParams('error=auth_callback_failed')
    render(<LoginPage />)
    const alert = await screen.findByRole('alert')
    // text-destructive (red-500 on red-500/10) measured about 3.3:1; AA needs 4.5:1.
    expect(alert.className).not.toMatch(/\btext-destructive\b/)
    expect(await violations()).toEqual([])
  })

  it('inputs and the button show a visible focus indicator and a 3:1 border', async () => {
    render(<LoginPage />)
    for (const label of ['Email address', 'Password']) {
      const input = await screen.findByLabelText(label)
      // border-input (#E2E8F0) is 1.2:1 on white; WCAG 1.4.11 needs 3:1.
      expect(input.className).not.toMatch(/\bborder-input\b/)
    }
    expect(screen.getByRole('button', { name: 'Sign in' }).className).toMatch(/focus-visible:ring-2/)
  })
})
