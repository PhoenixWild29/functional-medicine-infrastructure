/**
 * @jest-environment node
 *
 * GET /api/pharmacy-licensure/check (C5): for Review, which session lines
 * cannot be sent to their pharmacy for the patient's shipping state. Any
 * signed-in clinic user (the person building the batch is not always the
 * signer); verified with getUser().
 */

import type { NextRequest } from 'next/server'
import { NextRequest as Req } from 'next/server'
import { GET } from '../route'
import { fakeDb } from '@/lib/orders/__tests__/fake-db'

const getUserMock = jest.fn()
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockImplementation(async () => ({
    auth: {
      getUser: () => getUserMock(),
      getSession: async () => ({ data: { session: { user: { app_metadata: { app_role: 'provider', clinic_id: 'c-1' } } } } }),
    },
  })),
}))
let db: ReturnType<typeof fakeDb>
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))

const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
afterAll(() => errorSpy.mockRestore())

const post = (body: { state?: unknown; lines?: unknown }) => {
  const qs = new URLSearchParams()
  if (body.state !== undefined) qs.set('state', String(body.state))
  if (body.lines !== undefined) qs.set('lines', JSON.stringify(body.lines))
  return GET(new Req(new URL(`https://app.test/api/pharmacy-licensure/check?${qs.toString()}`)) as unknown as NextRequest)
}

beforeEach(() => {
  getUserMock.mockReset().mockResolvedValue({ data: { user: { id: 'u-1', app_metadata: { app_role: 'medical_assistant', clinic_id: 'c-1' } } }, error: null })
  db = fakeDb({
    pharmacies: [{ pharmacy_id: 'ph-1', name: 'Lapsed Rx', facility_type: '503A' }],
    pharmacy_state_licenses: [{ pharmacy_id: 'ph-1', state_code: 'TX', expiration_date: '2026-01-31', is_active: true, deleted_at: null, sterile_compounding: true }],
    formulations: [{ formulation_id: 'f-cap', dosage_forms: { name: 'Capsule', is_sterile: false } }],
  })
})

it('returns the problem for each line that cannot be sent', async () => {
  const res = await post({ state: 'TX', lines: [{ key: 'l1', pharmacyId: 'ph-1', formulationId: 'f-cap', catalogItemId: null }] })
  expect(res.status).toBe(200)
  const body = await res.json() as { problems: Array<{ key: string; message: string }> }
  expect(body.problems).toEqual([expect.objectContaining({ key: 'l1', message: expect.stringContaining('expired on 2026-01-31') })])
})

it('401 without a verified user, whatever the cookie session says', async () => {
  getUserMock.mockResolvedValue({ data: { user: null }, error: { message: 'invalid JWT' } })
  expect((await post({ state: 'TX', lines: [] })).status).toBe(401)
})

it('403 for a user who is not a clinic user', async () => {
  getUserMock.mockResolvedValue({ data: { user: { id: 'u-2', app_metadata: { app_role: 'ops_admin' } } }, error: null })
  expect((await post({ state: 'TX', lines: [] })).status).toBe(403)
})

it('400 on a body without a two-letter state or a lines array', async () => {
  expect((await post({ state: 'Texas', lines: [] })).status).toBe(400)
  expect((await post({ state: 'TX' })).status).toBe(400)
})

it('503 when the check cannot run', async () => {
  db.failOn('pharmacy_state_licenses:select')
  const res = await post({ state: 'TX', lines: [{ key: 'l1', pharmacyId: 'ph-1', formulationId: 'f-cap', catalogItemId: null }] })
  expect(res.status).toBe(503)
})
