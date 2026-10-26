/**
 * @jest-environment node
 *
 * downloadFaxPdf: an inbound fax's PDF fetched from Documo on demand, by its
 * Documo message id (inbound faxes live only in Documo). Documo's documented
 * Download Fax endpoint (https://docs.documo.com, Fax > Download Fax):
 *   GET https://api.documo.com/v1/fax/:messageId/download?format=pdf
 *   Authorization: Basic <API key>
 * No real network in tests. The key, the account and Documo's response body
 * never appear in what it returns or logs.
 */

const fetchMock = jest.fn()

process.env['DOCUMO_API_KEY'] = 'documo-key-SECRET-123'
process.env['DOCUMO_ACCOUNT_ID'] = 'acct-777'

import { downloadFaxPdf } from '../client'

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]) // %PDF-
let logs: string[] = []

beforeEach(() => {
  fetchMock.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
  logs = []
  for (const level of ['info', 'warn', 'error'] as const) {
    jest.spyOn(console, level).mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(' ')) })
  }
})
afterEach(() => jest.restoreAllMocks())

it('GETs Documo\'s v1 Download Fax for the message id, Basic API key auth, asking for a PDF', async () => {
  fetchMock.mockResolvedValue(new Response(PDF, { status: 200, headers: { 'content-type': 'application/pdf' } }))
  const r = await downloadFaxPdf('fax_abc-123')
  expect(r.ok).toBe(true)
  if (r.ok) expect(new Uint8Array(r.bytes)).toEqual(PDF)
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
  expect(url).toBe('https://api.documo.com/v1/fax/fax_abc-123/download?format=pdf')
  expect((init.headers as Record<string, string>)['Authorization']).toBe('Basic documo-key-SECRET-123')
  expect(init.headers as Record<string, string>).not.toHaveProperty('X-API-Key')
  expect((init.headers as Record<string, string>)['Accept']).toBe('application/pdf')
  expect(init.method ?? 'GET').toBe('GET')
})

it('encodes the id: a Documo id can never change the path', async () => {
  fetchMock.mockResolvedValue(new Response(PDF, { status: 200 }))
  await downloadFaxPdf('../../accounts/other/faxes')
  expect((fetchMock.mock.calls[0] as [string])[0]).toBe('https://api.documo.com/v1/fax/..%2F..%2Faccounts%2Fother%2Ffaxes/download?format=pdf')
})

it.each([404, 410])('%i: not found', async status => {
  fetchMock.mockResolvedValue(new Response('{"error":"gone"}', { status }))
  expect(await downloadFaxPdf('fax_1')).toEqual({ ok: false, reason: 'not_found' })
})

it.each([401, 403, 500, 503])('%i: failed, logged with the status only', async status => {
  fetchMock.mockResolvedValue(new Response('{"error":"bad key documo-key-SECRET-123 for acct-777"}', { status }))
  expect(await downloadFaxPdf('fax_1')).toEqual({ ok: false, reason: 'failed' })
  const all = logs.join('\n')
  expect(all).toContain(String(status))
  expect(all).not.toContain('documo-key-SECRET-123')
  expect(all).not.toContain('acct-777')
})

it('a network error or timeout: failed, nothing secret logged', async () => {
  fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED api.documo.com with X-API-Key documo-key-SECRET-123'))
  expect(await downloadFaxPdf('fax_1')).toEqual({ ok: false, reason: 'failed' })
  expect(logs.join('\n')).not.toContain('documo-key-SECRET-123')
})

it('not a PDF (an HTML error page with 200): failed', async () => {
  fetchMock.mockResolvedValue(new Response('<html>login</html>', { status: 200, headers: { 'content-type': 'text/html' } }))
  expect(await downloadFaxPdf('fax_1')).toEqual({ ok: false, reason: 'failed' })
})
