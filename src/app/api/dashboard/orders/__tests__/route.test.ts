/**
 * @jest-environment node
 *
 * GET /api/dashboard/orders: the dashboard's 30-second poll, moved off the
 * browser client so the read is logged (Compliance C2, B14).
 *
 *   - the SESSION client (RLS), never the service role (F-3)
 *   - a provider's ?view=clinic forwards x-provider-view-mode: clinic, as
 *     the dashboard page does; nobody else's does
 *   - the same columns and filters as the page
 *   - one phi_access_log row per distinct patient returned (view, order_list)
 *   - rows come back as the component's buildDashboardOrder input
 */

import { GET } from '../route'
import { logPhiAccess, logPhiAccessMany } from '@/lib/audit/phi-access'
import { scriptedDb, DB_DOWN, type Script } from '@/__tests__/helpers/scripted-db'

const CLINIC = 'a1000000-0000-0000-0000-000000000001'
const P1 = 'a3000000-0000-0000-0000-000000000001'
const P2 = 'a3000000-0000-0000-0000-000000000002'
const DUP = 'a3000000-0000-0000-0000-000000000009'

let user: unknown = null
let script: Script = () => undefined
let db = scriptedDb(c => script(c))
const createServerClientMock = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: (...args: unknown[]) => createServerClientMock(...args),
}))
const serviceClientShouldNeverBeCalled = jest.fn(() => {
  throw new Error('createServiceClient() must not be called from the dashboard poll (F-3).')
})
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: serviceClientShouldNeverBeCalled }))

const ORDER_ROWS = [
  { order_id: 'o1', status: 'DRAFT', created_at: 't', updated_at: 't', patients: { patient_id: P1, first_name: 'Alex', last_name: 'Demo', phone: null, intake_status: null, possible_duplicate_of: DUP, possible_duplicate_dismissed_at: null } },
  { order_id: 'o2', status: 'DRAFT', created_at: 't', updated_at: 't', patients: { patient_id: P1, first_name: 'Alex', last_name: 'Demo', phone: null, intake_status: null, possible_duplicate_of: null, possible_duplicate_dismissed_at: null } },
  { order_id: 'o3', status: 'DRAFT', created_at: 't', updated_at: 't', patients: { patient_id: P2, first_name: 'Sam', last_name: 'Lee', phone: null, intake_status: null, possible_duplicate_of: null, possible_duplicate_dismissed_at: null } },
]

const rows: Script = c => {
  if (c.table === 'orders') return { data: ORDER_ROWS }
  if (c.table === 'patients') return { data: [{ patient_id: DUP, first_name: 'Alexa', last_name: 'Demo', phone: null }] }
  return undefined
}

function req(qs = '') {
  return new Request(`https://app.test/api/dashboard/orders${qs}`, { headers: { 'user-agent': 'jest' } }) as never
}

const PROVIDER = { id: 'u-chen', app_metadata: { clinic_id: CLINIC, app_role: 'provider' } }
const ADMIN = { id: 'u-admin', app_metadata: { clinic_id: CLINIC, app_role: 'clinic_admin' } }

beforeEach(() => {
  script = rows
  db = scriptedDb(c => script(c))
  createServerClientMock.mockReset().mockImplementation(async () => ({
    auth: { getUser: async () => ({ data: { user } }) },
    ...(db.client as object),
  }))
  serviceClientShouldNeverBeCalled.mockClear()
  jest.mocked(logPhiAccess).mockClear()
  jest.mocked(logPhiAccessMany).mockClear()
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe('GET /api/dashboard/orders', () => {
  it('401 without a user, and nothing is read or logged', async () => {
    user = null
    const res = await GET(req())
    expect(res.status).toBe(401)
    expect(db.calls).toHaveLength(0)
    expect(logPhiAccessMany).not.toHaveBeenCalled()
  })

  it('reads with the session client, the same filters and columns, and returns the raw rows', async () => {
    user = ADMIN
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(serviceClientShouldNeverBeCalled).not.toHaveBeenCalled()
    const [orders] = db.to('orders')
    expect(orders!.filters).toEqual(expect.objectContaining({ clinic_id: CLINIC, 'deleted_at:is': null }))
    expect(orders!.columns).toMatch(/patients!inner\(patient_id, first_name, last_name, phone, intake_status, possible_duplicate_of/)
    expect(orders!.columns).toMatch(/proposal_required/)
    const body = await res.json() as { rows: unknown[]; duplicateNames: Record<string, unknown> }
    expect(body.rows).toEqual(ORDER_ROWS)
    expect(body.duplicateNames).toEqual({ [DUP]: { first_name: 'Alexa', last_name: 'Demo', phone: null } })
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('logs view / order_list once per distinct patient shown (the duplicate-flag name included)', async () => {
    user = ADMIN
    await GET(req())
    expect(logPhiAccessMany).toHaveBeenCalledTimes(1)
    const [entry, ids] = jest.mocked(logPhiAccessMany).mock.calls[0]!
    expect(entry).toEqual(expect.objectContaining({ user: ADMIN, action: 'view', resource: 'order_list', route: '/api/dashboard/orders' }))
    expect(entry.headers).toBeTruthy()
    expect([...ids].sort()).toEqual([P1, P2, DUP].sort())
    expect(logPhiAccess).not.toHaveBeenCalled()
  })

  it('a log that fails still serves the read (alerting is the helper\'s)', async () => {
    user = ADMIN
    jest.mocked(logPhiAccessMany).mockResolvedValueOnce(false)
    expect((await GET(req())).status).toBe(200)
  })

  it("a provider's clinic view forwards x-provider-view-mode: clinic", async () => {
    user = PROVIDER
    await GET(req('?view=clinic'))
    expect(createServerClientMock).toHaveBeenCalledWith({ extraHeaders: { 'x-provider-view-mode': 'clinic' } })
  })

  it("a provider's own view, and anyone else's ?view=clinic, do not", async () => {
    user = PROVIDER
    await GET(req())
    user = ADMIN
    await GET(req('?view=clinic'))
    const optIn = createServerClientMock.mock.calls.filter(c => (c[0] as { extraHeaders?: Record<string, string> } | undefined)?.extraHeaders)
    expect(optIn).toHaveLength(0)
  })

  it('a failed read is a 500 and nothing is logged', async () => {
    user = ADMIN
    script = c => (c.table === 'orders' ? DB_DOWN : undefined)
    const res = await GET(req())
    expect(res.status).toBe(500)
    expect(logPhiAccessMany).not.toHaveBeenCalled()
  })
})

// C-2026-10-26-04 (review L5): the 30-second poll is bounded and its log
// rows are deduplicated per actor and patient over 15 minutes.
describe('review L5: bounded poll, deduplicated log', () => {
  it('reads one past the 1000-order bound, to know whether the list was cut', async () => {
    user = ADMIN
    await GET(req())
    expect(db.to('orders', 'select')[0]?.limit).toBe(1001)
  })

  it('logs the patients with a 15-minute dedupe', async () => {
    user = ADMIN
    jest.mocked(logPhiAccessMany).mockClear()
    await GET(req())
    expect(jest.mocked(logPhiAccessMany).mock.calls[0]?.[2]).toEqual({ dedupeMinutes: 15 })
  })
})

// B-2026-10-26-08: the poll and the first render show the same window (the
// newest 1000 by last update, or those before ?before=), and the poll says
// whether it was cut.
describe('the order window', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => ({
    ...ORDER_ROWS[2]!, order_id: `o${i}`, updated_at: `2026-10-20T08:00:00.${String(999999 - i).padStart(6, '0')}+00:00`,
    patients: { ...ORDER_ROWS[2]!.patients, patient_id: `a3000000-0000-0000-0000-${String(i).padStart(12, '0')}` },
  }))

  it('not cut: every row, window.truncated false, no cursor', async () => {
    user = ADMIN
    const body = await (await GET(req())).json() as { rows: unknown[]; window: Record<string, unknown> }
    expect(body.rows).toHaveLength(3)
    expect(body.window).toEqual({ limit: 1000, truncated: false, before: null, olderBefore: null })
  })

  it('cut: 1000 rows, truncated, the oldest shown as the next cursor; only the shown patients are logged', async () => {
    user = ADMIN
    const all = many(1001)
    script = c => (c.table === 'orders' ? { data: all } : c.table === 'patients' ? { data: [] } : undefined)
    const body = await (await GET(req())).json() as { rows: Array<{ order_id: string }>; window: Record<string, unknown> }
    expect(body.rows).toHaveLength(1000)
    expect(body.rows.at(-1)!.order_id).toBe('o999')
    expect(body.window).toEqual({ limit: 1000, truncated: true, before: null, olderBefore: all[999]!.updated_at })
    const ids = jest.mocked(logPhiAccessMany).mock.calls[0]![1] as string[]
    expect(ids).toHaveLength(1000)
    expect(ids).not.toContain(all[1000]!.patients.patient_id)
  })

  it('?before= reads only orders last updated before it, and echoes it', async () => {
    user = ADMIN
    const before = '2026-10-20T08:00:00.123456+00:00'
    const body = await (await GET(req(`?before=${encodeURIComponent(before)}`))).json() as { window: Record<string, unknown> }
    expect(db.to('orders', 'select')[0]!.filters).toEqual(expect.objectContaining({ 'updated_at:lt': before }))
    expect(body.window).toEqual(expect.objectContaining({ before }))
  })

  it('a malformed ?before= is ignored (no filter)', async () => {
    user = ADMIN
    await GET(req('?before=yesterday'))
    expect(db.to('orders', 'select')[0]!.filters).not.toHaveProperty('updated_at:lt')
  })
})
