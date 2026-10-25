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
import { refuseCrossSite } from '@/lib/security/same-origin'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { refuseUnlessApproved } from '@/lib/onboarding/approval-guard'
import { checkBatch, parseOrderIds } from '@/lib/orders/batch-sign'
import { logPhiAccess } from '@/lib/audit/phi-access'
import { getUserClinicId, getUserRole } from '@/lib/auth/claims'
import { resolveSigner } from '@/lib/auth/signer'
import { withApiErrors } from '@/lib/api/with-api-errors'
import { z } from 'zod'
import { parseJsonBody } from '@/lib/api/input'

const COULD_NOT_RUN = new Set(['orders_unavailable', 'provider_unavailable', 'compliance_unavailable'])

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const crossSite = refuseCrossSite(request)
  if (crossSite) return crossSite
  const supabaseAuth = await createServerClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const clinicId = getUserClinicId(user) ?? null
  if (!clinicId) return NextResponse.json({ error: 'Session missing clinic_id' }, { status: 400 })
  // Pending review: nothing is ordered, signed or sent until ops approves
  // the clinic (lib/onboarding/approval-guard).
  const pendingReview = await refuseUnlessApproved(createServiceClient(), clinicId)
  if (pendingReview) return pendingReview
  // The same answer as signing (lib/auth/signer): a provider, or a solo
  // admin who is also a verified provider.
  const supabase = createServiceClient()
  const who = await resolveSigner(supabase, { userId: user.id, clinicId, role: getUserRole(user) ?? null })
  if (!who.ok) return NextResponse.json({ error: who.message }, { status: who.status })

  // A body that is not an object is a 400 (it used to throw on
  // body.orderIds, a 500). The ids: parseOrderIds, with its own messages.
  const body = await parseJsonBody(request, z.object({ orderIds: z.unknown().optional() }))
  if (!body.ok) return body.response
  const parsed = parseOrderIds(body.data.orderIds)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const check = await checkBatch(supabase, { clinicId, userId: user.id, orderIds: parsed.ids, atSigning: false })
  const couldNotRun = check.problems.find(p => COULD_NOT_RUN.has(p.code))
  if (couldNotRun) {
    console.error(`[batch-sign/check] could not run: ${couldNotRun.code}`)
    return NextResponse.json({ error: couldNotRun.message, problems: check.problems }, { status: 503 })
  }
  // Compliance C2: the lines (and their patients' allergy status) were read.
  const patientIds = [...new Set(check.lines.map(l => l.patientId))]
  await logPhiAccess({
    user, action: 'view', resource: 'prescription', route: '/api/orders/batch-sign/check',
    patientId: patientIds.length === 1 ? patientIds[0]! : null,
    orderId:   check.lines.length === 1 ? check.lines[0]!.orderId : null,
    headers:   request.headers,
  })
  return NextResponse.json(
    { lines: check.lines, problems: check.problems },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  )
}

export const POST = withApiErrors('/api/orders/batch-sign/check', postHandler)
