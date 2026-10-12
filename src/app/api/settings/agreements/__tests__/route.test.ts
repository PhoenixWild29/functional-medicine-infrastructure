/**
 * @jest-environment node
 *
 * POST /api/settings/agreements: the clinic admin accepts a new version of
 * the BAA or the terms after onboarding. getUser(); role and clinic from
 * app_metadata (claims.ts) only. Recorded exactly as the wizard does
 * (current version, server-computed SHA-256). Other clinic roles are
 * read-only (403). Onboarding steps are not touched.
 */

import { createHash } from 'node:crypto'
import { NextRequest } from 'next/server'
import { scriptedDb } from '@/__tests__/helpers/scripted-db'
import { AGREEMENTS } from '@/lib/onboarding/agreement-texts'

const CLINIC = 'c0000000-0000-4000-8000-000000000001'
const ADMIN = { id: 'u-admin', email: 'owner@clinic.test', app_metadata: { app_role: 'clinic_admin', clinic_id: CLINIC } }

let user: unknown = ADMIN
let db = scriptedDb(() => undefined)
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser: async () => ({ data: { user }, error: null }) } }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.spyOn(console, 'error').mockImplementation(() => {})
jest.spyOn(console, 'info').mockImplementation(() => {})

import { POST } from '../route'

const post = (body: unknown) => POST(new NextRequest('http://localhost/api/settings/agreements', { method: 'POST', body: JSON.stringify(body) }))
const good = { agreement: 'baa', version: AGREEMENTS.baa.version, signerName: 'Jo Park', signerTitle: 'Owner' }
const writes = () => db.calls.filter(c => c.op !== 'select')

beforeEach(() => {
  user = ADMIN
  db = scriptedDb(() => undefined)
})

it('an unverified caller is 401', async () => {
  user = null
  expect((await post(good)).status).toBe(401)
  expect(writes()).toEqual([])
})

it.each(['provider', 'medical_assistant', 'ops_admin', 'pharmacy_admin'])('%s is 403 (read-only)', async role => {
  user = { id: 'u', app_metadata: { app_role: role, clinic_id: CLINIC } }
  expect((await post(good)).status).toBe(403)
  expect(writes()).toEqual([])
})

it('a role or clinic only in user_metadata is not trusted', async () => {
  user = { id: 'u', user_metadata: { app_role: 'clinic_admin', clinic_id: CLINIC }, app_metadata: {} }
  expect((await post(good)).status).toBe(403)
})

it('records the acceptance for the caller’s own clinic, with the server-computed hash; no onboarding step write', async () => {
  const res = await post({ ...good, clinicId: 'f0000000-0000-4000-8000-0000000000ff', textSha256: 'f'.repeat(64) })
  expect(res.status).toBe(201)
  expect(await res.json()).toEqual({ ok: true, version: AGREEMENTS.baa.version })
  const [ins] = db.to('agreement_acceptances', 'insert')
  expect(ins!.payload).toEqual(expect.objectContaining({
    clinic_id: CLINIC, agreement: 'baa', template_version: AGREEMENTS.baa.version,
    text_sha256: createHash('sha256').update(AGREEMENTS.baa.text, 'utf8').digest('hex'), user_id: 'u-admin',
  }))
  expect(db.to('clinic_onboarding_steps')).toEqual([])
})

it('a stale version is 409; bad input is 400', async () => {
  expect((await post({ ...good, version: 'v0.1' })).status).toBe(409)
  expect((await post({ ...good, agreement: 'nda' })).status).toBe(400)
  expect((await post({ ...good, signerName: '' })).status).toBe(400)
  expect(writes()).toEqual([])
})
