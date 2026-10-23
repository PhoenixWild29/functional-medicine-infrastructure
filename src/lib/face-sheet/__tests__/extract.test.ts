/**
 * @jest-environment node
 *
 * Patient Intake PR 4: reading a face sheet with Claude.
 *
 *   - The file goes inline in the request (a PDF as a document block, a
 *     PNG or JPG as an image block, pasted text as a text document); it is
 *     never uploaded anywhere else or kept.
 *   - Structured output: one tool, record_face_sheet, with a strict JSON
 *     schema. The answer is checked field by field: a value that is not
 *     valid is dropped (good, partial and garbage output).
 *   - The model comes from ANTHROPIC_MODEL (default claude-sonnet-5-5), the
 *     key from ANTHROPIC_API_KEY (the SDK reads it).
 *   - Errors come back as reasons, never with the file or the values.
 */

const createMock = jest.fn()
jest.mock('../client', () => ({ faceSheetClient: () => ({ beta: { messages: { create: (...a: unknown[]) => createMock(...a) } } }) }))

import Anthropic from '@anthropic-ai/sdk'
import { extractFaceSheet, normalizeFaceSheet, FACE_SHEET_TOOL, DEFAULT_FACE_SHEET_MODEL } from '../extract'

const GOOD = {
  first_name: 'Jane', last_name: 'Smith', date_of_birth: '1985-04-15', sex: 'female',
  mobile: '(512) 555-0142', email: 'Jane.Smith@Example.com',
  address_line1: '123 Main St', address_line2: 'Apt 4', city: 'Austin', state: 'tx', zip: '78701',
  allergies: ['Penicillin', 'Sulfa'], nkda: false, current_medications: 'Levothyroxine 50 mcg daily',
}

function toolReply(input: unknown, over: Record<string, unknown> = {}) {
  return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'record_face_sheet', input }], ...over }
}

const PDF = { kind: 'file' as const, mediaType: 'application/pdf' as const, data: Buffer.from('%PDF-1.7 fake') }

let logs: string[] = []
beforeEach(() => {
  createMock.mockReset().mockResolvedValue(toolReply(GOOD))
  delete process.env['ANTHROPIC_MODEL']
  logs = []
  for (const level of ['error', 'warn', 'info', 'log'] as const) {
    jest.spyOn(console, level).mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(' ')) })
  }
})
afterEach(() => jest.restoreAllMocks())

describe('the request', () => {
  it('a PDF goes inline as a base64 document, with the strict tool and the default model', async () => {
    await extractFaceSheet(PDF)
    const params = createMock.mock.calls[0]![0] as Record<string, unknown>
    expect(params['model']).toBe(DEFAULT_FACE_SHEET_MODEL)
    expect(DEFAULT_FACE_SHEET_MODEL).toBe('claude-sonnet-5-5')
    const content = (params['messages'] as Array<{ content: Array<Record<string, unknown>> }>)[0]!.content
    expect(content[0]).toEqual({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: PDF.data.toString('base64') } })
    expect(params['tools']).toEqual([FACE_SHEET_TOOL])
    expect(FACE_SHEET_TOOL).toEqual(expect.objectContaining({ name: 'record_face_sheet', strict: true }))
    expect((FACE_SHEET_TOOL.input_schema as { additionalProperties?: boolean }).additionalProperties).toBe(false)
    // Forced tool_choice is a 400 on current models: auto, one call.
    expect(params['tool_choice']).toEqual({ type: 'auto', disable_parallel_tool_use: true })
    // A declined request is retried server-side on Anthropic's recommended fallback.
    expect(params['fallbacks']).toBe('default')
    expect(params['betas']).toEqual(['server-side-fallback-2026-07-01'])
  })

  it('a PNG or JPG goes inline as a base64 image', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    await extractFaceSheet({ kind: 'file', mediaType: 'image/png', data: png })
    const content = (createMock.mock.calls[0]![0] as { messages: Array<{ content: Array<Record<string, unknown>> }> }).messages[0]!.content
    expect(content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') } })
  })

  it('pasted text goes as a plain-text document (data, not instructions)', async () => {
    await extractFaceSheet({ kind: 'text', text: 'Name: Jane Smith\nDOB 04/15/1985' })
    const content = (createMock.mock.calls[0]![0] as { messages: Array<{ content: Array<Record<string, unknown>> }> }).messages[0]!.content
    expect(content[0]).toEqual({ type: 'document', source: { type: 'text', media_type: 'text/plain', data: 'Name: Jane Smith\nDOB 04/15/1985' } })
  })

  it('ANTHROPIC_MODEL chooses the model', async () => {
    process.env['ANTHROPIC_MODEL'] = 'claude-opus-5-5'
    await extractFaceSheet(PDF)
    expect((createMock.mock.calls[0]![0] as { model: string }).model).toBe('claude-opus-5-5')
  })
})

describe('the answer', () => {
  it('good: every field, cleaned (email lower case, state upper case, mobile as E.164), and which fields came back', async () => {
    const r = await extractFaceSheet(PDF)
    expect(r).toEqual({
      ok: true,
      fields: {
        firstName: 'Jane', lastName: 'Smith', dateOfBirth: '1985-04-15', sex: 'female',
        mobile: '+15125550142', email: 'jane.smith@example.com',
        addressLine1: '123 Main St', addressLine2: 'Apt 4', city: 'Austin', state: 'TX', zip: '78701',
        allergies: ['Penicillin', 'Sulfa'], nkda: false, currentMedications: 'Levothyroxine 50 mcg daily',
      },
      filled: ['firstName', 'lastName', 'dateOfBirth', 'sex', 'mobile', 'email', 'addressLine1', 'addressLine2', 'city', 'state', 'zip', 'allergies', 'currentMedications'],
    })
  })

  it('partial: what is missing or not valid is left empty, the rest is kept', async () => {
    createMock.mockResolvedValue(toolReply({
      ...Object.fromEntries(Object.keys(GOOD).map(k => [k, null])),
      first_name: 'Jane', last_name: 'Smith',
      date_of_birth: '2099-01-01',   // in the future
      mobile: '12',                  // not a phone number
      state: 'Texas',                // not a 2-letter code
      zip: '787',                    // not a ZIP
      email: 'not an email',
      sex: 'F',                      // not one of the choices
    }))
    const r = await extractFaceSheet(PDF)
    expect(r).toEqual({
      ok: true,
      fields: expect.objectContaining({ firstName: 'Jane', lastName: 'Smith', dateOfBirth: null, mobile: null, state: null, zip: null, email: null, sex: null }),
      filled: ['firstName', 'lastName'],
    })
  })

  it('a US date (04/15/1985) is read as 1985-04-15', () => {
    expect(normalizeFaceSheet({ date_of_birth: '04/15/1985' }).fields.dateOfBirth).toBe('1985-04-15')
  })

  it('NKDA only when no allergy is listed: an allergy list wins over a contradicting NKDA', () => {
    expect(normalizeFaceSheet({ nkda: true, allergies: [] }).fields).toEqual(expect.objectContaining({ nkda: true, allergies: null }))
    expect(normalizeFaceSheet({ nkda: true, allergies: ['Latex'] }).fields).toEqual(expect.objectContaining({ nkda: false, allergies: ['Latex'] }))
  })

  it.each([
    ['no tool call at all', { stop_reason: 'end_turn', content: [{ type: 'text', text: 'I cannot read this.' }] }],
    ['a tool call with nothing usable', toolReply({ first_name: 42, last_name: ['x'], mobile: {} })],
    ['a tool input that is not an object', toolReply('Jane Smith')],
    ['every field empty', toolReply(Object.fromEntries(Object.keys(GOOD).map(k => [k, null])))],
    ['cut off at max_tokens', toolReply(GOOD, { stop_reason: 'max_tokens' })],
    ['a refusal', { stop_reason: 'refusal', content: [], stop_details: { type: 'refusal', category: null } }],
  ])('garbage (%s): unreadable, nothing filled', async (_l, reply) => {
    createMock.mockResolvedValue(reply)
    expect(await extractFaceSheet(PDF)).toEqual({ ok: false, reason: 'unreadable' })
  })
})

describe('errors', () => {
  const apiError = (Cls: new (...a: never[]) => Error, status: number) =>
    new (Cls as unknown as new (s: number, e: unknown, m: string, h: Headers) => Error)(status, { type: 'error' }, 'boom', new Headers())

  it.each([
    ['rate limited by Anthropic', () => apiError(Anthropic.RateLimitError, 429), 'busy'],
    ['an Anthropic server error', () => apiError(Anthropic.InternalServerError, 500), 'unavailable'],
    ['no connection', () => new Anthropic.APIConnectionError({ message: 'down' }), 'unavailable'],
    ['a bad or missing key', () => apiError(Anthropic.AuthenticationError, 401), 'not_configured'],
    ['the request was refused as invalid', () => apiError(Anthropic.BadRequestError, 400), 'unreadable'],
  ])('%s: reason %s', async (_l, make, reason) => {
    createMock.mockRejectedValue(make())
    expect(await extractFaceSheet(PDF)).toEqual({ ok: false, reason })
  })

  it('nothing from the file or the answer is ever logged', async () => {
    createMock.mockResolvedValue(toolReply(GOOD))
    await extractFaceSheet({ kind: 'text', text: 'Jane Smith 1985-04-15 Penicillin' })
    createMock.mockRejectedValue(apiError(Anthropic.InternalServerError, 500))
    await extractFaceSheet({ kind: 'text', text: 'Jane Smith 1985-04-15 Penicillin' })
    expect(logs.join(' ')).not.toMatch(/Jane|Smith|1985|Penicillin|5550142|example\.com|Austin|Levothyroxine|boom/i)
  })
})
