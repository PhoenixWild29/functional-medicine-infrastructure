/**
 * @jest-environment node
 *
 * POST /api/ops/onboarding/clinics/[clinicId] { action: 'delete_signup',
 * confirm: true }: ops deletes an unapproved self sign-up
 * (lib/onboarding/delete-signup). ops_admin only, same-origin only, and
 * only with the explicit confirmation.
 */

import { NextRequest } from 'next/server'

let user: Record<string, unknown> | null = { id: 'ops-1', email: 'ops@compoundiq.test', app_metadata: { app_role: 'ops_admin' } }
jest.mock('@/lib/supabase/server', () => ({ createServerClient: async () => ({ auth: { getUser: async () => ({ data: { user }, error: null }) } }) }))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ service: true }) }))
const deleteMock = jest.fn()
jest.mock('@/lib/onboarding/delete-signup', () => ({ deleteSelfServeSignup: (...a: unknown[]) => deleteMock(...a) }))
jest.spyOn(console, 'info').mockImplementation(() => {})

import { POST } from '../clinics/[clinicId]/route'

const CLINIC = '11111111-1111-4111-8111-111111111111'
const ctx = { params: Promise.resolve({ clinicId: CLINIC }) }
const req = (body: unknown, site?: string) => new NextRequest(`http://localhost/api/ops/onboarding/clinics/${CLINIC}`, {
  method: 'POST', body: JSON.stringify(body), headers: site ? { 'sec-fetch-site': site } : {},
})

beforeEach(() => {
  user = { id: 'ops-1', email: 'ops@compoundiq.test', app_metadata: { app_role: 'ops_admin' } }
  deleteMock.mockReset().mockResolvedValue({ ok: true, removedLogins: 1, removedProviders: 1 })
})

it('confirmed: deleted as the ops user', async () => {
  const res = await POST(req({ action: 'delete_signup', confirm: true }, 'same-origin'), ctx)
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true, removedLogins: 1, removedProviders: 1 })
  expect(deleteMock).toHaveBeenCalledWith({ service: true }, expect.objectContaining({ clinicId: CLINIC, actorUserId: 'ops-1' }))
})

it('without confirm: true, nothing is deleted', async () => {
  for (const confirm of [undefined, false, 'yes']) {
    expect((await POST(req({ action: 'delete_signup', confirm }), ctx)).status).toBe(400)
  }
  expect(deleteMock).not.toHaveBeenCalled()
})

it('cross-site: 403', async () => {
  expect((await POST(req({ action: 'delete_signup', confirm: true }, 'cross-site'), ctx)).status).toBe(403)
  expect(deleteMock).not.toHaveBeenCalled()
})

it('not ops_admin: refused', async () => {
  user = { id: 'u-1', app_metadata: { app_role: 'clinic_admin', clinic_id: CLINIC } }
  expect((await POST(req({ action: 'delete_signup', confirm: true }), ctx)).status).toBe(403)
  expect(deleteMock).not.toHaveBeenCalled()
})

it("the library's refusal comes back as it is", async () => {
  deleteMock.mockResolvedValue({ ok: false, status: 409, error: 'Only a self sign-up that ops has not approved can be deleted.' })
  const res = await POST(req({ action: 'delete_signup', confirm: true }), ctx)
  expect(res.status).toBe(409)
  expect(await res.json()).toEqual({ error: 'Only a self sign-up that ops has not approved can be deleted.' })
})
