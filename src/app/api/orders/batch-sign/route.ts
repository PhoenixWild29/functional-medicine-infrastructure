// ============================================================
// Batch sign — POST /api/orders/batch-sign (WO-99)
// ============================================================
//
// The only route that signs an order. Body:
//   { orderIds: string[], signature: { dataUrl, strokes, padWidth }, totpCode?: string }
//
// All or nothing: every line is checked before anything is written, and
// the answer names each line that cannot be sent (see lib/orders/batch-sign).
//
// 200 { signedAt, patients: [{ patientId, orderIds, paymentGroupId, checkoutUrl }] }
// 400 bad body / signature rejected
// 401 TOTP_REQUIRED | TOTP_INVALID | TOTP_NOT_ENROLLED (with the controlled lines)
// 403 not a provider / a line belongs to another provider
// 404 / 409 / 422 a line cannot be sent (problems[])
// 503 a check could not run — nothing signed (problems[])

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { signBatch } from '@/lib/orders/batch-sign'

export async function POST(request: NextRequest): Promise<NextResponse> {
  const sfSite = request.headers.get('sec-fetch-site')
  if (sfSite && sfSite !== 'same-origin' && sfSite !== 'none') {
    return NextResponse.json({ error: 'Cross-site requests are not permitted' }, { status: 403 })
  }

  const supabaseAuth = await createServerClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const clinicId = typeof user.user_metadata['clinic_id'] === 'string' ? user.user_metadata['clinic_id'] as string : null
  if (!clinicId) return NextResponse.json({ error: 'Session missing clinic_id' }, { status: 400 })
  const appRole = typeof user.user_metadata['app_role'] === 'string' ? user.user_metadata['app_role'] as string : null

  let body: { orderIds?: unknown; signature?: unknown; totpCode?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const result = await signBatch(createServiceClient(), {
    clinicId,
    userId:    user.id,
    appRole,
    orderIds:  body.orderIds,
    signature: body.signature,
    totpCode:  body.totpCode,
    requestMeta: {
      ip:        request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? null,
      userAgent: request.headers.get('user-agent'),
    },
  })

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, code: result.code, problems: result.problems, controlled: result.controlled },
      { status: result.status, headers: { 'Cache-Control': 'no-store' } },
    )
  }
  return NextResponse.json(
    { signedAt: result.signedAt, patients: result.patients },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  )
}

export function GET()    { return new NextResponse(null, { status: 405 }) }
