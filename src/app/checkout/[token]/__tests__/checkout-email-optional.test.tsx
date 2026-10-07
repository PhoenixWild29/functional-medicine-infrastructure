/**
 * @jest-environment jsdom
 *
 * C7 follow-up (owner-approved copy): Stripe no longer emails a receipt,
 * so the checkout email field is optional and says what we actually do.
 * A blank email is not sent at all; an entered email is still validated
 * by the server (unchanged) and never forwarded to Stripe.
 */

import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'

const confirmPaymentMock = jest.fn().mockResolvedValue({ error: undefined })

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

import { CheckoutPageContent } from '../_components/checkout-page-content'

const fetchMock = jest.fn()

beforeEach(() => {
  confirmPaymentMock.mockClear()
  fetchMock.mockReset().mockResolvedValue({
    ok:   true,
    json: async () => ({ clientSecret: 'cs_test' }),
  })
  global.fetch = fetchMock as unknown as typeof fetch
})

function renderCheckout(smsConsent = true) {
  return render(
    <CheckoutPageContent
      token="tok"
      kind="solo"
      orderCount={1}
      retailCents={20000}
      clinicName="Test Clinic"
      logoUrl={null}
      checkoutState="active"
      smsConsent={smsConsent}
    />,
  )
}

it('a patient who has not agreed to texts is not promised one', async () => {
  renderCheckout(false)
  await screen.findByLabelText('Email (optional)')
  expect(screen.queryByText(/text you/i)).not.toBeInTheDocument()
})

function lastPostBody(): Record<string, unknown> {
  const call = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]!
  return JSON.parse((call[1] as { body: string }).body) as Record<string, unknown>
}

describe('checkout email field (optional, text confirmation copy)', () => {
  it('is labelled "Email (optional)", is not required, and explains the texts', async () => {
    renderCheckout()
    const input = await screen.findByLabelText('Email (optional)')
    expect(input).not.toBeRequired()
    expect(screen.getByText('We’ll text you to confirm your payment and when your order ships.')).toBeInTheDocument()
    expect(screen.queryByText(/Email for receipt/)).not.toBeInTheDocument()
    expect(screen.queryByText(/payment receipt here/)).not.toBeInTheDocument()
  })

  it('pays with the email left blank and does not send an email', async () => {
    renderCheckout()
    await screen.findByLabelText('Email (optional)')
    const pay = await screen.findByRole('button', { name: /Pay/ })
    await act(async () => { fireEvent.submit(pay.closest('form')!) })

    await waitFor(() => expect(confirmPaymentMock).toHaveBeenCalledTimes(1))
    expect(lastPostBody()).toEqual({ token: 'tok' })
  })

  it('sends an entered email for the server to validate', async () => {
    renderCheckout()
    const input = await screen.findByLabelText('Email (optional)')
    fireEvent.change(input, { target: { value: 'pat@example.com' } })
    const pay = await screen.findByRole('button', { name: /Pay/ })
    await act(async () => { fireEvent.submit(pay.closest('form')!) })

    await waitFor(() => expect(confirmPaymentMock).toHaveBeenCalledTimes(1))
    expect(lastPostBody()).toEqual({ token: 'tok', email: 'pat@example.com' })
  })

  it('stops before payment when the server rejects an entered email', async () => {
    renderCheckout()
    const input = await screen.findByLabelText('Email (optional)')
    fireEvent.change(input, { target: { value: 'bad@example.invalid' } })
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Invalid email address' }) })
    const pay = await screen.findByRole('button', { name: /Pay/ })
    await act(async () => { fireEvent.submit(pay.closest('form')!) })

    expect(await screen.findByText('Invalid email address')).toBeInTheDocument()
    expect(confirmPaymentMock).not.toHaveBeenCalled()
  })
})
