/**
 * @jest-environment node
 *
 * GET /api/orders/[orderId]/timeline-actors authenticates with
 * auth.getUser() (never getSession()) and reads clinic_id from the
 * verified user; the order must belong to that clinic.
 */

import { GET } from '../route'

const CLINIC = 'c0000000-0000-4000-8000-000000000001'
const ORDER_ID = 'a6000000-0000-0000-0000-000000000001'
const CHEN_UID = '11111111-1111-4111-8111-111111111111'

const getUserMock = jest.fn()
const getSessionMock = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockImplementation(async () => ({
    auth: { getUser: () => getUserMock(), getSession: () => getSessionMock() },
  })),
}))

const orderFilters: Array<[string, unknown]> = []
let orderRow: { order_id: string } | null = { order_id: ORDER_ID }

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn().mockImplementation(() => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {}
      chain['select'] = () => chain
      chain['eq'] = (c: string, v: unknown) => {
        if (table === 'orders') orderFilters.push([c, v])
        if (table === 'order_status_history') {
          return Promise.resolve({ data: [{ changed_by: CHEN_UID }], error: null })
        }
        return chain
      }
      chain['maybeSingle'] = () => Promise.resolve({ data: orderRow, error: null })
      return chain
    },
  })),
}))

const resolveMock = jest.fn()
jest.mock('@/lib/orders/timeline-actors', () => ({
  resolveTimelineActors: (...args: unknown[]) => resolveMock(...args),
}))

function call() {
  return GET({} as never, { params: Promise.resolve({ orderId: ORDER_ID }) })
}

beforeEach(() => {
  getUserMock.mockReset()
  getSessionMock.mockReset()
  resolveMock.mockReset()
  orderFilters.length = 0
  orderRow = { order_id: ORDER_ID }
  resolveMock.mockResolvedValue({ [CHEN_UID]: { name: 'Sarah Chen', role: 'provider' } })
})

describe('GET /api/orders/[orderId]/timeline-actors', () => {
  it('authenticates with getUser() and scopes the order to the verified user’s clinic', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1', user_metadata: { clinic_id: CLINIC, app_role: 'provider' } } } })

    const res = await call()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ actors: { [CHEN_UID]: { name: 'Sarah Chen', role: 'provider' } } })

    expect(getUserMock).toHaveBeenCalledTimes(1)
    expect(getSessionMock).not.toHaveBeenCalled()
    expect(orderFilters).toEqual([['order_id', ORDER_ID], ['clinic_id', CLINIC]])
    expect(resolveMock).toHaveBeenCalledWith(expect.anything(), CLINIC, [CHEN_UID])
  })

  it('401 when getUser() returns no user', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } })
    expect((await call()).status).toBe(401)
    expect(getSessionMock).not.toHaveBeenCalled()
  })

  it('400 when the verified user has no clinic_id', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1', user_metadata: { app_role: 'ops_admin' } } } })
    expect((await call()).status).toBe(400)
  })

  it('404 when the order is not in the caller’s clinic', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1', user_metadata: { clinic_id: CLINIC } } } })
    orderRow = null
    expect((await call()).status).toBe(404)
    expect(resolveMock).not.toHaveBeenCalled()
  })
})
