/**
 * @jest-environment jsdom
 *
 * C7 follow-up (owner-approved copy): Stripe no longer emails a receipt,
 * so the success page no longer claims one was emailed. Solo and bundle.
 */

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
    }
    await renderPage()
    expect(screen.getByText(new RegExp(NEW_COPY.replace(/[.()]/g, '\\$&')))).toBeInTheDocument()
    expect(screen.queryByText(/receipt has been emailed/i)).not.toBeInTheDocument()
  })

  it('bundle: says a text is coming, not that a receipt was emailed', async () => {
    groupRow = {
      group_id: 'g1', total_cents: 40000, clinic_id: 'c1',
      clinics: { name: 'Test Clinic', contact_phone: null, contact_email: null },
    }
    await renderPage()
    expect(screen.getByText(new RegExp(NEW_COPY.replace(/[.()]/g, '\\$&')))).toBeInTheDocument()
    expect(screen.queryByText(/receipt has been emailed/i)).not.toBeInTheDocument()
  })
})
