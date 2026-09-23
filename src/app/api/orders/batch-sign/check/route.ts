// ============================================================
// Batch sign — POST /api/orders/batch-sign/check (WO-99)
// ============================================================
//
// The per-line checks the batch sign page shows before the provider signs:
// which lines cannot be sent, and why (another provider's draft, a price
// that moved or is below cost, missing Rx details, a schedule that must
// go by fax…). Read only. The same function runs again, with the patient
// checks, when the batch is signed.
//
// 200 { lines, problems } whenever the check ran — problems are answers.
// 503 when it could not run at all.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { checkBatch, parseOrderIds } from '@/lib/orders/batch-sign'

const COULD_NOT_RUN = new Set(['orders_unavailable', 'provider_unavailable', 'compliance_unavailable'])

export async function POST(request: NextRequest): Promise<NextResponse> {
  const supabaseAuth = await createServerClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const clinicId = typeof user.user_metadata['clinic_id'] === 'string' ? user.user_metadata['clinic_id'] as string : null
  if (!clinicId) return NextResponse.json({ error: 'Session missing clinic_id' }, { status: 400 })
  if (user.user_metadata['app_role'] !== 'provider') {
    return NextResponse.json({ error: 'Only a provider can sign prescriptions.' }, { status: 403 })
  }

  let body: { orderIds?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = parseOrderIds(body.orderIds)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const check = await checkBatch(createServiceClient(), { clinicId, userId: user.id, orderIds: parsed.ids, atSigning: false })
  const couldNotRun = check.problems.find(p => COULD_NOT_RUN.has(p.code))
  if (couldNotRun) {
    console.error(`[batch-sign/check] could not run: ${couldNotRun.code}`)
    return NextResponse.json({ error: couldNotRun.message, problems: check.problems }, { status: 503 })
  }
  return NextResponse.json(
    { lines: check.lines, problems: check.problems },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  )
}
