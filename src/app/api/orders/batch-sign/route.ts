// ============================================================
// Batch sign — POST /api/orders/batch-sign (WO-99)
// ============================================================
//
// The only route that signs an order. Body:
//   { orderIds: string[], signature: { dataUrl, strokes, padWidth } }
//
// All or nothing: every line is checked before anything is written, and
// the answer names each line that cannot be sent (see lib/orders/batch-sign).
//
// 200 { signedAt, patients: [{ patientId, orderIds, paymentGroupId, checkoutUrl }] }
// 400 bad body / signature rejected
// 403 not a provider / a line belongs to another provider
// 404 / 409 / 422 a line cannot be sent (problems[])
// 503 a check could not run — nothing signed (problems[])

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { refuseUnlessApproved } from '@/lib/onboarding/approval-guard'
import { signBatch } from '@/lib/orders/batch-sign'
import { logPhiAccess } from '@/lib/audit/phi-access'
import { getUserClinicId, getUserRole } from '@/lib/auth/claims'
import { withApiErrors } from '@/lib/api/with-api-errors'
import { z } from 'zod'
import { parseJsonBody, badRequest } from '@/lib/api/input'

// The ids and the stroke rule are checked by signBatch (parseOrderIds,
// checkSignature) with their own messages. This route bounds the size of
// what it hands over: a real pad capture is tens to hundreds of KB with a
// few hundred points, so these limits only stop a payload built to be
// expensive (the stroke check spreads every x into Math.max).
const MAX_SIGNATURE_DATA_URL = 5_000_000
const MAX_SIGNATURE_STROKES  = 1_000
const MAX_SIGNATURE_POINTS   = 100_000

const bodySchema = z.object({ orderIds: z.unknown().optional(), signature: z.unknown().optional() })

function signatureTooLarge(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false
  const { dataUrl, strokes } = raw as { dataUrl?: unknown; strokes?: unknown }
  if (typeof dataUrl === 'string' && dataUrl.length > MAX_SIGNATURE_DATA_URL) return true
  if (!Array.isArray(strokes)) return false
  if (strokes.length > MAX_SIGNATURE_STROKES) return true
  let points = 0
  for (const s of strokes) {
    if (Array.isArray(s)) points += s.length
    if (points > MAX_SIGNATURE_POINTS) return true
  }
  return false
}

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const sfSite = request.headers.get('sec-fetch-site')
  if (sfSite && sfSite !== 'same-origin' && sfSite !== 'none') {
    return NextResponse.json({ error: 'Cross-site requests are not permitted' }, { status: 403 })
  }

  const supabaseAuth = await createServerClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const clinicId = getUserClinicId(user) ?? null
  if (!clinicId) return NextResponse.json({ error: 'Session missing clinic_id' }, { status: 400 })
  // Pending review: nothing is ordered, signed or sent until ops approves
  // the clinic (lib/onboarding/approval-guard).
  const pendingReview = await refuseUnlessApproved(createServiceClient(), clinicId)
  if (pendingReview) return pendingReview
  const appRole = getUserRole(user) ?? null

  // A body that is not an object is a 400 (it used to throw on
  // body.orderIds, a 500).
  const parsed = await parseJsonBody(request, bodySchema)
  if (!parsed.ok) return parsed.response
  const body = parsed.data
  if (signatureTooLarge(body.signature)) return badRequest('Signature is too large', ['signature'])

  const result = await signBatch(createServiceClient(), {
    clinicId,
    userId:    user.id,
    appRole,
    orderIds:  body.orderIds,
    signature: body.signature,
  })

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, code: result.code, problems: result.problems },
      { status: result.status, headers: { 'Cache-Control': 'no-store' } },
    )
  }
  // Compliance C2: one row for the signature. The patient and order are
  // named when the batch has one of each; a wider batch names neither.
  const signedOrderIds = result.patients.flatMap(p => p.orderIds)
  await logPhiAccess({
    user, action: 'sign', resource: 'prescription', route: '/api/orders/batch-sign',
    patientId: result.patients.length === 1 ? result.patients[0]!.patientId : null,
    orderId:   signedOrderIds.length === 1 ? signedOrderIds[0]! : null,
    headers:   request.headers,
  })
  return NextResponse.json(
    { signedAt: result.signedAt, patients: result.patients },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  )
}

export function GET()    { return new NextResponse(null, { status: 405 }) }

export const POST = withApiErrors('/api/orders/batch-sign', postHandler)
