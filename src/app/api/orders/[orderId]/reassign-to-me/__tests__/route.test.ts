/**
 * @jest-environment node
 *
 * WO-100 "Sign as me": POST /api/orders/[orderId]/reassign-to-me
 *
 *   - provider Chen takes over Patel's draft: every DRAFT line for that
 *     patient under Patel moves to Chen (provider_id + NPI snapshot),
 *     one audit row per line records from → to
 *   - already mine → 200, reassigned=false, no writes
 *   - non-provider session → 403; unlinked provider → 403
 *   - non-DRAFT → 409; unknown order → 404
 */

import { POST } from '../route'
import { REASSIGN_AUDIT_ACTOR } from '@/lib/orders/reassignment'

const CLINIC_ID   = 'a1000000-0000-0000-0000-000000000001'
const CHEN_ID     = 'a2000000-0000-0000-0000-000000000001'
const PATEL_ID    = 'a2000000-0000-0000-0000-000000000002'
const PATIENT_ID  = 'a3000000-0000-0000-0000-000000000001'
const ORDER_A     = 'a6000000-0000-0000-0000-00000000000a'
const ORDER_B     = 'a6000000-0000-0000-0000-00000000000b'
const CHEN_UID    = 'auth-uid-chen'

const getSessionMock = jest.fn()
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockResolvedValue({ auth: { getSession: () => getSessionMock() } }),
}))

type Row = Record<string, unknown>
let updates: Array<{ table: string; patch: Row; filters: Array<[string, string, unknown]> }> = []
let inserts: Array<{ table: string; rows: Row[] }> = []
const fixtures: Record<string, () => unknown> = {}

function makeChain(table: string) {
  const filters: Array<[string, string, unknown]> = []
  let pendingUpdate: Row | null = null
  const builder: Record<string, unknown> = {}
  builder['select'] = () => builder
  builder['update'] = (patch: Row) => { pendingUpdate = patch; return builder }
  builder['insert'] = (rows: Row[]) => {
    inserts.push({ table, rows })
    return Promise.resolve({ error: null })
  }
  builder['eq'] = (c: string, v: unknown) => { filters.push(['eq', c, v]); return builder }
  builder['is'] = (c: string, v: unknown) => { filters.push(['is', c, v]); return builder }
  builder['in'] = (c: string, v: unknown) => { filters.push(['in', c, v]); return builder }
  builder['maybeSingle'] = () => {
    if (table === 'providers') return Promise.resolve((fixtures['providers:me'] ?? (() => ({ data: null, error: null })))())
    return Promise.resolve((fixtures['orders:one'] ?? (() => ({ data: null, error: null })))())
  }
  builder['then'] = (resolve: (v: unknown) => unknown) => {
    if (pendingUpdate) {
      updates.push({ table, patch: pendingUpdate, filters })
      const result = (fixtures['orders:updated'] ?? (() => ({ data: [], error: null })))()
      return Promise.resolve(result).then(resolve)
    }
    const result = (fixtures['orders:siblings'] ?? (() => ({ data: [], error: null })))()
    return Promise.resolve(result).then(resolve)
  }
  return builder
}

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn().mockReturnValue({ from: (table: string) => makeChain(table) }),
}))

function call(orderId = ORDER_A) {
  return POST({} as import('next/server').NextRequest, { params: Promise.resolve({ orderId }) })
}

function session(appRole: string, userId = CHEN_UID) {
  return { data: { session: { user: { id: userId, user_metadata: { clinic_id: CLINIC_ID, app_role: appRole } } } } }
}

beforeEach(() => {
  updates = []
  inserts = []
  Object.keys(fixtures).forEach(k => delete fixtures[k])
  getSessionMock.mockResolvedValue(session('provider'))
  fixtures['providers:me'] = () => ({
    data: { provider_id: CHEN_ID, clinic_id: CLINIC_ID, first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', signature_hash: null },
    error: null,
  })
  fixtures['orders:one'] = () => ({
    data: { order_id: ORDER_A, status: 'DRAFT', clinic_id: CLINIC_ID, patient_id: PATIENT_ID, provider_id: PATEL_ID },
    error: null,
  })
  fixtures['orders:siblings'] = () => ({ data: [{ order_id: ORDER_A }, { order_id: ORDER_B }], error: null })
  fixtures['orders:updated'] = () => ({ data: [{ order_id: ORDER_A }, { order_id: ORDER_B }], error: null })
  jest.spyOn(console, 'info').mockImplementation(() => {})
})

afterEach(() => jest.restoreAllMocks())

describe('POST /api/orders/[orderId]/reassign-to-me', () => {
  it('moves every DRAFT line of the draft to the caller and writes an audit row per line', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ orderIds: [ORDER_A, ORDER_B], providerId: CHEN_ID, reassigned: true })

    expect(updates).toHaveLength(1)
    const update = updates[0]!
    expect(update.table).toBe('orders')
    expect(update.patch).toEqual(expect.objectContaining({ provider_id: CHEN_ID, provider_npi_snapshot: '1234567890' }))
    // CAS predicate: only rows still DRAFT and still Patel's move.
    expect(update.filters).toEqual(expect.arrayContaining([
      ['in', 'order_id', [ORDER_A, ORDER_B]],
      ['eq', 'status', 'DRAFT'],
      ['eq', 'provider_id', PATEL_ID],
    ]))

    expect(inserts).toHaveLength(1)
    const audit = inserts[0]!
    expect(audit.table).toBe('order_status_history')
    expect(audit.rows).toHaveLength(2)
    expect(audit.rows[0]).toEqual(expect.objectContaining({
      order_id:   ORDER_A,
      old_status: 'DRAFT',
      new_status: 'DRAFT',
      changed_by: CHEN_UID,
      metadata:   expect.objectContaining({
        actor:            REASSIGN_AUDIT_ACTOR,
        from_provider_id: PATEL_ID,
        to_provider_id:   CHEN_ID,
        reassigned_with:  [ORDER_B],
      }),
    }))
  })

  it('is a no-op when the draft is already mine', async () => {
    fixtures['orders:one'] = () => ({
      data: { order_id: ORDER_A, status: 'DRAFT', clinic_id: CLINIC_ID, patient_id: PATIENT_ID, provider_id: CHEN_ID },
      error: null,
    })
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ orderIds: [ORDER_A], providerId: CHEN_ID, reassigned: false })
    expect(updates).toHaveLength(0)
    expect(inserts).toHaveLength(0)
  })

  it('403 for a non-provider session', async () => {
    getSessionMock.mockResolvedValue(session('clinic_admin', 'auth-uid-admin'))
    const res = await call()
    expect(res.status).toBe(403)
    expect(updates).toHaveLength(0)
  })

  it('403 for a provider login with no linked provider row', async () => {
    fixtures['providers:me'] = () => ({ data: null, error: null })
    const res = await call()
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/not linked/i)
    expect(updates).toHaveLength(0)
  })

  it('409 when the order is no longer a draft', async () => {
    fixtures['orders:one'] = () => ({
      data: { order_id: ORDER_A, status: 'AWAITING_PAYMENT', clinic_id: CLINIC_ID, patient_id: PATIENT_ID, provider_id: PATEL_ID },
      error: null,
    })
    expect((await call()).status).toBe(409)
    expect(updates).toHaveLength(0)
  })

  it('404 when the order does not exist in this clinic', async () => {
    fixtures['orders:one'] = () => ({ data: null, error: null })
    expect((await call()).status).toBe(404)
  })

  it('409 when a concurrent change moved the target order first (CAS lost)', async () => {
    fixtures['orders:updated'] = () => ({ data: [{ order_id: ORDER_B }], error: null })
    const res = await call()
    expect(res.status).toBe(409)
    expect(inserts).toHaveLength(0)
  })
})
