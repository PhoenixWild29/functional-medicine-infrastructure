/**
 * @jest-environment node
 *
 * GET /api/ops/fax/[faxId]/pdf: ops open an inbound fax. Inbound faxes live
 * only in Documo (Issue Log 72: the `fax-pdfs` bucket the viewer pointed at
 * does not exist), so the PDF is fetched from Documo on demand by the fax's
 * Documo id and streamed back.
 *
 *   - ops_admin only (app_metadata, getUser); clinic and pharmacy users 403;
 *     same-origin; rate limited per user.
 *   - application/pdf, Cache-Control no-store, inline.
 *   - one phi_access_log row per view: who, which fax (and its order when
 *     matched); no content. FAIL-CLOSED: when the row cannot be written
 *     (logPhiAccess resolves false), 503 with a plain message, no PDF.
 *   - a missing or expired fax: 404 with a plain message; Documo down: 502;
 *     never a stack trace, the API key or Documo's response.
 */

import { scriptedDb, DB_DOWN, type ScriptedCall, type ScriptedAnswer } from '@/__tests__/helpers/scripted-db'

const FAX = '55555555-5555-4555-8555-555555555555'
const ORDER = '44444444-4444-4444-8444-444444444444'
const OPS = { id: '11111111-1111-4111-8111-111111111111', email: 'ops@compoundiq.test', app_metadata: { app_role: 'ops_admin' } }

let user: unknown = OPS
const getSessionMock = jest.fn()
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser: async () => ({ data: { user }, error: null }), getSession: getSessionMock } }),
}))
let script: (c: ScriptedCall) => ScriptedAnswer | undefined = () => undefined
let db = scriptedDb(c => script(c))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
const downloadMock = jest.fn()
jest.mock('@/lib/documo/client', () => ({ downloadFaxPdf: (...a: unknown[]) => downloadMock(...a) }))

import { GET } from '../route'
import { logPhiAccess } from '@/lib/audit/phi-access'
import { faxViewLimiter } from '@/lib/fax/view-rate-limit'

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])
const req = (headers: Record<string, string> = {}) => new Request(`https://app.test/api/ops/fax/${FAX}/pdf`, { headers }) as unknown as import('next/server').NextRequest
const ctx = (faxId = FAX) => ({ params: Promise.resolve({ faxId }) })

let logs: string[] = []
beforeEach(() => {
  user = OPS
  getSessionMock.mockReset()
  faxViewLimiter.reset()
  ;(logPhiAccess as jest.Mock).mockClear()
  downloadMock.mockReset().mockResolvedValue({ ok: true, bytes: PDF.buffer })
  db = scriptedDb(c => script(c))
  script = c => (c.table === 'inbound_fax_queue' ? { data: { fax_id: FAX, documo_fax_id: 'documo-fax-9', matched_order_id: ORDER } } : undefined)
  logs = []
  for (const level of ['info', 'warn', 'error'] as const) {
    jest.spyOn(console, level).mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(' ')) })
  }
})
afterEach(() => jest.restoreAllMocks())

describe('who may', () => {
  it('no session: 401, nothing fetched', async () => {
    user = null
    expect((await GET(req(), ctx())).status).toBe(401)
    expect(downloadMock).not.toHaveBeenCalled()
  })

  it.each(['clinic_admin', 'provider', 'medical_assistant', 'pharmacy_admin'])('%s: 403, nothing fetched or logged', async role => {
    user = { id: 'u', app_metadata: { app_role: role, clinic_id: 'c' } }
    expect((await GET(req(), ctx())).status).toBe(403)
    expect(downloadMock).not.toHaveBeenCalled()
    expect(logPhiAccess).not.toHaveBeenCalled()
  })

  it('a role in user_metadata does not count', async () => {
    user = { id: 'u', app_metadata: {}, user_metadata: { app_role: 'ops_admin' } }
    expect((await GET(req(), ctx())).status).toBe(403)
  })

  it('cross-site: 403', async () => {
    expect((await GET(req({ 'sec-fetch-site': 'cross-site' }), ctx())).status).toBe(403)
    expect(downloadMock).not.toHaveBeenCalled()
  })

  it('getUser, never getSession', async () => {
    await GET(req(), ctx())
    expect(getSessionMock).not.toHaveBeenCalled()
  })

  it('a malformed fax id: 400', async () => {
    expect((await GET(req(), ctx('not-a-uuid'))).status).toBe(400)
  })

  it('rate limited per user: the 61st view in 10 minutes is 429', async () => {
    for (let i = 0; i < 60; i++) expect((await GET(req(), ctx())).status).toBe(200)
    const res = await GET(req(), ctx())
    expect(res.status).toBe(429)
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0)
  })
})

describe('the fax', () => {
  it('the PDF, from Documo by its Documo id: application/pdf, no-store, inline', async () => {
    const res = await GET(req(), ctx())
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('content-disposition')).toMatch(/^inline/)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PDF)
    expect(downloadMock).toHaveBeenCalledWith('documo-fax-9')
    expect(db.to('inbound_fax_queue')[0]?.filters).toMatchObject({ fax_id: FAX, 'deleted_at:is': null })
  })

  it('one PHI access row: who, which fax, its order; nothing from the fax', async () => {
    await GET(req(), ctx())
    expect(logPhiAccess).toHaveBeenCalledTimes(1)
    expect(logPhiAccess).toHaveBeenCalledWith(expect.objectContaining({
      user: OPS, action: 'view', resource: 'inbound_fax', route: '/api/ops/fax/[faxId]/pdf', faxId: FAX, orderId: ORDER,
    }))
    const entry = (logPhiAccess as jest.Mock).mock.calls[0]![0] as Record<string, unknown>
    expect(JSON.stringify(entry)).not.toContain('documo-fax-9')
  })

  it('the access row cannot be written: 503, a plain message, no PDF', async () => {
    ;(logPhiAccess as jest.Mock).mockResolvedValueOnce(false)
    const res = await GET(req(), ctx())
    expect(res.status).toBe(503)
    expect(res.headers.get('content-type')).not.toMatch(/pdf/)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ error: 'The fax could not be opened right now. Try again in a few minutes.' })
    expect(logPhiAccess).toHaveBeenCalledTimes(1)
  })

  it('a fax that is not in the queue: 404, a plain message, nothing fetched or logged', async () => {
    script = () => ({ data: null })
    const res = await GET(req(), ctx())
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'This fax is no longer available.' })
    expect(downloadMock).not.toHaveBeenCalled()
    expect(logPhiAccess).not.toHaveBeenCalled()
  })

  it('Documo no longer has it (expired): 404, the same plain message, not logged as viewed', async () => {
    downloadMock.mockResolvedValue({ ok: false, reason: 'not_found' })
    const res = await GET(req(), ctx())
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'This fax is no longer available.' })
    expect(logPhiAccess).not.toHaveBeenCalled()
  })

  it('Documo cannot be reached: 502, a plain message', async () => {
    downloadMock.mockResolvedValue({ ok: false, reason: 'failed' })
    const res = await GET(req(), ctx())
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'The fax could not be fetched right now. Try again in a few minutes.' })
  })

  it('the queue cannot be read: 503, no stack trace', async () => {
    script = () => DB_DOWN
    const res = await GET(req(), ctx())
    expect(res.status).toBe(503)
    const body = await res.text()
    expect(body).not.toMatch(/at \w+ \(|Error:|connection reset/)
  })

  it('the Documo client throws: 502, nothing leaks', async () => {
    downloadMock.mockRejectedValue(new Error('X-API-Key documo-key-SECRET-123 rejected'))
    const res = await GET(req(), ctx())
    expect(res.status).toBe(502)
    expect(await res.text()).not.toContain('documo-key-SECRET-123')
    expect(logs.join('\n')).not.toContain('documo-key-SECRET-123')
  })
})
