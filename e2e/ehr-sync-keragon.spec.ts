import { test, expect, type APIRequestContext } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHmac, randomUUID } from 'node:crypto'
import { TEST_IDS } from './fixtures/seed'

// ============================================================
// EHR sync (Keragon): signed sample payloads into the test clinic
// ============================================================
//
// Server to server, so no browser and no sign-in: the spec gives the test
// clinic a connection with a shared secret in Vault (service role, E2E
// project only), posts the sample payloads from
// src/lib/integrations/keragon/__fixtures__ signed with it, and checks the
// patients and the sync log. Each run uses its own event ids, external
// ids, names, dates of birth and mobiles, so it never matches a seeded
// patient. Everything it made is removed afterwards.

const PATH = '/api/integrations/keragon/patients'
const FIXTURES = join(__dirname, '..', 'src', 'lib', 'integrations', 'keragon', '__fixtures__')
const RUN = randomUUID().slice(0, 8)

function e2eService() {
  return createClient(process.env['E2E_SUPABASE_URL']!, process.env['E2E_SUPABASE_SERVICE_ROLE_KEY']!)
}

/** A sample payload made unique to this run. */
function sample(file: string, n: number): Record<string, unknown> {
  const body = JSON.parse(readFileSync(join(FIXTURES, file), 'utf8')) as Record<string, unknown>
  const patient = body['patient'] as Record<string, unknown>
  body['event_id'] = `evt_e2e_${RUN}_${n}`
  if (patient['external_patient_id']) patient['external_patient_id'] = `EHR-E2E-${RUN}-${n}`
  patient['last_name'] = `E2ekeragon${RUN}${n}`
  if (patient['date_of_birth'] && /^\d{4}-\d{2}-\d{2}$/.test(String(patient['date_of_birth']))) patient['date_of_birth'] = `19${50 + n}-0${n}-1${n}`
  if (typeof patient['mobile'] === 'string' && patient['mobile'].length > 5) patient['mobile'] = `+1512555${String(1000 + Math.floor(Math.random() * 8999)).slice(0, 4)}`
  return body
}

test.describe('EHR sync (Keragon): signed payloads into the test clinic', () => {
  const secret = `kgn_whsec_e2e_${randomUUID().replace(/-/g, '')}`
  let connectionId = ''
  let vaultId: string | null = null
  let hadConnection = false

  async function post(request: APIRequestContext, body: string, opts: { secret?: string; ts?: number } = {}) {
    const ts = String(opts.ts ?? Math.floor(Date.now() / 1000))
    const signature = `v1=${createHmac('sha256', opts.secret ?? secret).update(`${ts}.${body}`).digest('hex')}`
    return request.post(PATH, {
      data: body,
      headers: { 'content-type': 'application/json', 'x-compoundiq-connection': connectionId, 'x-compoundiq-timestamp': ts, 'x-compoundiq-signature': signature },
    })
  }

  test.beforeAll(async () => {
    const supabase = e2eService()
    const { data: existing, error: readErr } = await supabase.from('ehr_connections').select('connection_id').eq('clinic_id', TEST_IDS.clinic).eq('provider', 'keragon').maybeSingle()
    if (readErr) throw new Error(`ehr_connections: ${readErr.message}`)
    hadConnection = !!existing
    if (hadConnection) test.skip(true, 'The test clinic already has an EHR connection; not touching it.')
    const { data: id, error: vaultErr } = await supabase.rpc('create_vault_secret', { p_name: `ehr_keragon_e2e_${RUN}`, p_secret: secret })
    if (vaultErr || !id) throw new Error(`vault: ${vaultErr?.message}`)
    vaultId = id as string
    const { data: conn, error: connErr } = await supabase.from('ehr_connections')
      .insert({ clinic_id: TEST_IDS.clinic, provider: 'keragon', secret_vault_id: vaultId, connected_at: new Date().toISOString() })
      .select('connection_id').single()
    if (connErr || !conn) throw new Error(`connection: ${connErr?.message}`)
    connectionId = (conn as { connection_id: string }).connection_id
  })

  test.afterAll(async () => {
    if (hadConnection || !connectionId) return
    const supabase = e2eService()
    const { data: links } = await supabase.from('patient_external_ids').select('patient_id').eq('clinic_id', TEST_IDS.clinic).like('external_patient_id', `EHR-E2E-${RUN}-%`)
    const patientIds = ((links ?? []) as Array<{ patient_id: string }>).map(l => l.patient_id)
    await supabase.from('ehr_sync_events').delete().eq('connection_id', connectionId)
    if (patientIds.length) {
      await supabase.from('patient_field_changes').delete().in('patient_id', patientIds)
      await supabase.from('patient_external_ids').delete().in('patient_id', patientIds)
      await supabase.from('patients').delete().in('patient_id', patientIds)
    }
    await supabase.from('ehr_connections').delete().eq('connection_id', connectionId)
    if (vaultId) await supabase.rpc('delete_vault_secret', { p_secret_id: vaultId })
  })

  test('a signed full sample creates the patient, links it and logs it; a replay is 409', async ({ request }) => {
    const body = JSON.stringify(sample('patient-upsert-full.json', 1))
    const res = await post(request, body)
    expect(res.status()).toBe(200)
    const out = await res.json() as { status: string; patient_id: string }
    expect(out.status).toBe('applied')

    const supabase = e2eService()
    const { data: patient } = await supabase.from('patients').select('clinic_id, source, external_id, sms_opt_in, sms_consent_at, phone_e164').eq('patient_id', out.patient_id).single()
    expect(patient).toEqual(expect.objectContaining({ clinic_id: TEST_IDS.clinic, source: 'ehr', external_id: `EHR-E2E-${RUN}-1`, sms_opt_in: false, sms_consent_at: null }))
    const { data: log } = await supabase.from('ehr_sync_events').select('event_id, status, patient_id, detail').eq('connection_id', connectionId).eq('event_id', `evt_e2e_${RUN}_1`).single()
    expect(log).toEqual(expect.objectContaining({ status: 'applied', patient_id: out.patient_id }))
    expect(JSON.stringify(log)).not.toContain(`E2ekeragon${RUN}1`)

    expect((await post(request, body)).status()).toBe(409)
  })

  test('the same external id again updates the same patient (no duplicate)', async ({ request }) => {
    const first = sample('patient-upsert-minimal.json', 2)
    const r1 = await post(request, JSON.stringify(first))
    expect(r1.status()).toBe(200)
    const { patient_id } = await r1.json() as { patient_id: string }
    const second = { ...first, event_id: `evt_e2e_${RUN}_2b`, patient: { ...(first['patient'] as object), email: `e2e-${RUN}@example.com` } }
    const r2 = await post(request, JSON.stringify(second))
    expect(r2.status()).toBe(200)
    expect(await r2.json()).toEqual(expect.objectContaining({ status: 'applied', patient_id }))
    const { data } = await e2eService().from('patients').select('email').eq('patient_id', patient_id).single()
    expect(data).toEqual({ email: `e2e-${RUN}@example.com` })
  })

  test('an invalid sample is 422 and logged as an error; a bad or stale signature is 401', async ({ request }) => {
    const invalid = JSON.stringify(sample('patient-upsert-invalid.json', 3))
    expect((await post(request, invalid)).status()).toBe(422)
    const { data: log } = await e2eService().from('ehr_sync_events').select('status, error_code').eq('connection_id', connectionId).eq('event_id', `evt_e2e_${RUN}_3`).single()
    expect(log).toEqual({ status: 'error', error_code: 'invalid_payload' })

    const body = JSON.stringify(sample('patient-upsert-full.json', 4))
    expect((await post(request, body, { secret: 'not-the-secret' })).status()).toBe(401)
    expect((await post(request, body, { ts: Math.floor(Date.now() / 1000) - 600 })).status()).toBe(401)
  })
})
