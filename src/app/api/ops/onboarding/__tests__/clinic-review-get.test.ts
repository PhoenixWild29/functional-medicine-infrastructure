/**
 * @jest-environment node
 *
 * GET /api/ops/onboarding/clinics/[clinicId]: one clinic's review details
 * for ops (ops_admin only, getUser() and app_metadata via claims.ts).
 * Read-only: nothing is written.
 */

import { NextRequest } from 'next/server'

const CLINIC = '11111111-1111-4111-8111-111111111111'
const OPS_USER = { id: 'ops-1', email: 'ops@compoundiq.test', app_metadata: { app_role: 'ops_admin' } }

let user: unknown = OPS_USER
const fromMock = jest.fn()
const loadMock = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser: async () => ({ data: { user }, error: user ? null : { message: 'no' } }) } }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ from: fromMock }) }))
jest.mock('@/lib/onboarding/review', () => ({ loadClinicReview: (...a: unknown[]) => loadMock(...a) }))
jest.spyOn(console, 'error').mockImplementation(() => {})

import { GET } from '../clinics/[clinicId]/route'

const get = (id: string) => GET(new NextRequest(`http://localhost/api/ops/onboarding/clinics/${id}`), { params: Promise.resolve({ clinicId: id }) })

beforeEach(() => {
  user = OPS_USER
  fromMock.mockReset()
  loadMock.mockReset().mockResolvedValue({ clinic: { clinicId: CLINIC, name: 'Blue Cedar' }, providers: [], staff: [], agreements: [], history: [] })
})

it('an unverified caller is 401', async () => {
  user = null
  expect((await get(CLINIC)).status).toBe(401)
  expect(loadMock).not.toHaveBeenCalled()
})

it.each(['clinic_admin', 'provider', 'medical_assistant', 'pharmacy_admin'])('%s is 403', async role => {
  user = { id: 'u', app_metadata: { app_role: role, clinic_id: CLINIC } }
  expect((await get(CLINIC)).status).toBe(403)
  expect(loadMock).not.toHaveBeenCalled()
})

it('a role only in user_metadata is not trusted', async () => {
  user = { id: 'u', user_metadata: { app_role: 'ops_admin' }, app_metadata: {} }
  expect((await get(CLINIC)).status).toBe(403)
})

it('ops: 200 with the review, read for that clinic', async () => {
  const res = await get(CLINIC)
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual(expect.objectContaining({ clinic: expect.objectContaining({ name: 'Blue Cedar' }) }))
  expect(loadMock).toHaveBeenCalledWith(expect.anything(), CLINIC)
  expect(fromMock).not.toHaveBeenCalled()
})

it('an invalid id is 400; an unknown clinic is 404; a failed read is 503', async () => {
  expect((await get('nope')).status).toBe(400)
  loadMock.mockResolvedValue(null)
  expect((await get(CLINIC)).status).toBe(404)
  loadMock.mockRejectedValue(new Error('down'))
  expect((await get(CLINIC)).status).toBe(503)
})
