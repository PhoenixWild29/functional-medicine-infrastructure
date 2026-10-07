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
import { signBatch } from '@/lib/orders/batch-sign'
import { logPhiAccess } from '@/lib/audit/phi-access'

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

  let body: { orderIds?: unknown; signature?: unknown }
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
