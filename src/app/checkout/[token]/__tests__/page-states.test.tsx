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
import { logPhiAccess, patientActor } from '@/lib/audit/phi-access'

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

it('a database error is an error, not the expired page (a valid link is never called expired because of a blip)', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {})
  script = c => (c.table === 'orders' ? { error: { message: 'down' } } : c.table === 'clinics' ? { data: CLINIC } : undefined)
  await expect(open()).rejects.toThrow('Checkout could not be loaded')
  expect(redirectMock).not.toHaveBeenCalled()
})

// C-2026-10-25-17 (B14/B15): a payable checkout shows the patient's order
// (amount, titration schedule, clinic), so each render is one view /
// checkout row with the patient from the token's order or group as the
// actor (no signed-in user). A read: a failed row is alerted by the helper
// and the page still renders. A link that goes to the neutral page logs
// nothing (nothing of the order is shown).
describe('PHI access log', () => {
  const phi = jest.mocked(logPhiAccess)
  beforeEach(() => phi.mockClear())

  it('solo: one view / checkout row with the order and its patient', async () => {
    script = c => (c.table === 'orders' ? { data: { ...order('AWAITING_PAYMENT'), patient_id: 'pt-1' } } : c.table === 'clinics' ? { data: CLINIC } : undefined)
    render(await open())
    expect(phi).toHaveBeenCalledTimes(1)
    expect(phi).toHaveBeenCalledWith(expect.objectContaining({
      actor: patientActor('pt-1', 'c-1'), action: 'view', resource: 'checkout', route: '/checkout/[token]',
      orderId: 'o-1', patientId: 'pt-1', clinicId: 'c-1',
    }))
  })

  it('group: one view / checkout row with the group\'s patient', async () => {
    process.env['PHASE_C_GROUPS_ENABLED'] = 'true'
    headerValues.delete('x-checkout-order-id')
    headerValues.set('x-checkout-group-id', 'g-1')
    script = c => (c.table === 'payment_groups' ? { data: { group_id: 'g-1', patient_id: 'pt-2', status: 'AWAITING_PAYMENT', total_cents: 100, shipping_total: 0, patients: null } }
      : c.table === 'clinics' ? { data: CLINIC } : c.table === 'orders' ? { count: 2 } : undefined)
    render(await open())
    delete process.env['PHASE_C_GROUPS_ENABLED']
    expect(phi).toHaveBeenCalledTimes(1)
    expect(phi).toHaveBeenCalledWith(expect.objectContaining({
      actor: patientActor('pt-2', 'c-1'), action: 'view', resource: 'checkout', route: '/checkout/[token]',
      patientId: 'pt-2', clinicId: 'c-1',
    }))
  })

  it('the row cannot be written: the checkout still renders (a read)', async () => {
    phi.mockResolvedValueOnce(false)
    script = c => (c.table === 'orders' ? { data: { ...order('AWAITING_PAYMENT'), patient_id: 'pt-1' } } : c.table === 'clinics' ? { data: CLINIC } : undefined)
    render(await open())
    expect(screen.getByText('active')).toBeInTheDocument()
  })

  it('a paid or cancelled link (the neutral page): no row', async () => {
    script = c => (c.table === 'orders' ? { data: { ...order('PAID_PROCESSING'), patient_id: 'pt-1' } } : c.table === 'clinics' ? { data: CLINIC } : undefined)
    await expect(open()).rejects.toThrow('REDIRECT /checkout/expired')
    expect(phi).not.toHaveBeenCalled()
  })
})
