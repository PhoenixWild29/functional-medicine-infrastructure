/**
 * @jest-environment node
 *
 * WO-107: Needs attention — this clinic's scripts that need someone, each
 * linking straight to where it gets fixed.
 *
 * The WO's list (awaiting payment > 72h, submission failed, faxes, drafts
 * older than 48h) plus this week's states: the WO-108 reprice block, a
 * draft another check refuses, stuck refunds and late payments (#170),
 * scoped to this clinic. A lookup that fails is named in `errors`, never
 * read as "nothing needs attention".
 */

import { loadAttention } from '../attention'
import { fakeDb } from '@/lib/orders/__tests__/fake-db'

const checkBatchMock = jest.fn()
jest.mock('@/lib/orders/batch-sign', () => ({
  MAX_BATCH_ORDERS: 25,
  checkBatch: (...a: unknown[]) => checkBatchMock(...a),
}))
const stuckMock = jest.fn()
const lateMock = jest.fn()
jest.mock('@/lib/refunds/stuck', () => ({
  listStuckRefunds: (...a: unknown[]) => stuckMock(...a),
  listLatePayments: (...a: unknown[]) => lateMock(...a),
}))

const CLINIC = 'clinic-mine'
const NOW = Date.parse('2026-09-23T12:00:00Z')
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString()

function row(id: string, status: string, over: Record<string, unknown> = {}) {
  return {
    order_id: id, status, clinic_id: CLINIC, is_active: true, deleted_at: null,
    created_at: hoursAgo(1), locked_at: null,
    medication_snapshot: { medication_name: 'Semaglutide 5mg/mL' },
    patients: { first_name: 'Alex', last_name: 'Demo' },
    ...over,
  }
}

function world() {
  return fakeDb({
    orders: [
      row('unpaid-old',   'AWAITING_PAYMENT', { created_at: hoursAgo(100), locked_at: hoursAgo(80) }),
      row('unpaid-new',   'AWAITING_PAYMENT', { created_at: hoursAgo(100), locked_at: hoursAgo(10) }),
      row('failed',       'SUBMISSION_FAILED'),
      row('fax-failed',   'FAX_FAILED'),
      row('draft-old',    'DRAFT', { created_at: hoursAgo(60) }),
      row('draft-moved',  'DRAFT'),
      row('draft-cost',   'DRAFT'),
      row('delivered',    'DELIVERED'),
      row('other-clinic', 'SUBMISSION_FAILED', { clinic_id: 'clinic-other' }),
      row('faxed',        'FAX_DELIVERED'),
    ],
    inbound_fax_queue: [
      { fax_id: 'f1', status: 'MATCHED',   created_at: hoursAgo(5), matched_order_id: 'faxed', deleted_at: null },
      { fax_id: 'f2', status: 'PROCESSED', created_at: hoursAgo(5), matched_order_id: 'faxed', deleted_at: null },
      { fax_id: 'f3', status: 'MATCHED',   created_at: hoursAgo(5), matched_order_id: 'other-clinic', deleted_at: null },
    ],
  })
}

beforeEach(() => {
  checkBatchMock.mockReset().mockResolvedValue({
    lines: [], signer: null,
    problems: [
      { orderId: 'draft-moved', medicationName: 'Semaglutide', code: 'reprice', message: "Semaglutide: the pharmacy's price changed since this draft was saved ($95.00 → $110.00)." },
      { orderId: 'draft-cost',  medicationName: 'Semaglutide', code: 'below_cost', message: 'Semaglutide is priced below cost.' },
    ],
  })
  stuckMock.mockReset().mockResolvedValue({ ok: true, rows: [{ orderId: 'refund-stuck', pendingSince: hoursAgo(30), retailCents: 19000 }] })
  lateMock.mockReset().mockResolvedValue({ ok: true, rows: [{ groupId: 'g-1', orderId: 'late-1', paymentIntent: 'pi_1', refundId: null, refundOk: false, error: 'card_declined', at: hoursAgo(2) }] })
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { jest.restoreAllMocks() })

const byKind = (items: Array<{ kind: string; orderId: string; href: string }>) =>
  items.map(i => `${i.kind}:${i.orderId} → ${i.href}`).sort()

describe('loadAttention', () => {
  it('lists every kind, this clinic only, each linking to where it is fixed (clinic admin)', async () => {
    const res = await loadAttention(world().client, { clinicId: CLINIC, viewerIsProvider: false, nowMs: NOW })
    expect(res.errors).toEqual([])
    expect(byKind(res.items)).toEqual([
      'awaiting_payment:unpaid-old → /dashboard?order=unpaid-old',
      'blocked_draft:draft-cost → /new-prescription/search?editOrder=draft-cost',
      'fax_review:faxed → /dashboard?order=faxed',
      'late_payment:late-1 → /dashboard?order=late-1',
      'reprice:draft-moved → /new-prescription/search?editOrder=draft-moved',
      'stale_draft:draft-old → /dashboard?order=draft-old',
      'stuck_refund:refund-stuck → /dashboard?order=refund-stuck',
      'submission_failed:failed → /dashboard?order=failed',
      'submission_failed:fax-failed → /dashboard?order=fax-failed',
    ])
    // Stuck refunds and late payments are asked for THIS clinic.
    expect(stuckMock).toHaveBeenCalledWith(expect.anything(), NOW, { clinicId: CLINIC })
    expect(lateMock).toHaveBeenCalledWith(expect.anything(), NOW, { clinicId: CLINIC })
    // The drafts are run through the signing checks, with no signer.
    expect(checkBatchMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      clinicId: CLINIC, userId: null, orderIds: ['draft-old', 'draft-moved', 'draft-cost'], atSigning: false,
    }))
  })

  it('a provider is sent to sign a stale draft', async () => {
    const res = await loadAttention(world().client, { clinicId: CLINIC, viewerIsProvider: true, nowMs: NOW })
    expect(res.items.find(i => i.kind === 'stale_draft')!.href).toBe('/new-prescription/sign?orders=draft-old')
  })

  it('the reprice item says what moved', async () => {
    const res = await loadAttention(world().client, { clinicId: CLINIC, viewerIsProvider: false, nowMs: NOW })
    expect(res.items.find(i => i.kind === 'reprice')!.detail).toContain('$95.00 → $110.00')
  })

  describe('fail loud', () => {
    it('the orders read failing is named, and the other checks still report', async () => {
      const db = world()
      db.failOn('orders:select')
      const res = await loadAttention(db.client, { clinicId: CLINIC, viewerIsProvider: false, nowMs: NOW })
      expect(res.errors.map(e => e.check)).toContain('Unpaid, failed and draft orders')
      expect(res.items.some(i => i.kind === 'stuck_refund')).toBe(true)
    })

    it('a draft check that could not run is an error, not a clean draft', async () => {
      checkBatchMock.mockResolvedValue({ lines: [], signer: null, problems: [
        { orderId: 'draft-moved', medicationName: 'Semaglutide', code: 'price_unavailable', message: "Semaglutide: today's price could not be read." },
      ] })
      const res = await loadAttention(world().client, { clinicId: CLINIC, viewerIsProvider: false, nowMs: NOW })
      expect(res.errors).toEqual([expect.objectContaining({ error: "Semaglutide: today's price could not be read." })])
    })

    it('refunds and late payments that could not be read are named', async () => {
      stuckMock.mockResolvedValue({ ok: false, error: 'connection reset' })
      lateMock.mockResolvedValue({ ok: false, error: 'connection reset' })
      const res = await loadAttention(world().client, { clinicId: CLINIC, viewerIsProvider: false, nowMs: NOW })
      expect(res.errors.map(e => e.check).sort()).toEqual(['Late payments', 'Refunds'])
    })

    it('faxes that could not be read are named', async () => {
      const db = world()
      db.failOn('inbound_fax_queue:select')
      const res = await loadAttention(db.client, { clinicId: CLINIC, viewerIsProvider: false, nowMs: NOW })
      expect(res.errors.map(e => e.check)).toContain('Pharmacy faxes')
    })
  })
})
