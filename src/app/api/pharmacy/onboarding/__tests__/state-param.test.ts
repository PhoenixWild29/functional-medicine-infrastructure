/**
 * @jest-environment node
 *
 * /api/pharmacy/onboarding/licenses/<state> (DELETE) and
 * /api/pharmacy/onboarding/licenses/<state>/document (POST): the signed-in
 * pharmacy admin first (pharmacyAdmin, lib/pharmacy-onboarding/request),
 * then the state, a closed set of US license states, before anything is
 * read, uploaded or deleted.
 */

import { NextRequest } from 'next/server'

const PHARMACY = 'b1000000-0000-0000-0000-000000000001'
let user: Record<string, unknown> | null = null
const serviceUsed = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user }, error: user ? null : { message: 'no user' } }) },
  }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ marker: 'service' }) }))
jest.mock('@/lib/pharmacy-onboarding/application', () => ({
  MAX_DOCUMENT_BYTES: 4 * 1024 * 1024,
  deleteLicense: (...a: unknown[]) => { serviceUsed('deleteLicense', ...a); return Promise.resolve({ ok: true }) },
  attachLicenseDocument: (...a: unknown[]) => { serviceUsed('attachLicenseDocument', ...a); return Promise.resolve({ ok: true }) },
}))

import { DELETE } from '../licenses/[state]/route'
import { POST as UPLOAD } from '../licenses/[state]/document/route'

const admin = { id: 'u-1', app_metadata: { app_role: 'pharmacy_admin', pharmacy_id: PHARMACY } }
const ctx = (state: string) => ({ params: Promise.resolve({ state }) })
const del = (state: string) => DELETE(new NextRequest('https://app.test/x', { method: 'DELETE' }), ctx(state))
function upload(state: string) {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], { type: 'application/pdf' }), 'license.pdf')
  const formData = jest.fn(async () => form)
  const req = { headers: new Headers(), formData } as unknown as NextRequest
  return { run: () => UPLOAD(req, ctx(state)), formData }
}

beforeEach(() => {
  user = admin
  serviceUsed.mockClear()
})

it('a US state passes through, upper-cased by the library as before', async () => {
  expect((await del('TX')).status).toBe(200)
  expect((await del('tx')).status).toBe(200)
  expect((await upload('PR').run()).status).toBe(200)
  expect(serviceUsed).toHaveBeenCalledTimes(3)
})

it('DELETE: a state that is not a US state is a 400 ("Unknown state."), nothing deleted', async () => {
  for (const state of ['ZZ', 'TEXAS', '..', 'T']) {
    const res = await del(state)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Unknown state.')
  }
  expect(serviceUsed).not.toHaveBeenCalled()
})

it('document: a state that is not a US state is a 400 before the upload is read', async () => {
  const u = upload('ZZ')
  const res = await u.run()
  expect(res.status).toBe(400)
  expect((await res.json()).error).toBe('Unknown state.')
  expect(u.formData).not.toHaveBeenCalled()
  expect(serviceUsed).not.toHaveBeenCalled()
})

it('auth still comes first: 401 signed out, 403 for another role, whatever the state', async () => {
  user = null
  expect((await del('ZZ')).status).toBe(401)
  user = { id: 'u-2', app_metadata: { app_role: 'clinic_admin', clinic_id: PHARMACY } }
  expect((await del('TX')).status).toBe(403)
  expect((await upload('TX').run()).status).toBe(403)
  expect(serviceUsed).not.toHaveBeenCalled()
})
