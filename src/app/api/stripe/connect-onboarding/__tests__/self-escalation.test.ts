/**
 * @jest-environment node
 *
 * Connect onboarding is clinic-admin only. A provider who rewrote their
 * own user_metadata to app_role=clinic_admin (and another clinic) is still
 * a provider: 403, and nothing reaches Stripe. Stripe is mocked.
 */

import type { NextRequest } from 'next/server'
import { POST } from '../route'

const getUserMock        = jest.fn()
const accountsCreateMock = jest.fn()
const accountLinksMock   = jest.fn()
const clinicEqMock       = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser: () => getUserMock() } }),
}))

jest.mock('@/lib/stripe/client', () => ({
  createStripeClient: () => ({
    accounts:     { create: (a: unknown) => accountsCreateMock(a) },
    accountLinks: { create: (a: unknown) => accountLinksMock(a) },
  }),
}))

jest.mock('@/lib/env', () => ({ serverEnv: { appBaseUrl: () => 'https://app.test' } }))

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
    const c: Record<string, unknown> = {}
    c['from']   = () => c
    c['select'] = () => c
    c['update'] = () => c
    c['is']     = () => c
    c['eq']     = (col: string, val: unknown) => { clinicEqMock(col, val); return c }
    c['maybeSingle'] = async () => ({
      data: { clinic_id: 'x', stripe_connect_account_id: 'acct_1', stripe_connect_status: 'ONBOARDING' }, error: null,
    })
    return c
  },
}))

jest.spyOn(console, 'error').mockImplementation(() => {})
jest.spyOn(console, 'info').mockImplementation(() => {})

const CLINIC_A = '11111111-1111-4111-8111-111111111111'
const CLINIC_B = '22222222-2222-4222-8222-222222222222'

function user(app: Record<string, unknown>, meta: Record<string, unknown>) {
  return { data: { user: { id: 'u-1', email: 'x@clinic.test', app_metadata: app, user_metadata: meta } }, error: null }
}

beforeEach(() => {
  jest.clearAllMocks()
  accountLinksMock.mockResolvedValue({ url: 'https://connect.stripe.test/x' })
})

describe('connect onboarding ignores self-edited user_metadata', () => {
  it('a provider who wrote app_role=clinic_admin gets 403 and nothing reaches Stripe', async () => {
    getUserMock.mockResolvedValue(user(
      { app_role: 'provider', clinic_id: CLINIC_A },
      { app_role: 'clinic_admin', clinic_id: CLINIC_B },
    ))
    const res = await POST({} as NextRequest)
    expect(res.status).toBe(403)
    expect(accountsCreateMock).not.toHaveBeenCalled()
    expect(accountLinksMock).not.toHaveBeenCalled()
  })

  it('the real clinic admin is scoped to the app_metadata clinic, not a self-edited one', async () => {
    getUserMock.mockResolvedValue(user(
      { app_role: 'clinic_admin', clinic_id: CLINIC_A },
      { app_role: 'clinic_admin', clinic_id: CLINIC_B },
    ))
    const res = await POST({} as NextRequest)
    expect(res.status).toBe(200)
    expect(clinicEqMock).toHaveBeenCalledWith('clinic_id', CLINIC_A)
    expect(clinicEqMock).not.toHaveBeenCalledWith('clinic_id', CLINIC_B)
  })
})
