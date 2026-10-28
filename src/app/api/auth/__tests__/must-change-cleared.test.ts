/**
 * @jest-environment node
 *
 * B's review P2: an invited login carries app_metadata.must_change_password
 * until its owner sets a new password from an emailed reset link (a
 * recovery session, which proves the address is theirs). A successful
 * POST /api/auth/password clears it, with the service role, keeping the
 * rest of app_metadata. The reset page tells a flagged user with an
 * ordinary session how to get that link.
 */

import { NextRequest } from 'next/server'

const getUserMock = jest.fn()
const updateUserMock = jest.fn()
const updateUserByIdMock = jest.fn()
let claims: Record<string, unknown> = {}

jest.mock('@/lib/supabase/server', () => ({
  createRouteHandlerClient: jest.fn(async () => ({
    auth: {
      getUser: () => getUserMock(),
      getClaims: async () => ({ data: { claims }, error: null }),
      updateUser: (...a: unknown[]) => updateUserMock(...a),
      signOut: async () => ({ error: null }),
    },
  })),
  createServerClient: jest.fn(async () => ({
    auth: { getUser: () => getUserMock(), getClaims: async () => ({ data: { claims } }) },
  })),
}))
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({ auth: { admin: { updateUserById: (...a: unknown[]) => updateUserByIdMock(...a) } } }),
}))
jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }))

import { POST as SET } from '../password/route'
import { passwordLimiters } from '@/lib/auth/password-rate-limit'

const NEW = 'violet harbor 42 lantern'
const FLAGGED_META = { app_role: 'provider', clinic_id: 'c-1', must_change_password: true }
const recovery = () => ({ sub: 'u-1', amr: [{ method: 'recovery', timestamp: Math.floor(Date.now() / 1000) - 60 }] })
const req = () => new NextRequest(new URL('http://localhost/api/auth/password'), {
  method: 'POST', body: JSON.stringify({ password: NEW }), headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
})

beforeEach(() => {
  for (const m of [getUserMock, updateUserMock, updateUserByIdMock]) m.mockReset()
  for (const limiter of Object.values(passwordLimiters)) limiter.reset()
  updateUserMock.mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null })
  updateUserByIdMock.mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null })
  claims = recovery()
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'info').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

it('a successful reset clears must_change_password, keeping role and clinic', async () => {
  getUserMock.mockResolvedValue({ data: { user: { id: 'u-1', email: 'dr@clinic.test', app_metadata: FLAGGED_META } }, error: null })
  expect((await SET(req())).status).toBe(200)
  expect(updateUserByIdMock).toHaveBeenCalledWith('u-1', { app_metadata: { ...FLAGGED_META, must_change_password: false } })
})

it('an unflagged login is not touched', async () => {
  getUserMock.mockResolvedValue({ data: { user: { id: 'u-1', email: 'dr@clinic.test', app_metadata: { app_role: 'provider', clinic_id: 'c-1' } } }, error: null })
  expect((await SET(req())).status).toBe(200)
  expect(updateUserByIdMock).not.toHaveBeenCalled()
})

it('a failed password update leaves the flag', async () => {
  getUserMock.mockResolvedValue({ data: { user: { id: 'u-1', email: 'dr@clinic.test', app_metadata: FLAGGED_META } }, error: null })
  updateUserMock.mockResolvedValue({ data: null, error: { code: 'same_password', message: 'x' } })
  expect((await SET(req())).status).toBe(400)
  expect(updateUserByIdMock).not.toHaveBeenCalled()
})

it('a pharmacy_admin from a pharmacy invite: the reset clears the flag too, keeping role and pharmacy', async () => {
  const meta = { app_role: 'pharmacy_admin', clinic_id: null, pharmacy_id: 'p-1', must_change_password: true }
  getUserMock.mockResolvedValue({ data: { user: { id: 'u-1', email: 'admin@pharmacy.test', app_metadata: meta } }, error: null })
  expect((await SET(req())).status).toBe(200)
  expect(updateUserByIdMock).toHaveBeenCalledWith('u-1', { app_metadata: { ...meta, must_change_password: false } })
})
