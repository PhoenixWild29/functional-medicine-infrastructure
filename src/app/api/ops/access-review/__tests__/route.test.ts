/**
 * @jest-environment node
 *
 * B16: GET /api/ops/access-review. ops_admin only; the filters reach the
 * phi_access_log query; the rows come back flagged; the review itself is
 * logged (a view, and an export for the CSV).
 */

import { NextRequest } from 'next/server'
import { scriptedDb } from '@/__tests__/helpers/scripted-db'
import { phiLog, phiEntries, expectOnePhiRow } from '@/__tests__/helpers/phi-log'

const CLINIC = '11111111-1111-4111-8111-111111111111'
const ACTOR = '22222222-2222-4222-8222-222222222222'
const GONE = '33333333-3333-4333-8333-333333333333'
let session: unknown = null
let db = scriptedDb(() => undefined)
let users: Record<string, { id: string; app_metadata: Record<string, unknown> } | null> = {}

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getSession: async () => ({ data: { session } }), getUser: async () => userFromSession({ data: { session } }) } }),
}))
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    ...db.client,
    auth: { admin: { getUserById: async (id: string) => ({ data: { user: users[id] ?? null }, error: users[id] ? null : { message: 'User not found' } }) } },
  }),
}))

import { GET } from '../route'
import { userFromSession, withForgedSession } from '@/__tests__/helpers/auth-from-session'

const LOG_ROWS = [
  { id: 'a', occurred_at: '2026-10-20T15:00:00.000Z', actor_user_id: ACTOR, actor_role: 'provider', clinic_id: CLINIC, patient_id: 'p-1', order_id: null, action: 'view', resource: 'patient', route: '/api/patients/[id]' },
  { id: 'b', occurred_at: '2026-10-20T23:10:00.000Z', actor_user_id: ACTOR, actor_role: 'provider', clinic_id: CLINIC, patient_id: 'p-2', order_id: null, action: 'view', resource: 'patient', route: '/api/patients/[id]' },
  { id: 'c', occurred_at: '2026-10-21T10:00:00.000Z', actor_user_id: GONE, actor_role: 'medical_assistant', clinic_id: CLINIC, patient_id: 'p-1', order_id: null, action: 'view', resource: 'patient', route: '/api/patients/[id]' },
]

const call = (qs = '') => GET(new NextRequest(`http://localhost/api/ops/access-review${qs}`))

beforeEach(() => {
  phiLog.mockClear()
  session = { user: { id: 'ops-1', email: 'ops@compoundiq.example', app_metadata: { app_role: 'ops_admin' } } }
  users = {
    [ACTOR]: { id: ACTOR, app_metadata: { app_role: 'provider', clinic_id: CLINIC } },
    [GONE]: { id: GONE, app_metadata: { app_role: 'medical_assistant', clinic_id: CLINIC, deactivated_at: '2026-10-01T00:00:00Z' } },
  }
  db = scriptedDb(c => {
    if (c.table === 'phi_access_log') return { data: LOG_ROWS }
    // p-1 has an order in the clinic; p-2 has nothing there.
    if (c.table === 'orders') return { data: [{ clinic_id: CLINIC, patient_id: 'p-1' }] }
    if (c.table === 'treatment_proposals') return { data: [] }
    return { data: [] }
  })
})

describe('the role gate', () => {
  it('401 without a verified user', async () => {
    expect((await withForgedSession(() => call())).status).toBe(401)
  })

  it.each(['clinic_admin', 'provider', 'medical_assistant', 'pharmacy_admin'])('403 for %s, and nothing is read or logged', async role => {
    session = { user: { id: 'u1', app_metadata: { app_role: role, clinic_id: CLINIC } } }
    expect((await call()).status).toBe(403)
    expect((await call('?format=csv')).status).toBe(403)
    expect(db.calls.filter(c => c.table === 'phi_access_log')).toHaveLength(0)
    expect(phiEntries()).toHaveLength(0)
  })
})

describe('filters', () => {
  it('passes every filter to the phi_access_log query', async () => {
    const res = await call(`?from=2026-10-19&to=2026-10-25&clinicId=${CLINIC}&actorUserId=${ACTOR}&actorRole=provider&resource=patient&action=view`)
    expect(res.status).toBe(200)
    const q = db.calls.find(c => c.table === 'phi_access_log' && c.op === 'select')!
    expect(q.filters).toEqual(expect.objectContaining({
      'occurred_at:gte': '2026-10-19T00:00:00.000Z',
      'occurred_at:lt':  '2026-10-26T00:00:00.000Z',
      clinic_id: CLINIC, actor_user_id: ACTOR, actor_role: 'provider', resource: 'patient', action: 'view',
    }))
  })

  it('a malformed filter is a 400 naming it, before any read', async () => {
    const res = await call('?clinicId=nope&action=delete')
    expect(res.status).toBe(400)
    expect(((await res.json()) as { fields: string[] }).fields.sort()).toEqual(['action', 'clinicId'])
    expect(db.calls).toHaveLength(0)
  })
})

describe('flags', () => {
  it('flags outside hours, a deactivated actor and a patient with no order or proposal in the clinic', async () => {
    const body = await (await call()).json() as { rows: { id: string; flags: string[] }[]; flagCounts: Record<string, number>; timezone: string; bulkThreshold: number }
    const byId = Object.fromEntries(body.rows.map(r => [r.id, r.flags]))
    expect(byId['a']).toEqual([])
    expect(byId['b']).toEqual(['outside_hours', 'no_relationship'])
    expect(byId['c']).toEqual(['deactivated_actor'])
    expect(body.flagCounts).toEqual({ outside_hours: 1, bulk_patients: 0, deactivated_actor: 1, no_relationship: 1 })
    expect(body.timezone).toBe('UTC')
    expect(body.bulkThreshold).toBe(30)
  })

  it('a login that no longer exists counts as deactivated', async () => {
    delete users[GONE]
    const body = await (await call()).json() as { rows: { id: string; flags: string[] }[] }
    expect(body.rows.find(r => r.id === 'c')!.flags).toEqual(['deactivated_actor'])
  })

  it('a failed read is a 500, not a page of rows with no flags', async () => {
    db = scriptedDb(c => (c.table === 'orders' ? { error: { message: 'timeout' } } : c.table === 'phi_access_log' ? { data: LOG_ROWS } : { data: [] }))
    expect((await call()).status).toBe(500)
  })
})

describe('the review is itself logged', () => {
  it('viewing logs one view of the access log', async () => {
    await call(`?clinicId=${CLINIC}`)
    expectOnePhiRow({ action: 'view', resource: 'access_log', route: '/api/ops/access-review', clinicId: CLINIC })
  })

  it('the CSV export logs one export, and answers a CSV attachment', async () => {
    const res = await call('?format=csv&from=2026-10-19&to=2026-10-25')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/^text\/csv/)
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="access-review-2026-10-19_2026-10-25.csv"')
    expect(res.headers.get('cache-control')).toBe('no-store')
    const text = await res.text()
    expect(text.trimEnd().split('\n')).toHaveLength(1 + LOG_ROWS.length)
    expectOnePhiRow({ action: 'export', resource: 'access_log', route: '/api/ops/access-review' })
  })
})
