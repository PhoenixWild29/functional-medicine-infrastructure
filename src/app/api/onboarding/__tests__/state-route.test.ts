/**
 * @jest-environment node
 *
 * GET /api/onboarding/state: the clinic admin's own wizard state, so the
 * wizard can re-read its step list as soon as a step completes. Only the
 * clinic admin (getUser(), role and clinic from app_metadata), only their
 * own clinic. Read-only, so a submitted clinic can still read it.
 */

import { scriptedDb } from '@/__tests__/helpers/scripted-db'
import type { OnboardingState } from '@/lib/onboarding/state'

const CLINIC = '11111111-1111-4111-8111-111111111111'
const ADMIN  = { id: 'admin-1', email: 'lauren@sunrise.test', app_metadata: { app_role: 'clinic_admin', clinic_id: CLINIC } }

let user: unknown = ADMIN
let clinicStatus = 'in_progress'
const db = () => scriptedDb(c => (c.table === 'clinics' && c.op === 'select'
  ? { data: { clinic_id: CLINIC, name: 'Sunrise', onboarding_status: clinicStatus } }
  : undefined))
let current = db()
const loadState = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser: async () => ({ data: { user }, error: null }) } }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => current.client }))
jest.mock('@/lib/onboarding/state', () => ({ loadOnboardingState: (...a: unknown[]) => loadState(...a) }))

import { GET } from '../state/route'

const STATE = { clinic: { clinicId: CLINIC }, steps: { baa: 'complete' } } as unknown as OnboardingState

beforeEach(() => {
  user = ADMIN
  clinicStatus = 'in_progress'
  current = db()
  loadState.mockReset().mockResolvedValue(STATE)
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

it('returns the clinic admin\'s own state, uncached', async () => {
  const res = await GET()
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual(STATE)
  expect(loadState).toHaveBeenCalledWith(current.client, CLINIC)
  expect(res.headers.get('Cache-Control')).toBe('no-store')
})

it('a submitted clinic can still read it', async () => {
  clinicStatus = 'submitted'
  expect((await GET()).status).toBe(200)
})

it('an unverified caller is 401', async () => {
  user = null
  expect((await GET()).status).toBe(401)
  expect(loadState).not.toHaveBeenCalled()
})

it.each(['provider', 'medical_assistant', 'ops_admin'])('%s is 403', async role => {
  user = { id: 'u', app_metadata: { app_role: role, clinic_id: CLINIC } }
  expect((await GET()).status).toBe(403)
  expect(loadState).not.toHaveBeenCalled()
})

it('a role in user_metadata is ignored (403)', async () => {
  user = { id: 'u', app_metadata: {}, user_metadata: { app_role: 'clinic_admin', clinic_id: CLINIC } }
  expect((await GET()).status).toBe(403)
})

it('a state that cannot be loaded is 503', async () => {
  loadState.mockRejectedValue(new Error('db down'))
  expect((await GET()).status).toBe(503)
  loadState.mockResolvedValue(null)
  expect((await GET()).status).toBe(503)
})
