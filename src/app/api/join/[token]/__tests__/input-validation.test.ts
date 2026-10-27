/**
 * @jest-environment node
 *
 * POST /api/join/[token] input validation. The token is the credential;
 * its shape is checked before the link is looked up (resolveSignupLink).
 * A JSON body of null used to throw (a 500) when the mobile number was
 * read; it is a 400 and nothing is written.
 */

import { scriptedDb } from '@/__tests__/helpers/scripted-db'

const CLINIC_ID = 'aaaaaaaa-aaaa-4aaa-9aaa-aaaaaaaaaaaa'
const LINK_ID = 'c1000000-0000-4000-8000-000000000001'
const TOKEN = 'A'.repeat(43)

let db = scriptedDb(() => undefined)
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.mock('@/lib/patients/duplicates', () => ({ flagPossibleDuplicate: async () => null }))

import { POST } from '../route'
import { joinSubmitLimiter } from '@/lib/intake/join-abuse'

const req = (body: string) => new Request(`https://app.test/api/join/${TOKEN}`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' }, body,
}) as unknown as import('next/server').NextRequest
const ctx = (token = TOKEN) => ({ params: Promise.resolve({ token }) })

beforeEach(() => {
  joinSubmitLimiter.reset()
  db = scriptedDb(c => {
    if (c.table === 'clinic_signup_links') return { data: { link_id: LINK_ID, clinic_id: CLINIC_ID, enabled: true, revoked_at: null, clinics: { name: 'Test' } } }
    if (c.table === 'clinics') return { data: { onboarding_status: 'approved', is_active: true } }
    return undefined
  })
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

it('a JSON body of null: 400, nothing written', async () => {
  const res = await POST(req('null'), ctx())
  expect(res.status).toBe(400)
  expect(db.calls.filter(c => c.op !== 'select')).toEqual([])
})

it('a malformed token is refused before any lookup', async () => {
  const res = await POST(req('{}'), ctx("x' or 1=1"))
  expect(res.status).toBe(404)
  expect(db.calls).toEqual([])
})
