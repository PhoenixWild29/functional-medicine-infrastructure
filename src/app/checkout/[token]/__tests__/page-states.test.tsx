/**
 * /checkout/[token]: a link that is no longer payable (paid, cancelled or
 * expired) goes to the one neutral page, /checkout/expired, exactly like
 * an invalid or expired token does in middleware. That page never names
 * the clinic or says whether the link was ever valid or already used.
 */

import { render, screen } from '@testing-library/react'
import { scriptedDb, type ScriptedCall } from '@/__tests__/helpers/scripted-db'

const headerValues = new Map<string, string>()
jest.mock('next/headers', () => ({ headers: async () => ({ get: (k: string) => headerValues.get(k) ?? null }) }))
const redirectMock = jest.fn((url: string) => { throw new Error(`REDIRECT ${url}`) })
jest.mock('next/navigation', () => ({ redirect: (url: string) => redirectMock(url) }))
let script: (c: ScriptedCall) => unknown = () => undefined
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => scriptedDb(c => script(c) as never).client }))
jest.mock('../_components/checkout-page-content', () => ({
  CheckoutPageContent: ({ checkoutState }: { checkoutState: string }) => <main><h1>Pay</h1><p>{checkoutState}</p></main>,
}))

import CheckoutPage from '../page'
import CheckoutExpiredPage from '../../expired/page'

const CLINIC = { name: 'Sunrise Hormone Clinic', logo_url: null, absorb_shipping: false }
const order = (status: string) => ({ order_id: 'o-1', status, retail_price_snapshot: 100, shipping_fee: 10, titration_steps: null, formulations: null, patients: { sms_opt_in: false } })

beforeEach(() => {
  headerValues.clear()
  headerValues.set('x-checkout-order-id', 'o-1')
  headerValues.set('x-checkout-clinic-id', 'c-1')
  redirectMock.mockClear()
})

const open = () => CheckoutPage({ params: Promise.resolve({ token: 'a.b.c' }) })

it('awaiting payment: the checkout', async () => {
  script = c => (c.table === 'orders' ? { data: order('AWAITING_PAYMENT') } : c.table === 'clinics' ? { data: CLINIC } : undefined)
  render(await open())
  expect(screen.getByText('active')).toBeInTheDocument()
})

it.each(['PAID_PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED'])('%s: the neutral page, not a paid or cancelled screen naming the clinic', async status => {
  script = c => (c.table === 'orders' ? { data: order(status) } : c.table === 'clinics' ? { data: CLINIC } : undefined)
  await expect(open()).rejects.toThrow('REDIRECT /checkout/expired')
})

it('group link no longer awaiting payment: the neutral page', async () => {
  process.env['PHASE_C_GROUPS_ENABLED'] = 'true'
  headerValues.delete('x-checkout-order-id')
  headerValues.set('x-checkout-group-id', 'g-1')
  script = c => (c.table === 'payment_groups' ? { data: { group_id: 'g-1', status: 'PAID', total_cents: 100, shipping_total: 0, patients: null } }
    : c.table === 'clinics' ? { data: CLINIC } : c.table === 'orders' ? { count: 2 } : undefined)
  await expect(open()).rejects.toThrow('REDIRECT /checkout/expired')
  delete process.env['PHASE_C_GROUPS_ENABLED']
})

it('the neutral page: no clinic, and it does not say whether the link was valid, expired or used', () => {
  const { container } = render(<CheckoutExpiredPage />)
  expect(screen.getByRole('heading', { level: 1, name: 'This payment link is no longer active' })).toBeInTheDocument()
  const text = container.textContent ?? ''
  expect(text).toMatch(/If you have already paid, there is nothing more to do/)
  expect(text).not.toMatch(/has expired|not valid|already been paid|Sunrise/)
})
