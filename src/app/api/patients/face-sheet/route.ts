// ============================================================
// POST /api/patients/face-sheet: "Drop a face sheet" (Patient Intake PR 4)
// ============================================================
//
// Staff drop a face sheet (multipart field "file": a PDF, PNG or JPG up to
// 4 MB, checked by its first bytes) or paste its text (JSON { text }).
// Claude reads it (lib/face-sheet/extract) and the answer prefills the
// new-patient form. Nothing is saved here: staff review and edit every
// value, then save through POST /api/patients as usual (duplicate check,
// intake status and link unchanged).
//
//   200  { fields, filled }   filled: the fields that came from the sheet
//   400  pasted text empty, too long or not text
//   401 / 403                 signed out / not clinic staff / clinic under review
//   404  FACE_SHEET_OFF       FACE_SHEET_AI_ENABLED is "false"
//   413  over 4 MB            415  not a PDF, PNG or JPG
//   422  nothing readable     429  20 an hour per user (Retry-After)
//   503  not set up (no ANTHROPIC_API_KEY), busy, or unavailable
//
// Privacy: the file stays in memory for this request only. It is never
// written to disk or to storage, and never logged; neither are the values
// read from it. One phi_access_log row per read sent to Claude (resource
// face_sheet_fill, no patient yet, no values).
//
// getUser(), never getSession(); role and clinic from app_metadata.

import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getUserClinicId, getUserRole } from '@/lib/auth/claims'
import { refuseUnlessApproved } from '@/lib/onboarding/approval-guard'
import { logPhiAccess } from '@/lib/audit/phi-access'
import { extractFaceSheet, type FaceSheetInput, type FaceSheetMediaType, type FaceSheetResult } from '@/lib/face-sheet/extract'
import { FACE_SHEET_NOT_SET_UP, MAX_FACE_SHEET_BYTES, faceSheetStatus } from '@/lib/face-sheet/config'
import { FACE_SHEET_RATE_LIMITED_MESSAGE, faceSheetLimiter } from '@/lib/face-sheet/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Reading a multi-page PDF can take a while.
export const maxDuration = 60

const STAFF_ROLES = new Set(['provider', 'medical_assistant', 'clinic_admin'])
const MAX_TEXT = 50_000
const NO_STORE = { 'Cache-Control': 'no-store' }

const MESSAGES: Record<Exclude<FaceSheetResult, { ok: true }>['reason'], { status: number; error: string; code?: string }> = {
  unreadable: { status: 422, error: 'Nothing could be read from this face sheet. Enter the details by hand.' },
  busy: { status: 503, error: 'Face sheet fill is busy. Try again in a minute, or enter the details by hand.' },
  unavailable: { status: 503, error: 'Face sheet fill is not available right now. Enter the details by hand.' },
  not_configured: { status: 503, error: FACE_SHEET_NOT_SET_UP, code: 'FACE_SHEET_NOT_CONFIGURED' },
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } })

/** What the file is, from its first bytes (never the name or declared type). */
function sniff(bytes: Uint8Array): FaceSheetMediaType | null {
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) return 'application/pdf'
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  return null
}

const TOO_BIG = 'That file is over 4 MB. Choose a smaller file, or paste the text instead.'
const WRONG_TYPE = 'Choose a PDF, PNG or JPG file.'

async function readInput(request: NextRequest): Promise<FaceSheetInput | NextResponse> {
  const contentType = request.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    let body: unknown
    try { body = await request.json() } catch { return json({ error: 'Paste the face sheet text.', field: 'text' }, 400) }
    const raw = (body as { text?: unknown } | null)?.text
    const text = typeof raw === 'string' ? raw.trim() : ''
    if (!text || text.length > MAX_TEXT) {
      return json({ error: text ? 'That text is too long. Paste only the face sheet.' : 'Paste the face sheet text.', field: 'text' }, 400)
    }
    return { kind: 'text', text }
  }

  // Refuse an oversize upload before reading it (allowing for the form framing).
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (declared > MAX_FACE_SHEET_BYTES + 64 * 1024) return json({ error: TOO_BIG }, 413)
  let form: FormData
  try { form = await request.formData() } catch { return json({ error: WRONG_TYPE }, 415) }
  const file = form.get('file')
  if (!file || typeof file === 'string') return json({ error: WRONG_TYPE }, 415)
  if (file.size > MAX_FACE_SHEET_BYTES) return json({ error: TOO_BIG }, 413)
  const bytes = new Uint8Array(await file.arrayBuffer())
  const mediaType = sniff(bytes)
  if (!mediaType) return json({ error: WRONG_TYPE }, 415)
  return { kind: 'file', mediaType, data: Buffer.from(bytes) }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const sfSite = request.headers.get('sec-fetch-site')
  if (sfSite && sfSite !== 'same-origin' && sfSite !== 'none') return json({ error: 'Cross-site requests are not permitted' }, 403)

  const supabaseAuth = await createServerClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return json({ error: 'Unauthorized' }, 401)
  if (!STAFF_ROLES.has(getUserRole(user) ?? '')) return json({ error: 'Forbidden' }, 403)
  const clinicId = getUserClinicId(user)
  if (!clinicId) return json({ error: 'Session missing clinic_id' }, 400)

  const status = faceSheetStatus()
  if (status === 'off') return json({ error: 'Not found', code: 'FACE_SHEET_OFF' }, 404)
  if (status === 'not_configured') return json({ error: FACE_SHEET_NOT_SET_UP, code: 'FACE_SHEET_NOT_CONFIGURED' }, 503)

  // A clinic under review adds no patients (lib/onboarding/approval-guard).
  const pendingReview = await refuseUnlessApproved(createServiceClient(), clinicId)
  if (pendingReview) return pendingReview

  const limit = faceSheetLimiter.check(user.id)
  if (!limit.allowed) {
    return json({ error: FACE_SHEET_RATE_LIMITED_MESSAGE }, 429, { 'Retry-After': String(limit.retryAfterSeconds) })
  }

  const input = await readInput(request)
  if (input instanceof NextResponse) return input

  let result: FaceSheetResult
  try {
    result = await extractFaceSheet(input)
  } catch {
    // Never log the error itself: it could carry what was read.
    console.error('[face-sheet] read failed unexpectedly')
    result = { ok: false, reason: 'unavailable' }
  }

  // Compliance C2: the sheet was sent to be read, whatever came back.
  await logPhiAccess({ user, action: 'view', resource: 'face_sheet_fill', route: '/api/patients/face-sheet', clinicId, headers: request.headers })

  if (!result.ok) {
    const m = MESSAGES[result.reason]
    return json({ error: m.error, ...(m.code ? { code: m.code } : {}) }, m.status)
  }
  return json({ fields: result.fields, filled: result.filled })
}
