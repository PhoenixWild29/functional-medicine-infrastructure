/**
 * "Privacy Policy" and "Terms of Use" footer links on every public page a
 * patient or invitee lands on without an account: patient checkout (pay,
 * success, expired), /login and the invite pages (/onboard/clinic,
 * /onboard/join, /onboard/pharmacy). Checkout and the invite pages get
 * the links from their layout, so every page under them has them.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, within } from '@testing-library/react'
import CheckoutLayout from '@/app/checkout/layout'
import CheckoutExpiredPage from '@/app/checkout/expired/page'
import OnboardLayout from '@/app/onboard/layout'
import LoginPage from '@/app/login/page'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('@/lib/supabase/client', () => ({ createBrowserClient: () => ({ auth: {} }) }))

function expectLegalLinks() {
  const nav = screen.getByRole('navigation', { name: 'Legal' })
  expect(within(nav).getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/legal/privacy')
  expect(within(nav).getByRole('link', { name: 'Terms of Use' })).toHaveAttribute('href', '/legal/patient-terms')
}

it('checkout: the expired page shows the links (from the checkout layout)', () => {
  render(<CheckoutLayout><CheckoutExpiredPage /></CheckoutLayout>)
  expectLegalLinks()
  // The footer sits outside <main>, as the page's contentinfo.
  expect(screen.getByRole('contentinfo')).toContainElement(screen.getByRole('link', { name: 'Privacy Policy' }))
})

it('checkout: the pay and success pages are under the same layout', () => {
  for (const dir of ['[token]', 'success', 'expired']) {
    expect(existsSync(join(process.cwd(), 'src', 'app', 'checkout', dir, 'page.tsx'))).toBe(true)
  }
  render(<CheckoutLayout><main><h1>Pay</h1></main></CheckoutLayout>)
  expectLegalLinks()
})

it('/login shows the links', () => {
  render(<LoginPage />)
  expectLegalLinks()
})

it('invite pages (/onboard/clinic, /onboard/join, /onboard/pharmacy) show the links from their layout', () => {
  for (const kind of ['clinic', 'join', 'pharmacy']) {
    expect(existsSync(join(process.cwd(), 'src', 'app', 'onboard', kind, '[token]', 'page.tsx'))).toBe(true)
  }
  render(<OnboardLayout><h1>You are invited</h1></OnboardLayout>)
  expectLegalLinks()
  expect(screen.getByRole('contentinfo')).toContainElement(screen.getByRole('link', { name: 'Terms of Use' }))
})
