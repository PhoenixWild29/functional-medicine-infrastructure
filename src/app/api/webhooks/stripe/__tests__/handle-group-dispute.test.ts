/**
 * @jest-environment node
 *
 * Phase C Stage 6 — charge.dispute.created handling for group PIs.
 *
 * Pins the new dispute branches that fire only for group flavor:
 *   - missing payment_intent on the dispute  → loud log, no writes
 *   - group not found via PI lookup           → loud log, no writes
 *   - metadata.payment_group_id mismatches    → reject, no writes
 *   - already-DISPUTED group                  → idempotent no-op
 *   - empty members                           → still mark group DISPUTED, skip disputes/junction inserts
 *   - happy path                              → disputes insert + N junction rows, group DISPUTED, ops alert
 *   - some members terminal (SHIPPED)         → still mark DISPUTED, warn log
 *   - disputes insert failure                 → group still marked DISPUTED, ops still alerted
 *   - 3-member group                          → 3 junction rows (dispute_orders fan-out)
 *   - re-delivery before DISPUTED status      → junction upsert is idempotent on (dispute_id, order_id) PK
 *   - dispute_orders fan-out failure          → group still marked DISPUTED, ops still alerted
 */

import type Stripe from 'stripe'
import { handleGroupChargeDisputeCreated } from '../handle-group-dispute'

// ── Mocks ──────────────────────────────────────────────────────────

const groupFetchMock           = jest.fn()
const groupUpdateMock          = jest.fn().mockResolvedValue({ error: null })
const membersFetchMock         = jest.fn()
const disputesUpsertMock       = jest.fn().mockResolvedValue({ error: null })
const disputeOrdersUpsertMock  = jest.fn().mockResolvedValue({ error: null })
const sendSlackAlertMock       = jest.fn().mockResolvedValue(undefined)
const buildAlertMock           = jest.fn().mockReturnValue({ text: 'alert' })

const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
const warnSpy  = jest.spyOn(console, 'warn').mockImplementation(() => {})
const infoSpy  = jest.spyOn(console, 'info').mockImplementation(() => {})

const supabaseMock = {
  from: (table: string) => {
    if (table === 'payment_groups') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => groupFetchMock(),
          }),
        }),
        update: () => ({
          eq: () => ({
            neq: () => groupUpdateMock(),
          }),
        }),
      }
    }
    if (table === 'orders') {
      return {
        select: () => ({
          eq: () => ({
            is: () => membersFetchMock(),
          }),
        }),
      }
    }
    if (table === 'disputes') {
      return {
        upsert: (row: unknown) => disputesUpsertMock(row),
      }
    }
    if (table === 'dispute_orders') {
      return {
        upsert: (rows: unknown) => disputeOrdersUpsertMock(rows),
      }
    }
    throw new Error(`Unexpected table in test: ${table}`)
  },
} as unknown as Parameters<typeof handleGroupChargeDisputeCreated>[1]['supabase']

function makeDispute(overrides: Partial<Stripe.Dispute> = {}): Stripe.Dispute {
  return {
    id: 'dp_test_group_1',
    payment_intent: 'pi_test_group_1',
    amount: 30000,
    currency: 'usd',
    reason: 'fraudulent',
    status: 'needs_response',
    metadata: {
      payment_group_id: 'group-aaa',
      clinic_id: 'clinic-1',
      order_count: '2',
      platform: '8090ai',
    },
    ...overrides,
  } as unknown as Stripe.Dispute
}

function invoke(dispute: Stripe.Dispute) {
  return handleGroupChargeDisputeCreated(dispute, {
    supabase: supabaseMock,
    sendSlackAlert: sendSlackAlertMock,
    buildAdapterFailureAlert: buildAlertMock,
  })
}

// ── Setup ──────────────────────────────────────────────────────────

beforeEach(() => {
  groupFetchMock.mockReset()
  groupUpdateMock.mockReset().mockResolvedValue({ error: null })
  membersFetchMock.mockReset()
  disputesUpsertMock.mockReset().mockResolvedValue({ error: null })
  disputeOrdersUpsertMock.mockReset().mockResolvedValue({ error: null })
  sendSlackAlertMock.mockReset().mockResolvedValue(undefined)
  buildAlertMock.mockReset().mockReturnValue({ text: 'alert' })
  errorSpy.mockClear()
  warnSpy.mockClear()
  infoSpy.mockClear()

  groupFetchMock.mockResolvedValue({
    data: {
      group_id: 'group-aaa',
      status: 'PAID',
      clinic_id: 'clinic-1',
      stripe_payment_intent_id: 'pi_test_group_1',
    },
    error: null,
  })
  membersFetchMock.mockResolvedValue({
    data: [
      { order_id: 'o-1', status: 'PAID_PROCESSING' },
      { order_id: 'o-2', status: 'PAID_PROCESSING' },
    ],
    error: null,
  })
})

afterAll(() => {
  errorSpy.mockRestore()
  warnSpy.mockRestore()
  infoSpy.mockRestore()
})

// ── Tests ──────────────────────────────────────────────────────────

describe('Phase C Stage 6 — handleGroupChargeDisputeCreated', () => {
  it('happy path: inserts disputes row, fans out N junction rows, marks group DISPUTED, alerts ops', async () => {
    await invoke(makeDispute())

    expect(disputesUpsertMock).toHaveBeenCalledTimes(1)
    expect(disputesUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        dispute_id: 'dp_test_group_1',
        order_id: 'o-1', // representative member (legacy disputes.order_id NOT NULL)
        payment_intent_id: 'pi_test_group_1',
        reason: 'fraudulent',
        amount: 30000,
        currency: 'usd',
        status: 'needs_response',
      }),
    )
    // Fan-out: one junction row per member, regardless of disputes
    // row outcome. 2 members → 2 rows.
    expect(disputeOrdersUpsertMock).toHaveBeenCalledTimes(1)
    expect(disputeOrdersUpsertMock).toHaveBeenCalledWith([
      { dispute_id: 'dp_test_group_1', order_id: 'o-1' },
      { dispute_id: 'dp_test_group_1', order_id: 'o-2' },
    ])
    expect(groupUpdateMock).toHaveBeenCalledTimes(1)
    expect(sendSlackAlertMock).toHaveBeenCalledTimes(1)
    expect(buildAlertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        integrationTier: 'STRIPE_DISPUTE_GROUP',
        errorCode: expect.stringContaining('group=group-aaa'),
      }),
    )
  })

  it('returns early when dispute has no payment_intent', async () => {
    await invoke(makeDispute({ payment_intent: null as unknown as string }))

    expect(groupFetchMock).not.toHaveBeenCalled()
    expect(disputesUpsertMock).not.toHaveBeenCalled()
    expect(groupUpdateMock).not.toHaveBeenCalled()
    expect(sendSlackAlertMock).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/has no payment_intent/))
  })

  it('returns early + logs loudly when no group matches the PI', async () => {
    groupFetchMock.mockResolvedValue({ data: null, error: null })

    await invoke(makeDispute())

    expect(disputesUpsertMock).not.toHaveBeenCalled()
    expect(groupUpdateMock).not.toHaveBeenCalled()
    expect(sendSlackAlertMock).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/group not found for dispute/),
      undefined,
    )
  })

  it('rejects when metadata.payment_group_id mismatches resolved group', async () => {
    groupFetchMock.mockResolvedValue({
      data: {
        group_id: 'group-zzz', // different from metadata.payment_group_id
        status: 'PAID',
        clinic_id: 'clinic-1',
        stripe_payment_intent_id: 'pi_test_group_1',
      },
      error: null,
    })

    await invoke(makeDispute())

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/dispute metadata payment_group_id mismatch/),
    )
    expect(disputesUpsertMock).not.toHaveBeenCalled()
    expect(groupUpdateMock).not.toHaveBeenCalled()
    expect(sendSlackAlertMock).not.toHaveBeenCalled()
  })

  it('is idempotent: re-delivery on already-DISPUTED group is a no-op', async () => {
    groupFetchMock.mockResolvedValue({
      data: {
        group_id: 'group-aaa',
        status: 'DISPUTED',
        clinic_id: 'clinic-1',
        stripe_payment_intent_id: 'pi_test_group_1',
      },
      error: null,
    })

    await invoke(makeDispute())

    expect(disputesUpsertMock).not.toHaveBeenCalled()
    expect(groupUpdateMock).not.toHaveBeenCalled()
    expect(sendSlackAlertMock).not.toHaveBeenCalled()
    expect(infoSpy).toHaveBeenCalledWith(expect.stringMatching(/already DISPUTED/))
  })

  it('empty members: still marks group DISPUTED, skips disputes + junction inserts, still alerts ops', async () => {
    membersFetchMock.mockResolvedValue({ data: [], error: null })

    await invoke(makeDispute())

    expect(disputesUpsertMock).not.toHaveBeenCalled()
    expect(disputeOrdersUpsertMock).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/has no member orders/))
    expect(groupUpdateMock).toHaveBeenCalledTimes(1)
    expect(sendSlackAlertMock).toHaveBeenCalledTimes(1)
  })

  it('partial terminal members: still marks group DISPUTED, logs partial state', async () => {
    membersFetchMock.mockResolvedValue({
      data: [
        { order_id: 'o-1', status: 'SHIPPED' }, // already terminal
        { order_id: 'o-2', status: 'PAID_PROCESSING' },
      ],
      error: null,
    })

    await invoke(makeDispute())

    expect(disputesUpsertMock).toHaveBeenCalledTimes(1)
    expect(groupUpdateMock).toHaveBeenCalledTimes(1)
    expect(sendSlackAlertMock).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/1\/2 member order\(s\) already terminal/),
    )
  })

  it('disputes insert failure: junction still attempted, group DISPUTED, ops alerted', async () => {
    disputesUpsertMock.mockResolvedValue({ error: { message: 'duplicate dispute_id' } })

    await invoke(makeDispute())

    expect(disputesUpsertMock).toHaveBeenCalledTimes(1)
    // Junction fan-out still runs — its (dispute_id, order_id) upsert is
    // independent and provides ops correlation even if the event row
    // failed.
    expect(disputeOrdersUpsertMock).toHaveBeenCalledTimes(1)
    // Group still marked DISPUTED + ops alerted — over-alert beats silent drop
    expect(groupUpdateMock).toHaveBeenCalledTimes(1)
    expect(sendSlackAlertMock).toHaveBeenCalledTimes(1)
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/failed to insert dispute row/),
      'duplicate dispute_id',
    )
  })

  it('resolves payment_intent when it arrives as an expanded object (not just a string)', async () => {
    const expanded = makeDispute({
      payment_intent: { id: 'pi_test_group_1' } as unknown as Stripe.PaymentIntent,
    })

    await invoke(expanded)

    expect(disputesUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent_id: 'pi_test_group_1' }),
    )
    expect(groupUpdateMock).toHaveBeenCalledTimes(1)
  })

  it('all members terminal: still marks group DISPUTED, warn log, ops alerted', async () => {
    membersFetchMock.mockResolvedValue({
      data: [
        { order_id: 'o-1', status: 'DELIVERED' },
        { order_id: 'o-2', status: 'SHIPPED' },
      ],
      error: null,
    })

    await invoke(makeDispute())

    expect(disputesUpsertMock).toHaveBeenCalledTimes(1)
    expect(groupUpdateMock).toHaveBeenCalledTimes(1)
    expect(sendSlackAlertMock).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/2\/2 member order\(s\) already terminal/),
    )
  })

  it('group_update failure is logged but does not throw', async () => {
    groupUpdateMock.mockResolvedValue({ error: { message: 'rls denied' } })

    await expect(invoke(makeDispute())).resolves.toBeUndefined()

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/failed to mark group DISPUTED/),
      'rls denied',
    )
    // Ops alert still fires
    expect(sendSlackAlertMock).toHaveBeenCalledTimes(1)
  })

  // ── Phase C disputes fan-out (migration 20260614000001) ──────

  it('3-member group: fans out exactly 3 rows into dispute_orders', async () => {
    membersFetchMock.mockResolvedValue({
      data: [
        { order_id: 'o-1', status: 'PAID_PROCESSING' },
        { order_id: 'o-2', status: 'PAID_PROCESSING' },
        { order_id: 'o-3', status: 'PAID_PROCESSING' },
      ],
      error: null,
    })

    await invoke(makeDispute())

    expect(disputeOrdersUpsertMock).toHaveBeenCalledTimes(1)
    expect(disputeOrdersUpsertMock).toHaveBeenCalledWith([
      { dispute_id: 'dp_test_group_1', order_id: 'o-1' },
      { dispute_id: 'dp_test_group_1', order_id: 'o-2' },
      { dispute_id: 'dp_test_group_1', order_id: 'o-3' },
    ])
    // disputes (event-level) still ONE row, anchored to first member
    expect(disputesUpsertMock).toHaveBeenCalledTimes(1)
    expect(disputesUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ dispute_id: 'dp_test_group_1', order_id: 'o-1' }),
    )
  })

  it('solo-flavor group (1 member): fan-out writes exactly 1 junction row (regression check)', async () => {
    // A group with a single member — represents the degenerate
    // "group of one" surface. Asserts we did not introduce a regression
    // for the 1-member path; matches the solo-dispute table footprint
    // of 1 disputes row + 1 junction row.
    membersFetchMock.mockResolvedValue({
      data: [{ order_id: 'o-only', status: 'PAID_PROCESSING' }],
      error: null,
    })

    await invoke(makeDispute())

    expect(disputesUpsertMock).toHaveBeenCalledTimes(1)
    expect(disputesUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ order_id: 'o-only' }),
    )
    expect(disputeOrdersUpsertMock).toHaveBeenCalledTimes(1)
    expect(disputeOrdersUpsertMock).toHaveBeenCalledWith([
      { dispute_id: 'dp_test_group_1', order_id: 'o-only' },
    ])
    expect(groupUpdateMock).toHaveBeenCalledTimes(1)
  })

  it('idempotent on re-delivery: junction upsert is safe (relies on composite PK)', async () => {
    // Stripe redelivers the same charge.dispute.created event before
    // payment_groups.status flips to DISPUTED (eg. status update is
    // racing the redelivery). The early-exit at "already DISPUTED"
    // catches the post-flip case; the junction upsert covers the
    // pre-flip race. Both insert paths are upserts keyed on their PKs,
    // so re-delivery is a no-op at the DB layer.
    await invoke(makeDispute())
    await invoke(makeDispute())

    expect(disputesUpsertMock).toHaveBeenCalledTimes(2)
    // Both invocations sent the same payload — DB upsert dedupes on PK.
    expect(disputesUpsertMock.mock.calls[0]).toEqual(disputesUpsertMock.mock.calls[1])
    expect(disputeOrdersUpsertMock).toHaveBeenCalledTimes(2)
    expect(disputeOrdersUpsertMock.mock.calls[0]).toEqual(disputeOrdersUpsertMock.mock.calls[1])
  })

  it('dispute_orders fan-out failure: still marks group DISPUTED + alerts ops', async () => {
    disputeOrdersUpsertMock.mockResolvedValue({
      error: { message: 'fk violation: orders.order_id not found' },
    })

    await invoke(makeDispute())

    expect(disputeOrdersUpsertMock).toHaveBeenCalledTimes(1)
    // Group transition + ops alert still fire — over-alert beats silent drop
    expect(groupUpdateMock).toHaveBeenCalledTimes(1)
    expect(sendSlackAlertMock).toHaveBeenCalledTimes(1)
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/failed to fan out dispute_orders/),
      'fk violation: orders.order_id not found',
    )
  })
})
