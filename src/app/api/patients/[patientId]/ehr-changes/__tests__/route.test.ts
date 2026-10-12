/**
 * @jest-environment node
 *
 * GET /api/patients/[patientId]/ehr-changes: what EHR sync changed on a
 * patient, or kept because the patient entered it at self-intake.
 *
 *   - clinic users of that patient's clinic (admin, provider, MA), role
 *     and clinic from app_metadata via getUser();
 *   - read with the SESSION client, so the patient_field_changes RLS
 *     (own clinic) applies; filtered by patient and clinic here too; the
 *     service role is never used;
 *   - when there are changes to show, a PHI access row is written
 *     (view, patient_ehr_changes), like other patient views.
 */

import { NextRequest } from 'next/server'
import { onboardingFake } from '@/__tests__/helpers/onboarding-fake'

const CLINIC = 'c1000000-0000-4000-8000-000000000001'
const OTHER = 'c1000000-0000-4000-8000-000000000002'
const PATIENT = 'p1000000-0000-4000-8000-000000000001'

let db = onboardingFake()
const getUserMock = jest.fn()
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser: () => getUserMock() }, from: (t: string) => (db.client as unknown as { from: (t: string) => unknown }).from(t) }),
}))
const serviceMock = jest.fn()
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => serviceMock() }))
const logMock = jest.fn()
jest.mock('@/lib/audit/phi-access', () => ({ logPhiAccess: (...a: unknown[]) => logMock(...a) }))

import { GET } from '../route'

const as = (role: string, clinicId: string | null = CLINIC) =>
  getUserMock.mockResolvedValue({ data: { user: { id: `u-${role}`, app_metadata: { app_role: role, clinic_id: clinicId }, user_metadata: {} } }, error: null })
const call = (patientId = PATIENT) =>
  GET(new NextRequest(new URL(`https://app.example/api/patients/${patientId}/ehr-changes`)), { params: Promise.resolve({ patientId }) })

const change = (over: Record<string, unknown> = {}) => ({
  change_id: `ch-${Math.random().toString(16).slice(2, 8)}`, clinic_id: CLINIC, patient_id: PATIENT, field: 'city',
  old_value: 'Round Rock', new_value: 'Austin', applied: false, source: 'ehr_sync', changed_at: '2026-10-12T15:00:00Z', ...over,
})

beforeEach(() => {
  getUserMock.mockReset(); serviceMock.mockReset(); logMock.mockReset().mockResolvedValue(undefined)
  db = onboardingFake({ patient_field_changes: [
    change(),
    change({ field: 'email', old_value: 'old@example.com', new_value: 'new@example.com', applied: true, changed_at: '2026-10-12T16:00:00Z' }),
    change({ clinic_id: OTHER, field: 'zip' }),
    change({ patient_id: 'p1000000-0000-4000-8000-000000000009', field: 'state' }),
  ] })
})

it.each(['clinic_admin', 'provider', 'medical_assistant'])('%s: this patient\'s changes, newest first, through the session client', async role => {
  as(role)
  const res = await call()
  expect(res.status).toBe(200)
  const body = await res.json() as { changes: Array<Record<string, unknown>> }
  expect(body.changes).toEqual([
    { changeId: expect.any(String), field: 'email', ourValue: 'old@example.com', ehrValue: 'new@example.com', applied: true, changedAt: '2026-10-12T16:00:00Z' },
    { changeId: expect.any(String), field: 'city', ourValue: 'Round Rock', ehrValue: 'Austin', applied: false, changedAt: '2026-10-12T15:00:00Z' },
  ])
  expect(serviceMock).not.toHaveBeenCalled()
  const read = db.calls.find(c => c.name === 'patient_field_changes' && c.op === 'select')!
  expect(read.filters).toEqual(expect.arrayContaining([`patient_id=${PATIENT}`, `clinic_id=${CLINIC}`]))
})

it('writes a PHI access row when changes are shown', async () => {
  as('provider')
  await call()
  expect(logMock).toHaveBeenCalledWith(expect.objectContaining({
    action: 'view', resource: 'patient_ehr_changes', route: '/api/patients/[patientId]/ehr-changes', patientId: PATIENT, clinicId: CLINIC,
  }))
})

it('no changes: an empty list and no PHI access row', async () => {
  as('provider')
  db = onboardingFake({ patient_field_changes: [] })
  expect(await (await call()).json()).toEqual({ changes: [] })
  expect(logMock).not.toHaveBeenCalled()
})

it('refused: signed out 401; ops, pharmacy admin or no clinic 403; a bad id 400', async () => {
  getUserMock.mockResolvedValue({ data: { user: null }, error: { message: 'no session' } })
  expect((await call()).status).toBe(401)
  for (const role of ['ops_admin', 'pharmacy_admin']) { as(role); expect((await call()).status).toBe(403) }
  as('provider', null)
  expect((await call()).status).toBe(403)
  as('provider')
  expect((await call('not-a-uuid')).status).toBe(400)
  expect(logMock).not.toHaveBeenCalled()
})

it('a read failure is a 503, not an empty list', async () => {
  as('provider')
  db.failOn('patient_field_changes:select')
  expect((await call()).status).toBe(503)
})
