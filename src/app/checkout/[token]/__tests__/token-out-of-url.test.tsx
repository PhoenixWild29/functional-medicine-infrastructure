/**
 * @jest-environment jsdom
 *
 * The patient's payment token never sits in the address bar while
 * Stripe.js runs. Stripe.js is a third-party script that can read
 * window.location; the token is the patient's credential. So:
 *
 *   - Stripe.js is not loaded when the module is imported (loadStripe is
 *     not at module scope);
 *   - on mount the page replaces the URL with /checkout (no token, no
 *     ?token=) BEFORE loadStripe is called;
 *   - the token stays in memory only: the payment-intent POSTs carry it,
 *     and it is never written to localStorage, sessionStorage or a cookie.
 */

import { render, screen, waitFor, fireEvent } from '@testing-library/react'

const events: string[] = []
const loadStripeMock = jest.fn(() => { events.push(`loadStripe@${window.location.pathname}${window.location.search}`); return Promise.resolve({}) })
jest.mock('@stripe/stripe-js', () => ({ loadStripe: (...a: unknown[]) => (loadStripeMock as (...x: unknown[]) => unknown)(...a) }))

const confirmPaymentMock = jest.fn().mockResolvedValue({ error: undefined })
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

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJvcmRlcklkIjoibyJ9.c2lnbmF0dXJl'
const fetchMock = jest.fn()

function renderCheckout() {
  return render(
    <CheckoutPageContent
      token={TOKEN} kind="solo" orderCount={1} retailCents={20000}
      clinicName="Test Clinic" logoUrl={null} checkoutState="active" smsConsent
    />,
  )
}

let replaceSpy: jest.SpyInstance
let setItemSpy: jest.SpyInstance
let cookieWrites: string[] = []

beforeAll(() => {
  // Module import alone must not have loaded Stripe.js.
  expect(loadStripeMock).not.toHaveBeenCalled()
})

beforeEach(() => {
  events.length = 0
  cookieWrites = []
  loadStripeMock.mockClear()
  confirmPaymentMock.mockClear()
  fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({ clientSecret: 'cs_test' }) })
  global.fetch = fetchMock as unknown as typeof fetch
  window.history.pushState(null, '', `/checkout/${TOKEN}`)
  replaceSpy = jest.spyOn(window.history, 'replaceState')
  replaceSpy.mockImplementation(function (this: History, ...args: Parameters<History['replaceState']>) {
    events.push(`replaceState:${String(args[2])}`)
    return History.prototype.replaceState.apply(this, args)
  })
  setItemSpy = jest.spyOn(Storage.prototype, 'setItem')
  const desc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')!
  jest.spyOn(document, 'cookie', 'set').mockImplementation((v: string) => { cookieWrites.push(v); desc.set!.call(document, v) })
})
afterEach(() => jest.restoreAllMocks())

it('replaces the URL with /checkout before Stripe.js is loaded', async () => {
  renderCheckout()
  await screen.findByTestId('payment-element')
  expect(window.location.pathname).toBe('/checkout')
  expect(window.location.href).not.toContain(TOKEN)
  expect(events[0]).toBe('replaceState:/checkout')
  expect(events).toContain('loadStripe@/checkout')
  expect(events.indexOf('replaceState:/checkout')).toBeLessThan(events.findIndex(e => e.startsWith('loadStripe')))
  expect(loadStripeMock).toHaveBeenCalledTimes(1)
})

it('the ?token= form too: the query is gone before Stripe.js loads', async () => {
  window.history.pushState(null, '', `/checkout?token=${TOKEN}`)
  renderCheckout()
  await screen.findByTestId('payment-element')
  expect(window.location.search).toBe('')
  expect(events.find(e => e.startsWith('loadStripe'))).toBe('loadStripe@/checkout')
})

it('the token stays in memory: the payment-intent POSTs carry it, nothing stores it', async () => {
  renderCheckout()
  await screen.findByTestId('payment-element')
  expect(JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body)).toEqual({ token: TOKEN })
  fireEvent.click(screen.getByRole('button', { name: /^Pay/ }))
  await waitFor(() => expect(confirmPaymentMock).toHaveBeenCalled())
  expect(JSON.parse((fetchMock.mock.calls[1]![1] as { body: string }).body)).toEqual({ token: TOKEN })
  expect(setItemSpy).not.toHaveBeenCalled()
  expect(cookieWrites).toEqual([])
  expect(JSON.stringify({ ...localStorage })).not.toContain(TOKEN)
  expect(JSON.stringify({ ...sessionStorage })).not.toContain(TOKEN)
})

it('success still returns to /checkout/success (unchanged)', async () => {
  renderCheckout()
  await screen.findByTestId('payment-element')
  fireEvent.click(screen.getByRole('button', { name: /^Pay/ }))
  await waitFor(() => expect(confirmPaymentMock).toHaveBeenCalled())
  expect(confirmPaymentMock.mock.calls[0]![0].confirmParams.return_url).toBe(`${window.location.origin}/checkout/success`)
})

it('a page not payable (paid or cancelled) loads no Stripe.js at all', () => {
  render(
    <CheckoutPageContent token={TOKEN} kind="solo" orderCount={1} retailCents={20000}
      clinicName="Test Clinic" logoUrl={null} checkoutState="paid" smsConsent />,
  )
  expect(loadStripeMock).not.toHaveBeenCalled()
})
