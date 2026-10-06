/**
 * @jest-environment node
 *
 * C7 (no PHI to Stripe): the Connect onboarding call sends Stripe only the
 * account type and the opaque clinic_id. No clinic name, specialty, email
 * or address. Auth reads the user with getUser(), never getSession().
 */

import { POST } from '../route'
import type { NextRequest } from 'next/server'

const CLINIC_ID = '22222222-2222-4222-8222-222222222222'

const getUserMock         = jest.fn()
const getSessionMock      = jest.fn()
const clinicFetchMock     = jest.fn()
const clinicUpdateMock    = jest.fn()
const accountsCreateMock  = jest.fn()
const accountLinksMock    = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({
    auth: { getUser: () => getUserMock(), getSession: () => getSessionMock() },
  }),
}))

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          is:          () => ({ maybeSingle: () => clinicFetchMock() }),
          maybeSingle: () => clinicFetchMock(),
        }),
      }),
      update: () => ({
        eq: () => ({ is: () => ({ select: () => clinicUpdateMock() }) }),
      }),
    }),
  }),
}))

jest.mock('@/lib/stripe/client', () => ({
  createStripeClient: () => ({
    accounts:     { create: (p: unknown) => accountsCreateMock(p) },
    accountLinks: { create: (p: unknown) => accountLinksMock(p) },
  }),
}))

jest.mock('@/lib/env', () => ({
  serverEnv: { appBaseUrl: () => 'https://app.example.test' },
}))

beforeEach(() => {
  jest.clearAllMocks()
  getUserMock.mockResolvedValue({
    data: { user: { id: 'u1', user_metadata: { app_role: 'clinic_admin', clinic_id: CLINIC_ID } } },
    error: null,
  })
  getSessionMock.mockResolvedValue({ data: { session: null } })
  clinicFetchMock.mockResolvedValue({
    data: { clinic_id: CLINIC_ID, stripe_connect_account_id: null, stripe_connect_status: 'PENDING' },
    error: null,
  })
  clinicUpdateMock.mockResolvedValue({ data: [{ stripe_connect_account_id: 'acct_new' }], error: null })
  accountsCreateMock.mockResolvedValue({ id: 'acct_new' })
  accountLinksMock.mockResolvedValue({ url: 'https://connect.stripe.test/onboard' })
})

describe('POST /api/stripe/connect-onboarding (C7)', () => {
  it('authenticates with getUser() and creates the Express account with only type and clinic_id', async () => {
    const res = await POST({} as NextRequest)
    expect(res.status).toBe(200)
    expect(getUserMock).toHaveBeenCalled()
    expect(getSessionMock).not.toHaveBeenCalled()

    expect(accountsCreateMock).toHaveBeenCalledTimes(1)
    expect(accountsCreateMock.mock.calls[0]![0]).toEqual({ type: 'express', metadata: { clinic_id: CLINIC_ID } })
  })

  it('creates the account link with only the account, URLs and type', async () => {
    await POST({} as NextRequest)
    const link = accountLinksMock.mock.calls[0]![0] as Record<string, unknown>
    expect(Object.keys(link).sort()).toEqual(['account', 'refresh_url', 'return_url', 'type'])
  })

  it('returns 401 when there is no verified user', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const res = await POST({} as NextRequest)
    expect(res.status).toBe(401)
    expect(accountsCreateMock).not.toHaveBeenCalled()
  })
})
