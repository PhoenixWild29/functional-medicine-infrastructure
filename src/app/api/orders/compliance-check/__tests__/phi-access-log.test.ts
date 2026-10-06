/**
 * @jest-environment node
 *
 * Compliance C2: GET /api/orders/compliance-check reads the patient's
 * shipping state, so a request that found the patient logs exactly one
 * phi_access_log row (view, patient). One that did not, or was refused,
 * logs nothing.
 */

import { NextRequest } from 'next/server'
import { scriptedDb } from '@/__tests__/helpers/scripted-db'
import { phiLog, phiEntries, expectOnePhiRow } from '@/__tests__/helpers/phi-log'

const PATIENT = 'a3000000-0000-0000-0000-000000000001'
let session: unknown = { user: { id: 'u1', email: 'ma@clinic.example', user_metadata: { app_role: 'medical_assistant', clinic_id: 'c-1' } } }
let db = scriptedDb(() => undefined)

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getSession: async () => ({ data: { session } }) } }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))

import { GET } from '../route'

const url = `https://app.test/api/orders/compliance-check?patientId=${PATIENT}&providerId=pr-1&pharmacyId=ph-1&itemId=it-1&retailCents=10000`

beforeEach(() => {
  phiLog.mockClear()
  session = { user: { id: 'u1', email: 'ma@clinic.example', user_metadata: { app_role: 'medical_assistant', clinic_id: 'c-1' } } }
  db = scriptedDb(c => (c.table === 'patients' ? { data: { patient_id: PATIENT, state: 'TX', clinic_id: 'c-1' } } : undefined))
})

it('a check that read the patient logs exactly one row: view, patient', async () => {
  expect((await GET(new NextRequest(url))).status).toBe(200)
  expectOnePhiRow({ action: 'view', resource: 'patient', route: '/api/orders/compliance-check', patientId: PATIENT })
})

it('a patient not found, or no session, logs nothing', async () => {
  db = scriptedDb(() => undefined)
  await GET(new NextRequest(url))
  session = null
  expect((await GET(new NextRequest(url))).status).toBe(401)
  expect(phiEntries()).toHaveLength(0)
})
