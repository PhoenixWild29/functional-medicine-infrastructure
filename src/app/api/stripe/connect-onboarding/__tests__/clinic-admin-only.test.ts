/**
 * @jest-environment node
 *
 * Stripe Connect onboarding is the clinic's payout account: only the
 * clinic admin may start or resume it. Any other clinic user (provider,
 * medical assistant) gets 403 and nothing is created at Stripe. The caller
 * is verified with getUser(); a cookie session alone is not trusted.
 *
 * Stripe is mocked; nothing here reaches a real account.
 */

import type { NextRequest } from 'next/server'
import { POST } from '../route'

const getUserMock         = jest.fn()
const accountsCreateMock  = jest.fn()
const accountLinksMock    = jest.fn()
const clinicFetchMock     = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockImplementation(async () => ({
    auth: {
      getUser: () => getUserMock(),
      getSession: async () => ({ data: { session: { user: { app_metadata: { app_role: 'clinic_admin', clinic_id: 'c-1' } } } } }),
    },
  })),
}))

jest.mock('@/lib/stripe/client', () => ({
  createStripeClient: () => ({
    accounts:     { create: (a: unknown) => accountsCreateMock(a) },
    accountLinks: { create: (a: unknown) => accountLinksMock(a) },
  }),
}))

jest.mock('@/lib/env', () => ({ serverEnv: { appBaseUrl: () => 'https://app.test' } }))

function chain(single: () => unknown): Record<string, unknown> {
  const c: Record<string, unknown> = {}
  for (const k of ['select', 'eq', 'is', 'update']) c[k] = () => c
  c['maybeSingle'] = async () => single()
  c['then'] = (resolve: (r: unknown) => unknown) => Promise.resolve({ data: [{ stripe_connect_account_id: 'acct_new' }], error: null }).then(resolve)
  return c
}

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({ from: () => chain(() => clinicFetchMock()) }),
}))

const user = (app_role: string) => ({
  data: { user: { id: 'u-1', email: 'x@clinic.test', app_metadata: { app_role, clinic_id: 'c-1' } } },
  error: null,
})

const post = () => POST({} as NextRequest)

const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
const infoSpy  = jest.spyOn(console, 'info').mockImplementation(() => {})
afterAll(() => { errorSpy.mockRestore(); infoSpy.mockRestore() })

beforeEach(() => {
  getUserMock.mockReset()
  accountsCreateMock.mockReset().mockResolvedValue({ id: 'acct_new' })
  accountLinksMock.mockReset().mockResolvedValue({ url: 'https://connect.stripe.test/onboard' })
  clinicFetchMock.mockReset().mockResolvedValue({
    data: { clinic_id: 'c-1', stripe_connect_account_id: null, stripe_connect_status: 'PENDING' }, error: null,
  })
})

describe('only the clinic admin may start or resume Connect onboarding', () => {
  it.each(['provider', 'medical_assistant'])('%s gets 403 and nothing is created at Stripe', async (role) => {
    getUserMock.mockResolvedValue(user(role))

    const res = await post()

    expect(res.status).toBe(403)
    expect(accountsCreateMock).not.toHaveBeenCalled()
    expect(accountLinksMock).not.toHaveBeenCalled()
  })

  it('a provider cannot resume a RESTRICTED account either', async () => {
    getUserMock.mockResolvedValue(user('provider'))
    clinicFetchMock.mockResolvedValue({ data: { clinic_id: 'c-1', stripe_connect_account_id: 'acct_1', stripe_connect_status: 'RESTRICTED' }, error: null })

    const res = await post()

    expect(res.status).toBe(403)
    expect(accountLinksMock).not.toHaveBeenCalled()
  })

  it('the clinic admin gets the onboarding link', async () => {
    getUserMock.mockResolvedValue(user('clinic_admin'))

    const res = await post()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ url: 'https://connect.stripe.test/onboard' })
  })

  it('the caller is verified with getUser(): no verified user is 401, whatever the cookie session says', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: { message: 'invalid JWT' } })

    const res = await post()

    expect(res.status).toBe(401)
    expect(accountsCreateMock).not.toHaveBeenCalled()
  })
})
