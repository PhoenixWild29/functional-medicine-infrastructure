/**
 * @jest-environment jsdom
 *
 * C7 follow-up (owner-approved copy): Stripe no longer emails a receipt,
 * so the success page no longer claims one was emailed. Solo and bundle.
 */

import fs from 'node:fs'
import path from 'node:path'
import { render, screen } from '@testing-library/react'

let orderRow: unknown = null
let groupRow: unknown = null

function chain(result: () => unknown) {
  const node: Record<string, unknown> = {}
  node['select']      = () => node
  node['eq']          = () => node
  node['is']          = () => Promise.resolve({ count: 2, error: null })
  node['maybeSingle'] = () => Promise.resolve({ data: result(), error: null })
  return node
}

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => chain(() => (table === 'orders' ? orderRow : table === 'payment_groups' ? groupRow : null)),
  }),
}))

import CheckoutSuccessPage from '../page'

const NEW_COPY = 'Payment received. You’ll get a text confirming your payment and when your order ships.'

async function renderPage() {
  const ui = await CheckoutSuccessPage({
    searchParams: Promise.resolve({ payment_intent: 'pi_1', redirect_status: 'succeeded' }),
  })
  render(ui)
}

beforeEach(() => {
  orderRow = null
  groupRow = null
})

describe('checkout success copy', () => {
  it('solo order: says a text is coming, not that a receipt was emailed', async () => {
    orderRow = {
      order_id: 'o1', retail_price_snapshot: 200, shipping_fee: 0, clinic_id: 'c1',
      clinics: { name: 'Test Clinic', absorb_shipping: false, contact_phone: null, contact_email: null },
      pharmacies: { supports_real_time_status: true, average_turnaround_days: null },
      patients: { sms_opt_in: true },
    }
    await renderPage()
    expect(screen.getByText(new RegExp(NEW_COPY.replace(/[.()]/g, '\\$&')))).toBeInTheDocument()
    expect(screen.queryByText(/receipt has been emailed/i)).not.toBeInTheDocument()
  })

  it('bundle: says a text is coming, not that a receipt was emailed', async () => {
    groupRow = {
      group_id: 'g1', total_cents: 40000, clinic_id: 'c1',
      clinics: { name: 'Test Clinic', contact_phone: null, contact_email: null },
      patients: { sms_opt_in: true },
    }
    await renderPage()
    expect(screen.getByText(new RegExp(NEW_COPY.replace(/[.()]/g, '\\$&')))).toBeInTheDocument()
    expect(screen.queryByText(/receipt has been emailed/i)).not.toBeInTheDocument()
  })
})

// A text is promised only to a patient who agreed to texts (sms_opt_in).
// Without consent no text is sent, so the page says "Payment received."
describe('no SMS consent: no text is promised', () => {
  const noTextPromise = () => {
    expect(screen.queryByText(/text/i)).not.toBeInTheDocument()
    expect(screen.getByText('Payment received.')).toBeInTheDocument()
  }

  it('solo order, patient not opted in', async () => {
    orderRow = {
      order_id: 'o1', retail_price_snapshot: 200, shipping_fee: 0, clinic_id: 'c1',
      clinics: { name: 'Test Clinic', absorb_shipping: false, contact_phone: null, contact_email: null },
      pharmacies: { supports_real_time_status: true, average_turnaround_days: null },
      patients: { sms_opt_in: false },
    }
    await renderPage()
    noTextPromise()
    expect(screen.getByText('Within 24–48 hours.')).toBeInTheDocument()
  })

  it('bundle, patient not opted in', async () => {
    groupRow = {
      group_id: 'g1', total_cents: 40000, clinic_id: 'c1',
      clinics: { name: 'Test Clinic', contact_phone: null, contact_email: null },
      patients: { sms_opt_in: false },
    }
    await renderPage()
    noTextPromise()
  })

  it('consent not known (no patient row): no promise', async () => {
    orderRow = {
      order_id: 'o1', retail_price_snapshot: 200, shipping_fee: 0, clinic_id: 'c1',
      clinics: { name: 'Test Clinic', absorb_shipping: false, contact_phone: null, contact_email: null },
      pharmacies: { supports_real_time_status: true, average_turnaround_days: null },
      patients: null,
    }
    await renderPage()
    noTextPromise()
  })

  it('the order is not found yet (pending): no text is promised', async () => {
    await renderPage()
    expect(screen.queryByText(/text/i)).not.toBeInTheDocument()
  })
})

it('the lookups read the patient SMS consent', () => {
  const src = fs.readFileSync(path.join(__dirname, '../page.tsx'), 'utf8')
  expect(src.match(/patients\s*\(\s*sms_opt_in\s*\)/g)).toHaveLength(2)
})

