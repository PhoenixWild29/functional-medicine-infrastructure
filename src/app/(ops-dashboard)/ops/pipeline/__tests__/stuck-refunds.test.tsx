/**
 * Batch 2, PR B: a refund that keeps failing is visible to ops.
 *
 * The refund-retry cron retries a pending refund only inside Stripe's
 * 24-hour idempotency window. A refund still pending past it is "stuck":
 * automation stops, and ops must look at it in Stripe. This panel is where
 * they see it. A read that fails says so — it does not render as "no
 * stuck refunds", which is exactly the silent failure this batch removes.
 */

import { render, screen } from '@testing-library/react'
import { listStuckRefunds } from '@/lib/refunds/stuck'
import { StuckRefundsPanel } from '../_components/stuck-refunds-panel'

const HOUR = 60 * 60 * 1000
const NOW = Date.parse('2026-09-21T12:00:00Z')

function supabaseWith(orders: unknown, history: Record<string, string>, fail: 'orders' | 'history' | null = null) {
  const chain = (answer: (f: Record<string, unknown>) => unknown) => {
    const filters: Record<string, unknown> = {}
    const c: Record<string, unknown> = {}
    for (const k of ['select', 'is', 'in', 'order', 'limit', 'neq']) c[k] = () => c
    c['eq'] = (col: string, val: unknown) => { filters[col] = val; return c }
    c['maybeSingle'] = async () => answer(filters)
    c['then'] = (resolve: (r: unknown) => unknown) => Promise.resolve(answer(filters)).then(resolve)
    return c
  }
  return {
    from: (table: string) => {
      if (table === 'orders') {
        return { select: () => chain(() => fail === 'orders' ? { data: null, error: { message: 'connection reset' } } : { data: orders, error: null }) }
      }
      if (table === 'order_status_history') {
        return {
          select: () => chain(f => fail === 'history'
            ? { data: null, error: { message: 'connection reset' } }
            : { data: history[f['order_id'] as string] ? { created_at: history[f['order_id'] as string] } : null, error: null }),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    },
  } as never
}

const ORDERS = [
  { order_id: 'o-old', stripe_payment_intent_id: 'pi_old', payment_group_id: null, retail_price_snapshot: 190 },
  { order_id: 'o-new', stripe_payment_intent_id: 'pi_new', payment_group_id: null, retail_price_snapshot: 120 },
]
const HISTORY = {
  'o-old': new Date(NOW - 25 * HOUR).toISOString(),
  'o-new': new Date(NOW - 2 * HOUR).toISOString(),
}

describe('stuck refunds for ops', () => {
  it('shows a refund pending past the retry window, and not one still being retried', async () => {
    const result = await listStuckRefunds(supabaseWith(ORDERS, HISTORY), NOW)
    render(<StuckRefundsPanel result={result} />)

    expect(screen.getByTestId('stuck-refunds')).toBeInTheDocument()
    expect(screen.getByTestId('stuck-refund-o-old')).toBeInTheDocument()
    expect(screen.queryByTestId('stuck-refund-o-new')).not.toBeInTheDocument()
  })

  it('a refund whose pending time cannot be established counts as stuck, not as fine', async () => {
    const result = await listStuckRefunds(supabaseWith([ORDERS[0]], {}), NOW)
    render(<StuckRefundsPanel result={result} />)

    expect(screen.getByTestId('stuck-refund-o-old')).toBeInTheDocument()
  })

  it('a failed read shows an error, not "no stuck refunds"', async () => {
    const result = await listStuckRefunds(supabaseWith(null, {}, 'orders'), NOW)
    render(<StuckRefundsPanel result={result} />)

    expect(screen.getByTestId('stuck-refunds-error')).toBeInTheDocument()
    expect(screen.queryByText(/no stuck refunds/i)).not.toBeInTheDocument()
  })

  it('with nothing stuck, says so plainly', async () => {
    const result = await listStuckRefunds(supabaseWith([ORDERS[1]], HISTORY), NOW)
    render(<StuckRefundsPanel result={result} />)

    expect(screen.getByTestId('stuck-refunds')).toHaveTextContent(/no stuck refunds/i)
  })
})
