/**
 * @jest-environment node
 *
 * #189: the 72-hour unpaid clock starts at signing (locked_at), as the
 * module comment says ("signed > 72h ago") and as the payment-expiry cron
 * counts it. An AWAITING_PAYMENT order with no locked_at has no signing
 * time: it is skipped with a logged warning, never timed from created_at.
 */

import { loadAttention } from '../attention'
import { fakeDb } from '@/lib/orders/__tests__/fake-db'

jest.mock('@/lib/orders/batch-sign', () => ({
  MAX_BATCH_ORDERS: 25,
  checkBatch: jest.fn().mockResolvedValue({ lines: [], signer: null, problems: [] }),
}))
jest.mock('@/lib/refunds/stuck', () => ({
  listStuckRefunds: jest.fn().mockResolvedValue({ ok: true, rows: [] }),
  listLatePayments: jest.fn().mockResolvedValue({ ok: true, rows: [] }),
}))

const CLINIC = 'clinic-mine'
const NOW = Date.parse('2026-09-23T12:00:00Z')
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString()

function order(id: string, createdH: number, lockedH: number | null) {
  return {
    order_id: id, status: 'AWAITING_PAYMENT', clinic_id: CLINIC, is_active: true, deleted_at: null,
    created_at: hoursAgo(createdH), locked_at: lockedH === null ? null : hoursAgo(lockedH),
    medication_snapshot: { medication_name: 'Semaglutide 5mg/mL' },
    patients: { first_name: 'Alex', last_name: 'Demo' },
  }
}

const load = (orders: unknown[]) =>
  loadAttention(fakeDb({ orders, inbound_fax_queue: [] }).client, { clinicId: CLINIC, viewerIsProvider: false, nowMs: NOW })

beforeEach(() => { jest.spyOn(console, 'warn').mockImplementation(() => {}) })
afterEach(() => { jest.restoreAllMocks() })

it('an order created long ago but signed recently is not flagged', async () => {
  const res = await load([order('signed-recently', 200, 10)])
  expect(res.items.filter(i => i.kind === 'awaiting_payment')).toEqual([])
})

it('an order signed over 72h ago is flagged, timed from signing', async () => {
  const res = await load([order('signed-old', 200, 80)])
  expect(res.items.filter(i => i.kind === 'awaiting_payment')).toEqual([
    expect.objectContaining({ orderId: 'signed-old', since: hoursAgo(80) }),
  ])
})

it('no locked_at: skipped with a warning, never timed from created_at', async () => {
  const res = await load([order('never-signed', 200, null)])
  expect(res.items.filter(i => i.kind === 'awaiting_payment')).toEqual([])
  expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('order=never-signed'))
})
