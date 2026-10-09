/**
 * @jest-environment node
 *
 * Compliance C2: logPhiAccess writes one phi_access_log row and never
 * throws into the request.
 *
 * The row says who (user id, role, a keyed hash of the email), which
 * clinic, which patient / order, what (action + resource), on which route
 * pattern, from where (keyed hashes of the IP and user agent), and when.
 * It carries no PHI: no names, DOB, phone, drug or free text, and no raw
 * email, IP or user agent. A failed insert, or a client that cannot even
 * be created, is logged without any row value and the request carries on.
 */

import { scriptedDb, DB_DOWN } from '@/__tests__/helpers/scripted-db'

let db = scriptedDb(() => undefined)
let clientThrows = false
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
    if (clientThrows) throw new Error('Missing required environment variable: SUPABASE_URL')
    return db.client
  },
}))

// jest.setup.ts mocks logPhiAccess for every other test file; this one tests it.
jest.unmock('@/lib/audit/phi-access')
import { logPhiAccess, PHI_ACCESS_HASH_ENV } from '../phi-access'

const USER = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'dr.chen@sunrise.example',
  app_metadata: { app_role: 'provider', clinic_id: '22222222-2222-4222-8222-222222222222' },
}
const PATIENT = '33333333-3333-4333-8333-333333333333'
const ORDER = '44444444-4444-4444-8444-444444444444'

function headers(over: Record<string, string> = {}) {
  return new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1', 'user-agent': 'Mozilla/5.0 (Test)', ...over })
}

const logs: string[] = []
beforeEach(() => {
  logs.length = 0
  clientThrows = false
  process.env[PHI_ACCESS_HASH_ENV] = 'test-audit-secret'
  db = scriptedDb(() => undefined)
  for (const level of ['info', 'warn', 'error'] as const) {
    jest.spyOn(console, level).mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(' ')) })
  }
})
afterEach(() => {
  jest.restoreAllMocks()
  delete process.env[PHI_ACCESS_HASH_ENV]
})

const inserted = () => db.to('phi_access_log', 'insert').map(c => c.payload as Record<string, unknown>)

describe('the row', () => {
  it('who, which clinic, which patient and order, what, where and when', async () => {
    await logPhiAccess({
      user: USER, patientId: PATIENT, orderId: ORDER,
      action: 'view', resource: 'order', route: '/api/orders/[orderId]/record', headers: headers(),
    })
    const rows = inserted()
    expect(rows).toHaveLength(1)
    const row = rows[0]!
    expect(row).toEqual(expect.objectContaining({
      actor_user_id: USER.id, actor_role: 'provider', clinic_id: USER.app_metadata.clinic_id,
      patient_id: PATIENT, order_id: ORDER, action: 'view', resource: 'order', route: '/api/orders/[orderId]/record',
    }))
    expect(Date.parse(String(row['occurred_at']))).not.toBeNaN()
    for (const k of ['actor_email_hash', 'ip_hash', 'user_agent_hash']) expect(row[k]).toMatch(/^[0-9a-f]{64}$/)
  })

  it('no email, IP or user agent in clear, and no other columns', async () => {
    await logPhiAccess({ user: USER, patientId: PATIENT, action: 'view', resource: 'patient', route: '/new-prescription', headers: headers() })
    const row = inserted()[0]!
    const text = JSON.stringify(row)
    expect(text).not.toContain('dr.chen')
    expect(text).not.toContain('203.0.113.7')
    expect(text).not.toContain('Mozilla')
    expect(Object.keys(row).sort()).toEqual([
      'action', 'actor_email_hash', 'actor_role', 'actor_user_id', 'clinic_id', 'ip_hash', 'occurred_at',
      'order_id', 'patient_id', 'resource', 'route', 'user_agent_hash',
    ])
  })

  it('the hashes are keyed: the same input hashes the same; another key hashes differently', async () => {
    await logPhiAccess({ user: USER, action: 'view', resource: 'order_list', route: '/dashboard', headers: headers() })
    await logPhiAccess({ user: USER, action: 'view', resource: 'order_list', route: '/dashboard', headers: headers() })
    process.env[PHI_ACCESS_HASH_ENV] = 'another-secret'
    await logPhiAccess({ user: USER, action: 'view', resource: 'order_list', route: '/dashboard', headers: headers() })
    const [a, b, c] = inserted()
    expect(a!['ip_hash']).toBe(b!['ip_hash'])
    expect(a!['actor_email_hash']).toBe(b!['actor_email_hash'])
    expect(c!['ip_hash']).not.toBe(a!['ip_hash'])
    // The first address in x-forwarded-for is the client's.
    await logPhiAccess({ user: USER, action: 'view', resource: 'order_list', route: '/dashboard', headers: headers({ 'x-forwarded-for': '203.0.113.7' }) })
    expect(inserted()[3]!['ip_hash']).toBe(c!['ip_hash'])
  })

  it('without the hash secret: the hashes are left empty (never an unkeyed hash), and it says so', async () => {
    delete process.env[PHI_ACCESS_HASH_ENV]
    await logPhiAccess({ user: USER, action: 'view', resource: 'order_list', route: '/dashboard', headers: headers() })
    const row = inserted()[0]!
    expect(row['ip_hash']).toBeNull()
    expect(row['actor_email_hash']).toBeNull()
    expect(row['user_agent_hash']).toBeNull()
    expect(logs.join('\n')).toContain(PHI_ACCESS_HASH_ENV)
  })

  it('a clinic given for the row (ops viewing a clinic\'s order) wins over the actor\'s', async () => {
    await logPhiAccess({ user: { id: USER.id, email: 'ops@compoundiq.example', app_metadata: { app_role: 'ops_admin' } }, clinicId: '55555555-5555-4555-8555-555555555555', orderId: ORDER, action: 'view', resource: 'order', route: '/api/ops/orders/[orderId]/detail', headers: null })
    expect(inserted()[0]).toEqual(expect.objectContaining({ actor_role: 'ops_admin', clinic_id: '55555555-5555-4555-8555-555555555555', ip_hash: null, user_agent_hash: null }))
  })

  it('an id in the route is never stored: the route is the pattern', async () => {
    await logPhiAccess({ user: USER, action: 'view', resource: 'order', route: `/api/orders/${ORDER}/record`, headers: null })
    expect(inserted()[0]!['route']).toBe('/api/orders/[id]/record')
  })

  it('no actor (not signed in): nothing is written', async () => {
    await logPhiAccess({ user: null, action: 'view', resource: 'order', route: '/dashboard', headers: null })
    expect(inserted()).toHaveLength(0)
  })
})

describe('never throws into the request', () => {
  it('a failed insert resolves, and the error logged carries no row value', async () => {
    db = scriptedDb(c => (c.table === 'phi_access_log' ? { data: null, error: { message: 'new row violates check constraint "x" Failing row contains (dr.chen@sunrise.example, 203.0.113.7)', code: '23514' } } : undefined))
    await expect(logPhiAccess({ user: USER, patientId: PATIENT, action: 'view', resource: 'patient', route: '/refill', headers: headers() })).resolves.toBeUndefined()
    const all = logs.join('\n')
    expect(all).toMatch(/phi_access_log insert failed.*23514/)
    expect(all).not.toContain('dr.chen')
    expect(all).not.toContain('203.0.113.7')
    expect(all).not.toContain(PATIENT)
  })

  it('a database that is down resolves', async () => {
    db = scriptedDb(() => DB_DOWN)
    await expect(logPhiAccess({ user: USER, action: 'view', resource: 'order_list', route: '/dashboard', headers: headers() })).resolves.toBeUndefined()
  })

  it('a client that cannot be created resolves', async () => {
    clientThrows = true
    await expect(logPhiAccess({ user: USER, action: 'view', resource: 'order_list', route: '/dashboard', headers: headers() })).resolves.toBeUndefined()
    expect(logs.join('\n')).toMatch(/phi_access_log/)
  })

  it('a bad action or resource is refused here, not sent to the database', async () => {
    await expect(logPhiAccess({ user: USER, action: 'delete' as never, resource: 'order', route: '/x', headers: null })).resolves.toBeUndefined()
    await expect(logPhiAccess({ user: USER, action: 'view', resource: 'Patient Jane Doe' as never, route: '/x', headers: null })).resolves.toBeUndefined()
    expect(inserted()).toHaveLength(0)
  })
})
