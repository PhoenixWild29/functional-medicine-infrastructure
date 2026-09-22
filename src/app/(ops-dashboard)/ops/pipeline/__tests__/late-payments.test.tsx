/**
 * Batch 2 follow-up: a late payment on an expired bundle is shown to ops.
 *
 * The webhook refunds it and records why on each member's history. The
 * ops pipeline shows those — refunded, or refund FAILED and still owed —
 * next to the stuck refunds. A read that fails says so.
 */

import { render, screen } from '@testing-library/react'
import { listLatePayments } from '@/lib/refunds/stuck'
import { LatePaymentsPanel } from '../_components/stuck-refunds-panel'

function supabaseWith(rows: unknown, fail = false) {
  const c: Record<string, unknown> = {}
  for (const k of ['select', 'eq', 'is', 'in', 'order', 'limit', 'contains', 'gte']) c[k] = () => c
  c['then'] = (resolve: (r: unknown) => unknown) =>
    Promise.resolve(fail ? { data: null, error: { message: 'connection reset' } } : { data: rows, error: null }).then(resolve)
  return { from: () => ({ select: () => c }) } as never
}

const REFUNDED = {
  order_id: 'o-a', created_at: '2026-09-22T10:00:00Z',
  metadata: { event: 'late_payment_refunded', payment_group_id: 'g-1', payment_intent: 'pi_group', refund_id: 're_late', refund_ok: true },
}
const FAILED = {
  order_id: 'o-c', created_at: '2026-09-22T11:00:00Z',
  metadata: { event: 'late_payment_refunded', payment_group_id: 'g-2', payment_intent: 'pi_g2', refund_ok: false, error: 'insufficient platform balance' },
}

describe('late payments for ops', () => {
  it('shows a late payment that was refunded, once per group', async () => {
    const result = await listLatePayments(supabaseWith([REFUNDED, { ...REFUNDED, order_id: 'o-b' }]))
    render(<LatePaymentsPanel result={result} />)

    expect(screen.getAllByTestId('late-payment-g-1')).toHaveLength(1)
    expect(screen.getByTestId('late-payment-g-1')).toHaveTextContent(/refunded/i)
  })

  it('flags one whose refund failed as still owed', async () => {
    const result = await listLatePayments(supabaseWith([FAILED]))
    render(<LatePaymentsPanel result={result} />)

    expect(screen.getByTestId('late-payment-g-2')).toHaveTextContent(/failed/i)
  })

  it('a failed read shows an error, not an empty list', async () => {
    const result = await listLatePayments(supabaseWith(null, true))
    render(<LatePaymentsPanel result={result} />)

    expect(screen.getByTestId('late-payments-error')).toBeInTheDocument()
  })
})
