/**
 * @jest-environment node
 *
 * POST /api/integrations/keragon/patients: server to server, no session.
 *
 *   - 401: unknown or disconnected connection, missing, bad or stale
 *     signature (bad signatures are noted on the connection, never logged
 *     as events)
 *   - 409: a replayed event id
 *   - 422: an invalid payload (logged as an error, with field names only)
 *   - 200: applied / skipped / flagged, recorded in the sync log, and the
 *     connection's last sync updated
 *
 * Plus the clinic admin routes (connection status, generate or rotate the
 * secret, disconnect) and their role checks.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { onboardingFake } from '@/__tests__/helpers/onboarding-fake'
import { signRequest } from '@/lib/integrations/keragon/signature'

let db = onboardingFake()
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
const getUserMock = jest.fn()
jest.mock('@/lib/supabase/server', () => ({ createServerClient: async () => ({ auth: { getUser: () => getUserMock() } }) }))

import { POST } from '../patients/route'
import * as connection from '../connection/route'
import * as secret from '../connection/secret/route'

const CLINIC = 'c1000000-0000-4000-8000-000000000001'
const CONN = 'c0000000-0000-4000-8000-0000000000c1'
const SECRET = 'kgn_whsec_route_test_secret_0123456789abcdef'
const fixture = (name: string) => readFileSync(join(process.cwd(), 'src/lib/integrations/keragon/__fixtures__', name), 'utf8')

const asUser = (role: string, clinicId: string | null = CLINIC) =>
  getUserMock.mockResolvedValue({ data: { user: { id: `u-${role}`, app_metadata: { app_role: role, clinic_id: clinicId }, user_metadata: { app_role: 'clinic_admin', clinic_id: CLINIC } } }, error: null })

function world(opts: { connected?: boolean; patients?: Record<string, unknown>[] } = {}) {
  db = onboardingFake({
    clinics: [{ clinic_id: CLINIC, name: 'Demo Clinic' }],
    ehr_connections: [],
    ehr_sync_events: [],
    patients: opts.patients ?? [],
    patient_external_ids: [],
    patient_field_changes: [],
  }, { unique: { ehr_sync_events: ['connection_id+event_id'], patient_external_ids: ['clinic_id+system+external_patient_id', 'patient_id+system'] } })
  if (opts.connected !== false) {
    db.vault.set('vault-1', { name: `ehr_keragon_${CLINIC}`, secret: SECRET })
    db.rows('ehr_connections').push({ connection_id: CONN, clinic_id: CLINIC, provider: 'keragon', secret_vault_id: 'vault-1', connected_at: '2026-10-12T00:00:00Z', disconnected_at: null })
  }
  return db
}

function signed(body: string, over: { secret?: string; ts?: number; connection?: string | null; signature?: string } = {}) {
  const ts = String(over.ts ?? Math.floor(Date.now() / 1000))
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-compoundiq-timestamp': ts,
    'x-compoundiq-signature': over.signature ?? signRequest(over.secret ?? SECRET, ts, body),
  }
  if (over.connection !== null) headers['x-compoundiq-connection'] = over.connection ?? CONN
  return POST(new NextRequest(new URL('https://app.example/api/integrations/keragon/patients'), { method: 'POST', headers, body }))
}

beforeEach(() => {
  getUserMock.mockReset()
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'info').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe('authentication (no session involved)', () => {
  it('a correctly signed sample: 200, the patient created, the event logged as applied, the connection updated', async () => {
    world()
    const res = await signed(fixture('patient-upsert-full.json'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(expect.objectContaining({ status: 'applied', event_id: 'evt_demo_0001', patient_id: expect.any(String) }))
    expect(getUserMock).not.toHaveBeenCalled()
    expect(db.rows('patients')).toHaveLength(1)
    expect(db.rows('ehr_sync_events')).toEqual([expect.objectContaining({ connection_id: CONN, clinic_id: CLINIC, event_id: 'evt_demo_0001', event_type: 'patient.upsert', status: 'applied', processed_at: expect.any(String) })])
    expect(db.rows('ehr_connections')[0]).toEqual(expect.objectContaining({ last_event_at: expect.any(String), last_success_at: expect.any(String) }))
  })

  it('a bad signature: 401, nothing processed, the connection notes bad_signature, no event row', async () => {
    world()
    const res = await signed(fixture('patient-upsert-full.json'), { secret: 'not-the-secret' })
    expect(res.status).toBe(401)
    expect(db.rows('patients')).toEqual([])
    expect(db.rows('ehr_sync_events')).toEqual([])
    expect(db.rows('ehr_connections')[0]).toEqual(expect.objectContaining({ last_error_code: 'bad_signature', last_error_at: expect.any(String) }))
  })

  it('stale (signed 6 minutes ago): 401', async () => {
    world()
    const res = await signed(fixture('patient-upsert-full.json'), { ts: Math.floor(Date.now() / 1000) - 6 * 60 })
    expect(res.status).toBe(401)
    expect(db.rows('ehr_connections')[0]!['last_error_code']).toBe('stale_signature')
  })

  it('no connection header, an unknown or disconnected connection: 401', async () => {
    world()
    expect((await signed(fixture('patient-upsert-full.json'), { connection: null })).status).toBe(401)
    expect((await signed(fixture('patient-upsert-full.json'), { connection: 'c0000000-0000-4000-8000-00000000dead' })).status).toBe(401)
    expect((await signed(fixture('patient-upsert-full.json'), { connection: 'not-a-uuid' })).status).toBe(401)
    world({ connected: false })
    db.rows('ehr_connections').push({ connection_id: CONN, clinic_id: CLINIC, provider: 'keragon', secret_vault_id: null, disconnected_at: '2026-10-12T00:00:00Z' })
    expect((await signed(fixture('patient-upsert-full.json'))).status).toBe(401)
    expect(db.rows('patients')).toEqual([])
  })

  it('the secret cannot be read (Vault down): 503 so Keragon retries', async () => {
    world()
    db.failOn('decrypted_secrets:select')
    expect((await signed(fixture('patient-upsert-full.json'))).status).toBe(503)
  })
})

describe('replay and payload', () => {
  it('the same event id again: 409, applied once', async () => {
    world()
    const body = fixture('patient-upsert-full.json')
    expect((await signed(body)).status).toBe(200)
    const again = await signed(body)
    expect(again.status).toBe(409)
    expect(db.rows('patients')).toHaveLength(1)
    expect(db.rows('ehr_sync_events')).toHaveLength(1)
  })

  it('a delivery that failed for a temporary reason (503) is processed when Keragon retries the same event id', async () => {
    world()
    const body = fixture('patient-upsert-full.json')
    db.failOn('patients:insert')
    const first = await signed(body)
    expect(first.status).toBe(503)
    expect(db.rows('ehr_sync_events')).toEqual([expect.objectContaining({ status: 'error', error_code: 'write_failed' })])
    db.clearFailures()
    const retry = await signed(body)
    expect(retry.status).toBe(200)
    expect(db.rows('ehr_sync_events')).toEqual([expect.objectContaining({ status: 'applied', error_code: null })])
    expect(db.rows('patients')).toHaveLength(1)
  })

  it('an invalid payload: 422 with the fields named, logged as an error with no PHI', async () => {
    world()
    const res = await signed(fixture('patient-upsert-invalid.json'))
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual(expect.objectContaining({ errors: expect.objectContaining({ 'patient.date_of_birth': expect.any(String) }) }))
    const [row] = db.rows('ehr_sync_events')
    expect(row).toEqual(expect.objectContaining({ event_id: 'evt_demo_0003', status: 'error', error_code: 'invalid_payload', detail: expect.objectContaining({ fields: expect.arrayContaining(['patient.date_of_birth']) }) }))
    expect(JSON.stringify(row)).not.toMatch(/Casey|Invalid|1990-02-30/)
  })

  it('not JSON: 422', async () => {
    world()
    expect((await signed('{not json')).status).toBe(422)
  })

  it('the log for every outcome has no PHI', async () => {
    world({ patients: [{ patient_id: 'p-twin', clinic_id: CLINIC, is_active: true, deleted_at: null, first_name: 'Morgan', last_name: 'Sample', date_of_birth: '1985-04-12', phone: '+15125550147', phone_e164: '+15125550147', intake_completed_at: null }] })
    const res = await signed(fixture('patient-upsert-full.json'))
    expect(await res.json()).toEqual(expect.objectContaining({ status: 'flagged' }))
    expect(JSON.stringify(db.rows('ehr_sync_events'))).not.toMatch(/Jordan|Sample|Morgan|1985-04-12|5125550147|example\.com|Penicillin|Austin/)
  })
})

describe('the clinic admin routes', () => {
  const req = (method: string, headers: Record<string, string> = {}) =>
    new NextRequest(new URL('https://app.example/api/integrations/keragon/connection'), { method, headers })

  it('generate: the secret is returned once, stored only in Vault; status connected', async () => {
    world({ connected: false })
    asUser('clinic_admin')
    const res = await secret.POST(req('POST'))
    expect(res.status).toBe(200)
    const body = await res.json() as { secret: string; connection: { connectionId: string; status: string } }
    expect(body.secret).toMatch(/^kgn_whsec_/)
    expect(body.connection).toEqual(expect.objectContaining({ status: 'connected', webhookPath: '/api/integrations/keragon/patients' }))
    expect([...db.vault.values()].map(v => v.secret)).toEqual([body.secret])
    expect(JSON.stringify(db.rows('ehr_connections'))).not.toContain(body.secret)

    const view = await (await connection.GET()).json() as Record<string, unknown>
    expect(JSON.stringify(view)).not.toContain(body.secret)
    expect(JSON.stringify(view)).not.toContain('secret_vault_id')
  })

  it('rotate: the same Vault entry gets a new secret; the old one stops working', async () => {
    world()
    asUser('clinic_admin')
    const res = await secret.POST(req('POST'))
    const { secret: fresh } = await res.json() as { secret: string }
    expect(fresh).not.toBe(SECRET)
    expect(db.vault.get('vault-1')!.secret).toBe(fresh)
    expect(db.rows('ehr_connections')[0]).toEqual(expect.objectContaining({ secret_rotated_at: expect.any(String), secret_rotated_by: 'u-clinic_admin' }))
    expect((await signed(fixture('patient-upsert-full.json'))).status).toBe(401)
    expect((await signed(fixture('patient-upsert-full.json'), { secret: fresh })).status).toBe(200)
  })

  it('disconnect: the Vault secret is deleted; requests are refused', async () => {
    world()
    asUser('clinic_admin')
    const res = await connection.DELETE(req('DELETE'))
    expect(res.status).toBe(200)
    expect(db.vault.size).toBe(0)
    expect(db.rows('ehr_connections')[0]).toEqual(expect.objectContaining({ secret_vault_id: null, disconnected_at: expect.any(String), disconnected_by: 'u-clinic_admin' }))
    expect((await signed(fixture('patient-upsert-full.json'))).status).toBe(401)
  })

  it('status and recent events for the admin\'s own clinic', async () => {
    world()
    await signed(fixture('patient-upsert-full.json'))
    asUser('clinic_admin')
    const view = await (await connection.GET()).json() as { connection: { status: string; lastSuccessAt: string | null }; events: Array<Record<string, unknown>> }
    expect(view.connection).toEqual(expect.objectContaining({ connectionId: CONN, status: 'connected', lastSuccessAt: expect.any(String) }))
    expect(view.events).toEqual([expect.objectContaining({ eventId: 'evt_demo_0001', status: 'applied' })])
  })

  it('only a clinic admin (from app_metadata): providers and MAs 403, signed out 401, cross-site 403', async () => {
    world()
    for (const role of ['provider', 'medical_assistant', 'ops_admin', 'pharmacy_admin']) {
      asUser(role)
      expect((await secret.POST(req('POST'))).status).toBe(403)
      expect((await connection.DELETE(req('DELETE'))).status).toBe(403)
      expect((await connection.GET()).status).toBe(403)
    }
    getUserMock.mockResolvedValue({ data: { user: null }, error: { message: 'no session' } })
    expect((await connection.GET()).status).toBe(401)
    asUser('clinic_admin')
    expect((await secret.POST(req('POST', { 'sec-fetch-site': 'cross-site' }))).status).toBe(403)
    expect(db.vault.get('vault-1')!.secret).toBe(SECRET)
  })
})
