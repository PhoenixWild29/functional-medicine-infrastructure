/**
 * /checkout: what the address bar shows once the checkout has taken the
 * token out of it. A refresh there has no token (nothing stored it), so
 * the patient is asked, neutrally, to reopen the link. The legacy
 * /checkout?token= form renders the same checkout as /checkout/<token>.
 */

import { render, screen } from '@testing-library/react'

const renderCheckoutMock = jest.fn(async (token: string) => <main><h1>Pay</h1><p data-testid="rendered-token">{token}</p></main>)
jest.mock('../[token]/_lib/render-checkout', () => ({ renderCheckout: (t: string) => renderCheckoutMock(t) }))

import CheckoutReopenPage from '../page'

beforeEach(() => renderCheckoutMock.mockClear())

it('no token (a refresh after the token left the URL): the neutral reopen page, nothing looked up', async () => {
  render(await CheckoutReopenPage({ searchParams: Promise.resolve({}) }))
  expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
  expect(screen.getByTestId('checkout-reopen')).toHaveTextContent('For your security, please reopen the payment link from your text message.')
  expect(renderCheckoutMock).not.toHaveBeenCalled()
})

it('/checkout?token=: the same checkout as /checkout/<token>', async () => {
  render(await CheckoutReopenPage({ searchParams: Promise.resolve({ token: 'a.b.c' }) }))
  expect(renderCheckoutMock).toHaveBeenCalledWith('a.b.c')
  expect(screen.getByTestId('rendered-token')).toHaveTextContent('a.b.c')
})
