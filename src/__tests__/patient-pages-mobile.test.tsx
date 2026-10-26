/**
 * @jest-environment jsdom
 *
 * Patient pages at phone sizes (C-2026-10-25-08). Patients open their
 * links on phones. Measured at 360x740, 390x844 and 768x1024 with the real
 * Tailwind CSS (e2e/patient-pages-mobile.spec.ts checks the live flows):
 *
 *   - every tap target is at least 44x44 px: a checkbox's tap area is a
 *     44px label around it, not the 20px box;
 *   - long names, addresses and drug names wrap inside their card; a price
 *     never wraps and never squeezes the name off the card;
 *   - inputs are 16px with the right type and autocomplete;
 *   - each patient route has its own error page, sized for a phone.
 *
 * jsdom has no layout, so this pins the markup that gives those results.
 */

import fs from 'node:fs'
import path from 'node:path'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

jest.mock('@/lib/browser/navigate', () => ({ navigateTo: jest.fn() }))
jest.mock('@/app/intake/[token]/_components/license-scanner', () => ({ LicenseScanner: () => null }))
jest.mock('@stripe/stripe-js', () => ({ loadStripe: () => Promise.resolve(null) }))
jest.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PaymentElement: () => <div />,
  useStripe: () => ({}),
  useElements: () => ({}),
}))
jest.mock('@/lib/env', () => ({ clientEnv: { stripePublishableKey: 'pk_test_x' } }))

import { PlanFlow } from '@/app/plan/[token]/_components/plan-flow'
import { IntakeFlow } from '@/app/intake/[token]/_components/intake-flow'
import { CheckoutPageContent } from '@/app/checkout/[token]/_components/checkout-page-content'

const ROOT = path.resolve(__dirname, '../..')
const cls = (el: Element | null) => el?.getAttribute('class') ?? ''
const TAP_44 = /\bmin-h-\[44px\]|\bmin-h-\[48px\]|\bh-11\b/

afterEach(() => cleanup())

describe('intake: consent checkboxes have a 44px tap area', () => {
  it.each(['I have read the privacy notice.', /I agree to receive text messages/])('%s', name => {
    render(<IntakeFlow token="t" clinicName="Clinic" />)
    const box = screen.getByLabelText(name)
    const wrap = box.closest('label')
    expect(wrap).not.toBeNull()
    expect(cls(wrap)).toMatch(TAP_44)
  })
})

describe('intake: long answers wrap on the review step', () => {
  it('the summary breaks long words instead of overflowing the card', async () => {
    global.fetch = jest.fn() as unknown as typeof fetch
    const { container } = render(<IntakeFlow token="t" clinicName="Clinic" />)
    fireEvent.click(screen.getByLabelText('I have read the privacy notice.'))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Type my details' }))
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'A' } })
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'B' } })
    fireEvent.change(screen.getByLabelText('Date of birth'), { target: { value: '1980-01-02' } })
    fireEvent.click(screen.getByLabelText('Female'))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.change(await screen.findByLabelText('Street address'), { target: { value: '1 Main St' } })
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch' } })
    fireEvent.change(screen.getByLabelText('State'), { target: { value: 'VA' } })
    fireEvent.change(screen.getByLabelText('ZIP code'), { target: { value: '22102' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(await screen.findByLabelText('No known drug allergies'))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByText('Check and submit')
    expect(cls(container.querySelector('dl'))).toMatch(/\bwrap-break-word\b/)
  })
})

describe('plan: checkboxes, long drug names and prices', () => {
  const PLAN = {
    status: 'sent', chosen: null, quote: null,
    options: [{ optionId: 'o1', label: 'Option A', items: [
      { orderId: 'r1', medicationName: 'Semaglutide/Cyanocobalamin-Injectable-Suspension', form: null, strength: null, sig: null, quantity: null, daysSupply: null, priceCents: 1234567, required: false },
    ] }],
  }
  async function showPlan() {
    global.fetch = jest.fn(async (_u: unknown, init?: { body?: string }) => {
      const action = (JSON.parse(init?.body ?? '{}') as { action: string }).action
      return { status: 200, json: async () => (action === 'verify' ? { plan: PLAN } : {}) } as unknown as Response
    }) as unknown as typeof fetch
    const { container } = render(<PlanFlow token="t" logoUrl={null} />)
    fireEvent.change(container.querySelector('input[type=date]')!, { target: { value: '1980-01-02' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByText('Option A')
    return container
  }

  it('each item checkbox sits in a 44x44 tap area', async () => {
    const container = await showPlan()
    const box = container.querySelector('input[type=checkbox]') as HTMLInputElement
    // One label (axe: no empty second label), 44px tall, with the box in a 44x44 area.
    expect(box.labels).toHaveLength(1)
    expect(cls(box.closest('label'))).toMatch(TAP_44)
    expect(cls(box.parentElement)).toMatch(/\bh-11\b/)
    expect(cls(box.parentElement)).toMatch(/\bw-11\b/)
    // The item's accessible name is still its drug name and price.
    expect(screen.getByRole('checkbox', { name: /Semaglutide/ })).toBe(box)
  })

  it('the name wraps; the price stays on one line', async () => {
    await showPlan()
    const name = screen.getByText('Semaglutide/Cyanocobalamin-Injectable-Suspension')
    const price = screen.getByText('$12345.67')
    expect(cls(name)).toMatch(/\bmin-w-0\b/)
    expect(cls(name)).toMatch(/\bwrap-break-word\b/)
    expect(cls(price)).toMatch(/\bshrink-0\b/)
    expect(cls(price)).toMatch(/\bwhitespace-nowrap\b/)
  })

  it('the confirm step wraps names and keeps prices on one line', async () => {
    await showPlan()
    fireEvent.click(screen.getByRole('button', { name: 'Choose this plan' }))
    const row = (await screen.findByText('Confirm your choice')).closest('section')!.querySelector('li')!
    const [name, price] = [...row.querySelectorAll('span')]
    expect(cls(name!)).toMatch(/\bwrap-break-word\b/)
    expect(cls(price!)).toMatch(/\bwhitespace-nowrap\b/)
  })
})

describe('checkout', () => {
  const props = {
    token: 't', kind: 'solo' as const, orderCount: 1, retailCents: 1000, clinicName: 'Clinic', logoUrl: null,
    checkoutState: 'active' as const, smsConsent: true,
  }
  it('the email field is at least 44px tall', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ clientSecret: 'cs' }) })) as unknown as typeof fetch
    render(<CheckoutPageContent {...props} />)
    const email = await screen.findByLabelText('Email (optional)')
    expect(cls(email)).toMatch(TAP_44)
    expect(email).toHaveAttribute('type', 'email')
    expect(email).toHaveAttribute('autocomplete', 'email')
  })
  it('the HSA / FSA badge stays on one line; the trust badges can wrap', () => {
    global.fetch = jest.fn(() => new Promise(() => {})) as unknown as typeof fetch
    render(<CheckoutPageContent {...props} />)
    expect(cls(screen.getByText('HSA / FSA'))).toMatch(/\bwhitespace-nowrap\b/)
    expect(cls(screen.getByText('256-bit TLS Encryption').parentElement)).toMatch(/\bflex-wrap\b/)
  })
  it('the summary text can shrink beside the amount', () => {
    global.fetch = jest.fn(() => new Promise(() => {})) as unknown as typeof fetch
    render(<CheckoutPageContent {...props} />)
    expect(cls(screen.getByText('Prescription Service').parentElement)).toMatch(/\bmin-w-0\b/)
  })
})

describe('checkout success: contact links are 44px tap targets', () => {
  it('the phone and email links (solo and bundle)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/app/checkout/success/page.tsx'), 'utf8')
    const links = [...src.matchAll(/href=\{`(tel|mailto):[^`]*`\}\s*\n?\s*className="([^"]*)"/g)]
    expect(links).toHaveLength(4)
    for (const [, , c] of links) expect(c).toMatch(TAP_44)
    for (const [, kind, c] of links) if (kind === 'mailto') expect(c).toMatch(/\bbreak-all\b/)
  })
})

describe('each patient route has a phone-sized error page', () => {
  it.each(['checkout', 'plan', 'intake', 'join'])('/%s', async route => {
    const file = path.join(ROOT, 'src/app', route, 'error.tsx')
    expect(fs.existsSync(file)).toBe(true)
    const Mod = (await import(`@/app/${route}/error`)) as { default: (p: { error: Error; reset: () => void }) => React.ReactElement }
    jest.spyOn(console, 'error').mockImplementation(() => {})
    render(<Mod.default error={new Error('x')} reset={() => {}} />)
    const button = screen.getByRole('button', { name: 'Try again' })
    expect(cls(button)).toMatch(TAP_44)
    expect(cls(button)).toMatch(/\btext-base\b/)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Something went wrong')
  })
})
