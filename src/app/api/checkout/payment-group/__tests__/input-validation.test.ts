/**
 * @jest-environment node
 *
 * POST /api/checkout/payment-group input validation. Auth (getUser, a
 * clinic-app role, the clinic from app_metadata) comes first; then the body.
 * A JSON body that is not an object is a 400, not a thrown 500. Order ids
 * must be uuid-shaped; the seeded demo ids (not RFC v4) are accepted.
 * Nothing reaches createPaymentGroup (or Stripe) on bad input.
 */

import type { NextRequest } from 'next/server'

const getUserMock = jest.fn()
const createGroupMock = jest.fn()
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser: () => getUserMock() } }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({}) }))
jest.mock('@/lib/onboarding/approval-guard', () => ({ refuseUnlessApproved: async () => null }))
jest.mock('@/lib/payment-group/create-group', () => ({ createPaymentGroup: (a: unknown) => createGroupMock(a) }))

import { POST } from '../route'

const CLINIC = 'aaaaaaaa-aaaa-4aaa-9aaa-aaaaaaaaaaaa'
const SEEDED_A = 'a3000000-0000-0000-0000-000000000001'
const SEEDED_B = 'a3000000-0000-0000-0000-000000000002'

const req = (body: string) =>
  new Request('https://app.test/api/checkout/payment-group', { method: 'POST', headers: { 'content-type': 'application/json' }, body }) as unknown as NextRequest
function as(role: string) {
  getUserMock.mockResolvedValue({ data: { user: { id: 'u1', app_metadata: { app_role: role, clinic_id: CLINIC } } } })
}

beforeEach(() => {
  process.env['PHASE_C_GROUPS_ENABLED'] = 'true'
  createGroupMock.mockReset().mockResolvedValue({ ok: true, groupId: 'g', stripePaymentIntentId: 'pi', totalCents: 100, orderCount: 2 })
  as('provider')
})
afterEach(() => { delete process.env['PHASE_C_GROUPS_ENABLED'] })

describe('POST /api/checkout/payment-group: input', () => {
  it('a wrong role is 403 before the body is read', async () => {
    as('ops_admin')
    const res = await POST(req('{'))
    expect(res.status).toBe(403)
    expect(createGroupMock).not.toHaveBeenCalled()
  })

  it('invalid JSON: 400', async () => {
    const res = await POST(req('{'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Invalid JSON body')
  })

  it('a null body: 400 orderIds must be an array, not a thrown 500', async () => {
    const res = await POST(req('null'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('orderIds must be an array')
    expect(createGroupMock).not.toHaveBeenCalled()
  })

  it('an order id that is not a uuid: 400', async () => {
    const res = await POST(req(JSON.stringify({ orderIds: [SEEDED_A, 'nope'] })))
    expect(res.status).toBe(400)
    expect(createGroupMock).not.toHaveBeenCalled()
  })

  it('an order id that is not a string: 400', async () => {
    const res = await POST(req(JSON.stringify({ orderIds: [SEEDED_A, 12345] })))
    expect(res.status).toBe(400)
    expect(createGroupMock).not.toHaveBeenCalled()
  })

  it('seeded demo order ids (not RFC v4) are accepted', async () => {
    const res = await POST(req(JSON.stringify({ orderIds: [SEEDED_A, SEEDED_B] })))
    expect(res.status).toBe(201)
    expect(createGroupMock).toHaveBeenCalledWith(expect.objectContaining({ clinicId: CLINIC, orderIds: [SEEDED_A, SEEDED_B] }))
  })
})
