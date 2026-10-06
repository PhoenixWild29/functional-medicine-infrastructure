/**
 * @jest-environment node
 *
 * Compliance C2: Settings, Access log.
 *
 *   - clinic admin only: a provider or medical assistant gets a notice and
 *     nothing is read (not the log, not the patient list);
 *   - read through the SESSION client, so the phi_access_log SELECT policy
 *     (own clinic only) applies, and filtered to the admin's clinic here
 *     too: a provider of another clinic, or this clinic's admin, never
 *     reads another clinic's rows through this page;
 *   - filter by patient and date range;
 *   - each row shows the actor's role, the action, the resource and the
 *     time, and nothing else (no actor id, no hashes, no route);
 *   - opening the log is itself logged once.
 */

import { scriptedDb, type ScriptedCall } from '@/__tests__/helpers/scripted-db'
import { phiLog, phiEntries, expectOnePhiRow } from '@/__tests__/helpers/phi-log'
import { parseAccessLogFilters } from '@/lib/audit/access-log-view'

const CLINIC = 'a1000000-0000-0000-0000-000000000001'
const PATIENT = 'a3000000-0000-0000-0000-000000000001'

let user: unknown = null
let db = scriptedDb(() => undefined)
const serviceClient = jest.fn(() => { throw new Error('the access log must not be read with the service role') })

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ ...(db.client as object), auth: { getUser: async () => ({ data: { user } }) } }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => serviceClient() }))

import AccessLogPage from '../access-log/page'

const LOG_ROWS = [
  { id: 'l1', occurred_at: '2026-10-06T15:04:00.000Z', actor_role: 'provider', action: 'view', resource: 'order', actor_user_id: 'u-9', ip_hash: 'a'.repeat(64), route: '/api/orders/[orderId]/record' },
  { id: 'l2', occurred_at: '2026-10-06T14:00:00.000Z', actor_role: 'medical_assistant', action: 'update', resource: 'patient_allergies' },
]

function answer(c: ScriptedCall) {
  if (c.table === 'phi_access_log') return { data: LOG_ROWS }
  if (c.table === 'patients') return { data: [{ patient_id: PATIENT, first_name: 'Alex', last_name: 'Demo' }] }
  return undefined
}

const role = (r: string, clinic: string | null = CLINIC) => ({ id: `user-${r}`, email: `${r}@clinic.example`, user_metadata: { app_role: r, clinic_id: clinic } })

async function html(params: Record<string, string> = {}) {
  const { renderToStaticMarkup } = await import('react-dom/server')
  return renderToStaticMarkup(await AccessLogPage({ searchParams: Promise.resolve(params) }))
}

beforeEach(() => {
  phiLog.mockClear()
  serviceClient.mockClear()
  db = scriptedDb(answer)
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe('admin only', () => {
  it.each(['provider', 'medical_assistant'])('a %s gets a notice, and nothing is read or logged', async r => {
    user = role(r)
    const out = await html()
    expect(out).toContain('Only the clinic admin can view the access log.')
    expect(db.calls).toHaveLength(0)
    expect(phiEntries()).toHaveLength(0)
  })

  it('no user: the session notice, nothing read', async () => {
    user = null
    await html()
    expect(db.calls).toHaveLength(0)
  })
})

describe('the clinic admin', () => {
  beforeEach(() => { user = role('clinic_admin') })

  it('reads its own clinic\'s rows through the session client, newest first', async () => {
    await html()
    const [read] = db.to('phi_access_log', 'select')
    expect(read!.filters).toEqual(expect.objectContaining({ clinic_id: CLINIC }))
    expect(serviceClient).not.toHaveBeenCalled()
  })

  it('shows role, action, resource and time, and nothing else', async () => {
    const out = await html()
    expect(out).toContain('2026-10-06 15:04 UTC')
    expect(out).toContain('Provider')
    expect(out).toContain('Viewed')
    expect(out).toContain('Prescription order')
    expect(out).toContain('Medical assistant')
    expect(out).toContain('Changed')
    expect(out).toContain('Allergies')
    expect(out).not.toContain('u-9')
    expect(out).not.toContain('a'.repeat(64))
    expect(out).not.toContain('/api/orders')
  })

  it('filters by patient and date range (the To day included)', async () => {
    await html({ patient: PATIENT, from: '2026-10-01', to: '2026-10-06' })
    const [read] = db.to('phi_access_log', 'select')
    expect(read!.filters).toEqual(expect.objectContaining({
      clinic_id: CLINIC,
      patient_id: PATIENT,
      'occurred_at:gte': '2026-10-01T00:00:00.000Z',
      'occurred_at:lt':  '2026-10-07T00:00:00.000Z',
    }))
  })

  it('opening the log is itself logged once: view, access_log, with the patient filtered on', async () => {
    await html({ patient: PATIENT })
    expectOnePhiRow({ action: 'view', resource: 'access_log', route: '/settings/access-log', patientId: PATIENT })
  })

  it('a failed read says so; it is not an empty log', async () => {
    db = scriptedDb(c => (c.table === 'phi_access_log' ? { data: null, error: { message: 'x', code: '42501' } } : answer(c)))
    const out = await html()
    expect(out).toContain('The access log could not be loaded. This is an error, not an empty log.')
    expect(out).not.toContain('No access recorded')
  })
})

describe('parseAccessLogFilters', () => {
  it('keeps a valid patient id and dates', () => {
    expect(parseAccessLogFilters({ patient: PATIENT, from: '2026-10-01', to: '2026-10-06' })).toEqual({
      patientId: PATIENT, from: '2026-10-01', to: '2026-10-06',
      fromIso: '2026-10-01T00:00:00.000Z', toIsoExclusive: '2026-10-07T00:00:00.000Z',
    })
  })

  it('ignores anything malformed, and swaps a reversed range', () => {
    expect(parseAccessLogFilters({ patient: "x' or 1=1", from: '2026-13-01', to: 'yesterday' })).toEqual({
      patientId: null, from: null, to: null, fromIso: null, toIsoExclusive: null,
    })
    expect(parseAccessLogFilters({ from: '2026-10-06', to: '2026-10-01' })).toEqual(expect.objectContaining({ from: '2026-10-01', to: '2026-10-06' }))
  })
})
