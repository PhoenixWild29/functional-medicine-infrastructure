/**
 * @jest-environment node
 *
 * C-2026-10-26-04: B's review of phi-access-log-coverage (L1, L5, L6).
 *
 *   - L6: a call with no resolvable actor is a reported failure
 *     ('no_actor'), never silent.
 *   - L5: logPhiAccessBatch writes many rows (each its own patient, order
 *     and clinic) in ONE insert, and with dedupeMinutes skips the targets
 *     this actor already has a row for (same action and resource) inside
 *     the window, read back from phi_access_log itself (no migration).
 *     logPhiAccessMany rides on it.
 *   - L1: a write that was logged first and then did not complete gets a
 *     follow-up row, resource not_completed_<resource>, so the log never
 *     claims a change that did not happen.
 */

import { scriptedDb, DB_DOWN } from '@/__tests__/helpers/scripted-db'

let db = scriptedDb(() => undefined)
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
const slackMock = jest.fn(async () => true)
jest.mock('@/lib/slack/client', () => ({
  ...jest.requireActual('@/lib/slack/client'),
  sendSlackAlert: (...a: unknown[]) => slackMock(...(a as [])),
}))
const sentryMock = jest.fn()
jest.mock('@sentry/nextjs', () => ({ captureMessage: (...a: unknown[]) => sentryMock(...a) }))

jest.unmock('@/lib/audit/phi-access')
import {
  logPhiAccess, logPhiAccessMany, logPhiAccessBatch, logPhiWriteNotCompleted,
  PHI_ACCESS_HASH_ENV, __resetPhiAlertThrottle,
} from '../phi-access'
import { resourceLabel } from '../access-log-view'

const USER = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'dr.chen@sunrise.example',
  app_metadata: { app_role: 'provider', clinic_id: '22222222-2222-4222-8222-222222222222' },
}
const P1 = '33333333-3333-4333-8333-333333333331'
const P2 = '33333333-3333-4333-8333-333333333332'
const P3 = '33333333-3333-4333-8333-333333333333'
const O1 = '44444444-4444-4444-8444-444444444441'
const O2 = '44444444-4444-4444-8444-444444444442'

const inserts = () => db.to('phi_access_log', 'insert')
const insertedRows = () => inserts().flatMap(c => (Array.isArray(c.payload) ? c.payload : [c.payload]) as Array<Record<string, unknown>>)

beforeEach(() => {
  db = scriptedDb(() => undefined)
  slackMock.mockClear()
  sentryMock.mockClear()
  __resetPhiAlertThrottle()
  process.env[PHI_ACCESS_HASH_ENV] = 'test-audit-secret'
  for (const level of ['info', 'warn', 'error'] as const) jest.spyOn(console, level).mockImplementation(() => {})
})
afterEach(() => {
  jest.restoreAllMocks()
  delete process.env[PHI_ACCESS_HASH_ENV]
})

describe('L6: no resolvable actor is reported, never silent', () => {
  it('logPhiAccess with no user and no actor: false, nothing written, one no_actor alert', async () => {
    expect(await logPhiAccess({ user: null, action: 'view', resource: 'inbound_fax', route: '/ops/fax' })).toBe(false)
    expect(inserts()).toHaveLength(0)
    expect(slackMock).toHaveBeenCalledTimes(1)
    expect(sentryMock).toHaveBeenCalledWith('phi_access_log write failed', expect.objectContaining({ tags: expect.objectContaining({ code: 'no_actor', route: '/ops/fax' }) }))
  })

  it('logPhiAccessMany with no actor: the same', async () => {
    expect(await logPhiAccessMany({ user: null, action: 'view', resource: 'order_list', route: '/dashboard' }, [P1])).toBe(false)
    expect(sentryMock).toHaveBeenCalledWith('phi_access_log write failed', expect.objectContaining({ tags: expect.objectContaining({ code: 'no_actor' }) }))
  })
})

describe('L5: one insert for many targets, and the 15-minute dedupe', () => {
  it('logPhiAccessBatch writes every target in one insert, each with its own ids', async () => {
    const ok = await logPhiAccessBatch({ user: USER, action: 'view', resource: 'inbound_fax', route: '/ops/fax' }, [
      { orderId: O1, patientId: P1, clinicId: 'c-1' },
      { orderId: O2, patientId: P2, clinicId: 'c-2' },
      {},
    ])
    expect(ok).toBe(true)
    expect(inserts()).toHaveLength(1)
    expect(insertedRows()).toEqual([
      expect.objectContaining({ order_id: O1, patient_id: P1, clinic_id: 'c-1', resource: 'inbound_fax' }),
      expect.objectContaining({ order_id: O2, patient_id: P2, clinic_id: 'c-2' }),
      expect.objectContaining({ order_id: null, patient_id: null }),
    ])
  })

  it('dedupe: the targets already logged by this actor for this action and resource in 15 minutes are skipped', async () => {
    db = scriptedDb(c => (c.table === 'phi_access_log' && c.op === 'select' ? { data: [{ patient_id: P1, order_id: null }] } : undefined))
    const ok = await logPhiAccessMany({ user: USER, action: 'view', resource: 'order_list', route: '/api/dashboard/orders' }, [P1, P2, P3], { dedupeMinutes: 15 })
    expect(ok).toBe(true)
    const read = db.to('phi_access_log', 'select')[0]!
    expect(read.filters).toMatchObject({ actor_user_id: USER.id, action: 'view', resource: 'order_list' })
    expect(Date.now() - Date.parse(String(read.filters['occurred_at:gte']))).toBeGreaterThanOrEqual(15 * 60_000 - 1000)
    expect(insertedRows().map(r => r['patient_id'])).toEqual([P2, P3])
  })

  it('dedupe: everything already logged writes nothing and is true', async () => {
    db = scriptedDb(c => (c.table === 'phi_access_log' && c.op === 'select' ? { data: [{ patient_id: P1, order_id: null }, { patient_id: P2, order_id: null }] } : undefined))
    expect(await logPhiAccessMany({ user: USER, action: 'view', resource: 'order_list', route: '/x' }, [P1, P2, P1], { dedupeMinutes: 15 })).toBe(true)
    expect(inserts()).toHaveLength(0)
  })

  it('dedupe keys on patient AND order (the fax queue: one order is one target)', async () => {
    db = scriptedDb(c => (c.table === 'phi_access_log' && c.op === 'select' ? { data: [{ patient_id: P1, order_id: O1 }] } : undefined))
    await logPhiAccessBatch({ user: USER, action: 'view', resource: 'inbound_fax', route: '/ops/fax' },
      [{ orderId: O1, patientId: P1 }, { orderId: O2, patientId: P1 }], { dedupeMinutes: 15 })
    expect(insertedRows().map(r => r['order_id'])).toEqual([O2])
  })

  it('dedupe: when the read-back fails, every target is written (never fewer rows than accesses)', async () => {
    db = scriptedDb(c => (c.table === 'phi_access_log' && c.op === 'select' ? DB_DOWN : undefined))
    expect(await logPhiAccessMany({ user: USER, action: 'view', resource: 'order_list', route: '/x' }, [P1, P2], { dedupeMinutes: 15 })).toBe(true)
    expect(insertedRows()).toHaveLength(2)
  })

  it('without dedupeMinutes nothing is read back (writes and single records always log)', async () => {
    await logPhiAccessMany({ user: USER, action: 'update', resource: 'patient', route: '/x' }, [P1])
    expect(db.to('phi_access_log', 'select')).toHaveLength(0)
    expect(insertedRows()).toHaveLength(1)
  })

  it('a failed batch insert is false and alerts', async () => {
    db = scriptedDb(c => (c.table === 'phi_access_log' && c.op === 'insert' ? DB_DOWN : undefined))
    expect(await logPhiAccessBatch({ user: USER, action: 'sign', resource: 'prescription', route: '/api/orders/batch-sign' }, [{ orderId: O1, patientId: P1 }])).toBe(false)
    expect(slackMock).toHaveBeenCalledTimes(1)
  })
})

describe('L1: a logged write that did not complete gets a follow-up row', () => {
  it('logPhiWriteNotCompleted writes not_completed_<resource> with the same ids and action', async () => {
    expect(await logPhiWriteNotCompleted({ user: USER, action: 'update', resource: 'patient_allergies', route: '/api/patients/[patientId]/allergies', patientId: P1 })).toBe(true)
    expect(insertedRows()[0]).toMatchObject({ action: 'update', resource: 'not_completed_patient_allergies', patient_id: P1 })
  })

  it('the clinic access log labels it', () => {
    expect(resourceLabel('not_completed_patient_allergies')).toMatch(/^Not completed: /)
  })
})
