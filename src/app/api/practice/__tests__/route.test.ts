/**
 * @jest-environment node
 *
 * WO-107: GET /api/practice — access, and sections that fail say so.
 */

import { GET } from '../route'
import type { NextRequest } from 'next/server'

const getUserMock = jest.fn()
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockResolvedValue({ auth: { getUser: () => getUserMock() } }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({}) }))

const accessMock = jest.fn()
jest.mock('@/lib/practice/access', () => ({ practiceAccess: (...a: unknown[]) => accessMock(...a) }))
const numbersMock = jest.fn()
jest.mock('@/lib/practice/load', () => ({ loadPracticeNumbers: (...a: unknown[]) => numbersMock(...a) }))
const attentionMock = jest.fn()
jest.mock('@/lib/practice/attention', () => ({ loadAttention: (...a: unknown[]) => attentionMock(...a) }))

const req = (qs = '') => ({ url: `https://app.test/api/practice${qs}` }) as unknown as NextRequest

beforeEach(() => {
  getUserMock.mockReset().mockResolvedValue({ data: { user: { id: 'u1' } } })
  accessMock.mockReset().mockResolvedValue({ ok: true, clinicId: 'clinic-1', role: 'clinic_admin' })
  numbersMock.mockReset().mockResolvedValue({ ok: true, data: { totals: {}, breakdowns: {} } })
  attentionMock.mockReset().mockResolvedValue({ items: [], errors: [] })
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { jest.restoreAllMocks() })

describe('GET /api/practice', () => {
  it('refuses whoever access refuses, with its status, and reads nothing', async () => {
    accessMock.mockResolvedValue({ ok: false, status: 403, error: 'not shared' })
    const res = await GET(req())
    expect(res.status).toBe(403)
    expect(numbersMock).not.toHaveBeenCalled()
    expect(attentionMock).not.toHaveBeenCalled()
  })

  it("reads the session's clinic for the requested period", async () => {
    const res = await GET(req('?period=7d&clinic_id=someone-else'))
    expect(res.status).toBe(200)
    expect(numbersMock).toHaveBeenCalledWith(expect.anything(), 'clinic-1', expect.objectContaining({ key: '7d' }))
    expect(attentionMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ clinicId: 'clinic-1', viewerIsProvider: false }))
  })

  it('a section that failed is returned as a failure, not as zeros', async () => {
    numbersMock.mockResolvedValue({ ok: false, error: 'Orders could not be read.' })
    attentionMock.mockRejectedValue(new Error('boom'))
    const body = await (await GET(req())).json()
    expect(body.numbers).toEqual({ ok: false, error: 'Orders could not be read.' })
    expect(body.attention).toEqual({ ok: false, error: 'The needs-attention queue could not be loaded.' })
  })
})
