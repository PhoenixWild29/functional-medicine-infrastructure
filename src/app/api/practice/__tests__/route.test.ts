/**
 * @jest-environment node
 *
 * WO-107: GET /api/practice — access, and sections that fail say so.
 */

import { GET } from '../route'
import { phiLog, phiEntries } from '@/__tests__/helpers/phi-log'
import { logPhiAccessMany } from '@/lib/audit/phi-access'
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

// Compliance C2 (B14): the practice dashboard is logged once per patient its
// needs-attention queue names.
describe('PHI access log', () => {
  const many = jest.mocked(logPhiAccessMany)
  beforeEach(() => { phiLog.mockClear(); many.mockClear() })

  const item = (orderId: string, patientId: string | null) => ({ kind: 'stale_draft', orderId, patientId, title: 't', detail: 'd', href: 'h', hrefLabel: 'l', since: null })

  it('a read logs view / practice_dashboard for each distinct patient in the queue', async () => {
    attentionMock.mockResolvedValue({ items: [item('o1', 'p1'), item('o2', 'p1'), item('o3', 'p2'), item('o4', null)], errors: [] })
    expect((await GET(req())).status).toBe(200)
    expect(many).toHaveBeenCalledTimes(1)
    const [entry, ids] = many.mock.calls[0]!
    expect(entry).toEqual(expect.objectContaining({ action: 'view', resource: 'practice_dashboard', route: '/api/practice', clinicId: 'clinic-1' }))
    expect(entry.user).toBeTruthy()
    expect([...ids].sort()).toEqual(['p1', 'p2'])
    expect(phiEntries()).toHaveLength(0)
  })

  it('a queue that could not be loaded names no patient', async () => {
    attentionMock.mockRejectedValue(new Error('boom'))
    expect((await GET(req())).status).toBe(200)
    expect(many.mock.calls.flatMap(c => [...c[1]])).toEqual([])
  })

  it('a log that fails still serves the dashboard', async () => {
    attentionMock.mockResolvedValue({ items: [item('o1', 'p1')], errors: [] })
    many.mockResolvedValueOnce(false)
    expect((await GET(req())).status).toBe(200)
  })

  it('a refused read logs nothing', async () => {
    accessMock.mockResolvedValue({ ok: false, status: 403, error: 'not shared' })
    expect((await GET(req())).status).toBe(403)
    expect(phiEntries()).toHaveLength(0)
    expect(many).not.toHaveBeenCalled()
  })
})

// C-2026-10-26-04: review L7 (a draft check error names its patient) and L5.
describe('review L7 and L5', () => {
  const many = jest.mocked(logPhiAccessMany)
  beforeEach(() => many.mockClear())

  it('L7: the patients named in errors[] are in the logged set', async () => {
    attentionMock.mockResolvedValue({ items: [], errors: [{ check: 'Draft check for Alex Demo', error: 'x', patientId: 'p9' }, { check: 'Refunds', error: 'y' }] })
    await GET(req())
    expect([...many.mock.calls[0]![1]]).toEqual(['p9'])
  })

  it('L5: logged with a 15-minute dedupe', async () => {
    attentionMock.mockResolvedValue({ items: [], errors: [] })
    await GET(req())
    expect(many.mock.calls[0]?.[2]).toEqual({ dedupeMinutes: 15 })
  })
})
