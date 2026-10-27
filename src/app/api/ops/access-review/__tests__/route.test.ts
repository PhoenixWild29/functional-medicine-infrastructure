/**
 * @jest-environment node
 *
 * B16: GET /api/ops/access-review. ops_admin only; the filters reach the
 * phi_access_log query; the rows come back flagged; the review itself is
 * logged (a view, and an export for the CSV).
 */

import { NextRequest } from 'next/server'
import { scriptedDb, type ScriptedAnswer, type ScriptedCall } from '@/__tests__/helpers/scripted-db'
import { phiLog, phiEntries, expectOnePhiRow } from '@/__tests__/helpers/phi-log'

const CLINIC = '11111111-1111-4111-8111-111111111111'
const ACTOR = '22222222-2222-4222-8222-222222222222'
const GONE = '33333333-3333-4333-8333-333333333333'
let session: unknown = null
let db = scriptedDb(() => undefined)
let users: Record<string, { id: string; app_metadata: Record<string, unknown> } | null> = {}
// D2: an Auth error other than "not found" (404).
let lookupError: { message: string; status: number } | null = null

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getSession: async () => ({ data: { session } }), getUser: async () => userFromSession({ data: { session } }) } }),
}))
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    ...(db.client as Record<string, unknown>),
    auth: { admin: { getUserById: async (id: string) => (lookupError
      ? { data: { user: null }, error: lookupError }
      : { data: { user: users[id] ?? null }, error: users[id] ? null : { message: 'User not found', status: 404 } }) } },
  }),
}))

import { GET } from '../route'
import { userFromSession, withForgedSession } from '@/__tests__/helpers/auth-from-session'

const LOG_ROWS = [
  { id: 'a', occurred_at: '2026-10-20T15:00:00.000Z', actor_user_id: ACTOR, actor_role: 'provider', clinic_id: CLINIC, patient_id: 'p-1', order_id: null, action: 'view', resource: 'patient', route: '/api/patients/[id]' },
  { id: 'b', occurred_at: '2026-10-20T23:10:00.000Z', actor_user_id: ACTOR, actor_role: 'provider', clinic_id: CLINIC, patient_id: 'p-2', order_id: null, action: 'view', resource: 'patient', route: '/api/patients/[id]' },
  { id: 'c', occurred_at: '2026-10-21T10:00:00.000Z', actor_user_id: GONE, actor_role: 'medical_assistant', clinic_id: CLINIC, patient_id: 'p-1', order_id: null, action: 'view', resource: 'patient', route: '/api/patients/[id]' },
]

function defaultScript(c: ScriptedCall): ScriptedAnswer {
  if (c.table === 'phi_access_log') return { data: LOG_ROWS }
  // p-1 has an order in the clinic; p-2 has nothing there.
  if (c.table === 'orders') return { data: [{ clinic_id: CLINIC, patient_id: 'p-1' }] }
  return { data: [] }
}

const call = (qs = '') => GET(new NextRequest(`http://localhost/api/ops/access-review${qs}`))

beforeEach(() => {
  phiLog.mockClear()
  session = { user: { id: 'ops-1', email: 'ops@compoundiq.example', app_metadata: { app_role: 'ops_admin' } } }
  users = {
    [ACTOR]: { id: ACTOR, app_metadata: { app_role: 'provider', clinic_id: CLINIC } },
    [GONE]: { id: GONE, app_metadata: { app_role: 'medical_assistant', clinic_id: CLINIC, deactivated_at: '2026-10-01T00:00:00Z' } },
  }
  lookupError = null
  db = scriptedDb(defaultScript)
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
    const body = await (await call()).json() as { rows: { id: string; flags: string[] }[]; flagCounts: Record<string, number>; timeZoneBasis: string; bulkThreshold: number }
    const byId = Object.fromEntries(body.rows.map(r => [r.id, r.flags]))
    expect(byId['a']).toEqual([])
    expect(byId['b']).toEqual(['outside_hours', 'no_relationship'])
    expect(byId['c']).toEqual(['deactivated_actor'])
    expect(body.flagCounts).toEqual({ outside_hours: 1, bulk_patients: 0, deactivated_actor: 1, no_relationship: 1 })
    expect(body.timeZoneBasis).toBe('clinic_state')
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

// ── C's review, 7b (D1 to D4) ───────────────────────────────

describe('D1: hours in the clinic time zone', () => {
  it('reads each clinic state, and judges hours in that zone', async () => {
    db = scriptedDb(c => (c.table === 'clinics' ? { data: [{ clinic_id: CLINIC, state: 'CA' }] } : defaultScript(c)))
    const body = await (await call()).json() as { rows: { id: string; flags: string[]; time_zone: string }[] }
    // 23:10Z is 4:10pm in Los Angeles.
    expect(body.rows.find(r => r.id === 'b')).toEqual(expect.objectContaining({ flags: ['no_relationship'], time_zone: 'America/Los_Angeles' }))
    expect(db.calls.find(c => c.table === 'clinics')!.filters['clinic_id:in']).toEqual([CLINIC])
  })
})

describe('D2: newest first; patient and system actors; lookup errors', () => {
  it('asks for the newest rows first, so a cut-off review keeps the latest', async () => {
    const orderSpy = jest.fn()
    const client = db.client as Record<string, unknown>
    const base = client['from'] as (t: string) => Record<string, (...a: unknown[]) => unknown>
    client['from'] = ((t: string) => {
      const b = base(t)
      if (t === 'phi_access_log') {
        const order = b['order']!
        b['order'] = (...a: unknown[]) => { orderSpy(...a); return order(...a) }
      }
      return b
    }) as never
    await call()
    expect(orderSpy).toHaveBeenCalledWith('occurred_at', { ascending: false })
  })

  it('does not look up, or flag, patient and system actors', async () => {
    const lookups: string[] = []
    const rows = [
      { ...LOG_ROWS[0]!, id: 'pt', actor_role: 'patient', actor_user_id: '44444444-4444-4444-8444-444444444444' },
      { ...LOG_ROWS[0]!, id: 'sys', actor_role: 'system', actor_user_id: '00000000-0000-0000-0000-000000000000' },
    ]
    db = scriptedDb(c => (c.table === 'phi_access_log' ? { data: rows } : c.table === 'orders' ? { data: [{ clinic_id: CLINIC, patient_id: 'p-1' }] } : { data: [] }))
    const real = users
    users = new Proxy(real, { get: (t, k: string) => { lookups.push(k); return t[k] } })
    const body = await (await call()).json() as { rows: { id: string; flags: string[] }[] }
    expect(body.rows.every(r => r.flags.length === 0)).toBe(true)
    expect(lookups).toEqual([])
  })

  it('a lookup error is unknown, not deactivated, and is counted', async () => {
    lookupError = { message: 'upstream timeout', status: 500 }
    const body = await (await call()).json() as { rows: { id: string; flags: string[] }[]; actorLookupFailures: number }
    expect(body.rows.find(r => r.id === 'a')!.flags).toEqual([])
    expect(body.rows.find(r => r.id === 'c')!.flags).toEqual([])
    expect(body.actorLookupFailures).toBe(2)
  })
})

describe('D3: a cut-off CSV says so', () => {
  it('marks the file and the header when more rows exist than the limit', async () => {
    const many = Array.from({ length: 5001 }, (_, i) => ({ ...LOG_ROWS[0]!, id: `m${i}` }))
    db = scriptedDb(c => (c.table === 'phi_access_log' ? { data: many } : c.table === 'orders' ? { data: [{ clinic_id: CLINIC, patient_id: 'p-1' }] } : { data: [] }))
    const res = await call('?format=csv')
    expect(res.headers.get('x-truncated')).toBe('true')
    const lines = (await res.text()).trimEnd().split('\n')
    expect(lines).toHaveLength(1 + 5000 + 1)
    expect(lines[lines.length - 1]).toMatch(/^# TRUNCATED/)
  })

  it('a complete CSV has no marker', async () => {
    const res = await call('?format=csv')
    expect(res.headers.get('x-truncated')).toBeNull()
    expect(await res.text()).not.toContain('TRUNCATED')
  })
})

describe('D4: the export fails closed when its log row is not written', () => {
  it('503 and no file', async () => {
    phiLog.mockResolvedValueOnce(false)
    const res = await call('?format=csv')
    expect(res.status).toBe(503)
    expect(res.headers.get('content-type')).toMatch(/json/)
    expect(await res.text()).not.toContain('occurred_at')
  })

  it('a view whose log row fails is still shown (the write failure is alerted)', async () => {
    phiLog.mockResolvedValueOnce(false)
    expect((await call()).status).toBe(200)
  })
})
