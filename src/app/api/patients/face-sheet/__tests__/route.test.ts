/**
 * @jest-environment node
 *
 * Patient Intake PR 4: POST /api/patients/face-sheet, "Drop a face sheet".
 *
 *   - Clinic staff only (provider, medical assistant, clinic admin): getUser()
 *     and the app_metadata role. 20 reads an hour per user.
 *   - A PDF, PNG or JPG up to 10 MB (multipart field "file"), checked by its
 *     first bytes, or pasted text (JSON { text }).
 *   - FACE_SHEET_AI_ENABLED (on unless "false"); no ANTHROPIC_API_KEY means
 *     "Face sheet fill is not set up" and manual entry stays.
 *   - The answer is { fields, filled }; nothing is saved here (the
 *     new-patient form saves, after staff review).
 *   - Privacy: the file is never stored (no disk, no storage bucket); no
 *     file contents or values in the logs; exactly one phi_access_log row,
 *     resource face_sheet_fill, with no field values.
 */

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { NextRequest } from 'next/server'
import { phiLog, phiEntries, expectOnePhiRow } from '@/__tests__/helpers/phi-log'

const CLINIC_ID = 'aaaaaaaa-aaaa-4aaa-9aaa-aaaaaaaaaaaa'

const getUserMock = jest.fn()
jest.mock('@/lib/supabase/server', () => ({ createServerClient: jest.fn(async () => ({ auth: { getUser: () => getUserMock() } })) }))
const storageMock = jest.fn()
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ storage: { from: storageMock } }) }))
const approvalMock = jest.fn()
jest.mock('@/lib/onboarding/approval-guard', () => ({
  ...jest.requireActual('@/lib/onboarding/approval-guard'),
  refuseUnlessApproved: (...a: unknown[]) => approvalMock(...a),
}))
const extractMock = jest.fn()
jest.mock('@/lib/face-sheet/extract', () => ({
  ...jest.requireActual('@/lib/face-sheet/extract'),
  extractFaceSheet: (...a: unknown[]) => extractMock(...a),
}))

import { POST } from '../route'
import { faceSheetLimiter } from '@/lib/face-sheet/rate-limit'

const FIELDS = {
  firstName: 'Jane', lastName: 'Smith', dateOfBirth: '1985-04-15', sex: 'female', mobile: '+15125550142', email: 'jane@example.com',
  addressLine1: '123 Main St', addressLine2: null, city: 'Austin', state: 'TX', zip: '78701',
  allergies: ['Penicillin'], nkda: false, currentMedications: 'Levothyroxine',
}
const PDF_BYTES = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('Jane Smith 1985-04-15 Penicillin')])
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const JPG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])

function signedIn(role: string, id = 'user-1') {
  getUserMock.mockResolvedValue({ data: { user: { id, email: `${role}@clinic.test`, app_metadata: { app_role: role, clinic_id: CLINIC_ID } } }, error: null })
}
function fileReq(bytes: Buffer, name = 'face-sheet.pdf', type = 'application/pdf', headers: Record<string, string> = {}) {
  const form = new FormData()
  form.append('file', new File([new Uint8Array(bytes)], name, { type }))
  return new NextRequest(new URL('https://app.test/api/patients/face-sheet'), { method: 'POST', body: form, headers })
}
function textReq(body: unknown) {
  return new NextRequest(new URL('https://app.test/api/patients/face-sheet'), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
}

let logs: string[] = []
beforeEach(() => {
  faceSheetLimiter.reset()
  process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test'
  delete process.env['FACE_SHEET_AI_ENABLED']
  signedIn('medical_assistant')
  approvalMock.mockReset().mockResolvedValue(null)
  extractMock.mockReset().mockResolvedValue({ ok: true, fields: FIELDS, filled: Object.keys(FIELDS).filter(k => FIELDS[k as keyof typeof FIELDS] !== null && k !== 'nkda') })
  storageMock.mockReset()
  phiLog.mockClear()
  logs = []
  for (const level of ['error', 'warn', 'info', 'log'] as const) {
    jest.spyOn(console, level).mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(' ')) })
  }
})
afterEach(() => jest.restoreAllMocks())

describe('who may', () => {
  it('signed out: 401, nothing read', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
    expect((await POST(fileReq(PDF_BYTES))).status).toBe(401)
    expect(extractMock).not.toHaveBeenCalled()
  })

  it.each(['ops_admin', 'pharmacy_admin', 'patient', undefined])('%s: 403, nothing read', async role => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u', app_metadata: role ? { app_role: role, clinic_id: CLINIC_ID } : {}, user_metadata: { app_role: 'clinic_admin' } } }, error: null })
    expect((await POST(fileReq(PDF_BYTES))).status).toBe(403)
    expect(extractMock).not.toHaveBeenCalled()
  })

  it.each(['provider', 'medical_assistant', 'clinic_admin'])('%s: allowed', async role => {
    signedIn(role)
    expect((await POST(fileReq(PDF_BYTES))).status).toBe(200)
  })

  it('a cross-site request: 403', async () => {
    expect((await POST(fileReq(PDF_BYTES, 'a.pdf', 'application/pdf', { 'sec-fetch-site': 'cross-site' }))).status).toBe(403)
    expect(extractMock).not.toHaveBeenCalled()
  })

  it('a clinic under review: refused like every other patient write', async () => {
    const { NextResponse } = await import('next/server')
    approvalMock.mockResolvedValue(NextResponse.json({ error: 'pending', code: 'CLINIC_PENDING_REVIEW' }, { status: 403 }))
    const res = await POST(fileReq(PDF_BYTES))
    expect(res.status).toBe(403)
    expect(extractMock).not.toHaveBeenCalled()
  })
})

describe('rate limit', () => {
  it('20 an hour per user: the 21st is 429 with Retry-After; another user is not affected', async () => {
    for (let i = 0; i < 20; i++) expect((await POST(fileReq(PDF_BYTES))).status).toBe(200)
    extractMock.mockClear()
    const res = await POST(fileReq(PDF_BYTES))
    expect(res.status).toBe(429)
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0)
    expect(extractMock).not.toHaveBeenCalled()
    signedIn('medical_assistant', 'user-2')
    expect((await POST(fileReq(PDF_BYTES))).status).toBe(200)
  })
})

describe('the file', () => {
  it('a PDF: read inline, the answer is the fields and which came from the sheet', async () => {
    const res = await POST(fileReq(PDF_BYTES))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = await res.json()
    expect(body).toEqual({ fields: FIELDS, filled: expect.arrayContaining(['firstName', 'mobile', 'allergies']) })
    const input = extractMock.mock.calls[0]![0] as { kind: string; mediaType: string; data: Buffer }
    expect(input).toEqual({ kind: 'file', mediaType: 'application/pdf', data: expect.any(Buffer) })
    expect(Buffer.compare(input.data, PDF_BYTES)).toBe(0)
  })

  it.each([[PNG_BYTES, 'sheet.png', 'image/png', 'image/png'], [JPG_BYTES, 'sheet.jpg', 'image/jpeg', 'image/jpeg']])('%#: an image (%s) by its first bytes', async (bytes, name, type, mediaType) => {
    expect((await POST(fileReq(bytes, name, type))).status).toBe(200)
    expect(extractMock.mock.calls[0]![0]).toEqual(expect.objectContaining({ kind: 'file', mediaType }))
  })

  it('over 10 MB: 413 with the limit, nothing read', async () => {
    const big = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(10 * 1024 * 1024)])
    const res = await POST(fileReq(big))
    expect(res.status).toBe(413)
    expect((await res.json()).error).toBe('That file is over 10 MB. Choose a smaller file, or paste the text instead.')
    expect(extractMock).not.toHaveBeenCalled()
  })

  it.each([
    ['a Word file named .pdf', Buffer.from('PK\x03\x04 not a pdf'), 'sheet.pdf', 'application/pdf'],
    ['a GIF', Buffer.from('GIF89a....'), 'sheet.gif', 'image/gif'],
    ['an empty file', Buffer.alloc(0), 'sheet.pdf', 'application/pdf'],
  ])('%s: 415, nothing read', async (_l, bytes, name, type) => {
    const res = await POST(fileReq(bytes, name, type))
    expect(res.status).toBe(415)
    expect((await res.json()).error).toBe('Choose a PDF, PNG or JPG file.')
    expect(extractMock).not.toHaveBeenCalled()
  })

  it('pasted text: read as text', async () => {
    expect((await POST(textReq({ text: '  Jane Smith, DOB 04/15/1985  ' }))).status).toBe(200)
    expect(extractMock.mock.calls[0]![0]).toEqual({ kind: 'text', text: 'Jane Smith, DOB 04/15/1985' })
  })

  it.each([[{ text: '' }], [{ text: 'x'.repeat(50_001) }], [{}], [{ text: 42 }]])('pasted text that is empty, too long or not text: 400 (%#)', async body => {
    expect((await POST(textReq(body))).status).toBe(400)
    expect(extractMock).not.toHaveBeenCalled()
  })
})

describe('the answer', () => {
  it('partial: passed on as it came (empty fields stay empty)', async () => {
    extractMock.mockResolvedValue({ ok: true, fields: { ...FIELDS, email: null, zip: null }, filled: ['firstName', 'lastName'] })
    const body = await (await POST(fileReq(PDF_BYTES))).json()
    expect(body).toEqual({ fields: expect.objectContaining({ email: null, zip: null }), filled: ['firstName', 'lastName'] })
  })

  it.each([
    ['unreadable', 422, 'Nothing could be read from this face sheet. Enter the details by hand.'],
    ['busy', 503, 'Face sheet fill is busy. Try again in a minute, or enter the details by hand.'],
    ['unavailable', 503, 'Face sheet fill is not available right now. Enter the details by hand.'],
    ['not_configured', 503, 'Face sheet fill is not set up.'],
  ])('%s: %i with a plain message', async (reason, status, error) => {
    extractMock.mockResolvedValue({ ok: false, reason })
    const res = await POST(fileReq(PDF_BYTES))
    expect(res.status).toBe(status)
    expect(await res.json()).toEqual(expect.objectContaining({ error }))
  })
})

describe('flag and key', () => {
  it('FACE_SHEET_AI_ENABLED=false: 404, nothing read', async () => {
    process.env['FACE_SHEET_AI_ENABLED'] = 'false'
    const res = await POST(fileReq(PDF_BYTES))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual(expect.objectContaining({ code: 'FACE_SHEET_OFF' }))
    expect(extractMock).not.toHaveBeenCalled()
  })

  it('no ANTHROPIC_API_KEY: 503 "Face sheet fill is not set up", nothing read', async () => {
    delete process.env['ANTHROPIC_API_KEY']
    const res = await POST(fileReq(PDF_BYTES))
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'Face sheet fill is not set up.', code: 'FACE_SHEET_NOT_CONFIGURED' })
    expect(extractMock).not.toHaveBeenCalled()
  })
})

describe('privacy', () => {
  it('one phi_access_log row: view, face_sheet_fill, the clinic, no patient, no field values', async () => {
    await POST(fileReq(PDF_BYTES))
    expectOnePhiRow({ action: 'view', resource: 'face_sheet_fill', route: '/api/patients/face-sheet', clinicId: CLINIC_ID })
    const entry = phiEntries()[0]!
    expect(entry.patientId ?? null).toBeNull()
    expect(JSON.stringify({ ...entry, user: null, headers: null })).not.toMatch(/Jane|Smith|1985|Penicillin|5550142|example\.com|Austin/)
  })

  it('a read that failed still logs its one row (the sheet was sent); a refused request logs none', async () => {
    extractMock.mockResolvedValue({ ok: false, reason: 'unreadable' })
    await POST(fileReq(PDF_BYTES))
    expect(phiEntries()).toHaveLength(1)
    phiLog.mockClear()
    await POST(fileReq(Buffer.from('GIF89a'), 'a.gif', 'image/gif'))
    expect(phiEntries()).toHaveLength(0)
  })

  it('the file is never stored: nothing written to disk or to a storage bucket', async () => {
    const spies = [
      jest.spyOn(fs, 'writeFileSync'), jest.spyOn(fs, 'writeFile'), jest.spyOn(fs, 'createWriteStream'),
      jest.spyOn(fsp, 'writeFile'), jest.spyOn(fsp, 'mkdtemp'),
    ]
    await POST(fileReq(PDF_BYTES))
    await POST(textReq({ text: 'Jane Smith' }))
    for (const s of spies) expect(s).not.toHaveBeenCalled()
    expect(storageMock).not.toHaveBeenCalled()
  })

  it('no file contents or values in the logs, whatever happens', async () => {
    await POST(fileReq(PDF_BYTES))
    extractMock.mockResolvedValue({ ok: false, reason: 'unavailable' })
    await POST(textReq({ text: 'Jane Smith 1985-04-15 Penicillin' }))
    extractMock.mockRejectedValue(new Error('Jane Smith 1985'))
    const res = await POST(fileReq(PDF_BYTES))
    expect(res.status).toBe(503)
    expect(logs.join(' ')).not.toMatch(/Jane|Smith|1985|Penicillin|5550142|example\.com|Austin|Levothyroxine/)
  })
})
