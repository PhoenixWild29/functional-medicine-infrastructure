// ============================================================
// POST /api/proposals/[proposalId]/sign: sign what the patient chose
// ============================================================
//
// Patient protocol choice, PR 4. Body { signature }. The chosen lines are
// worked out on the server (lib/proposals/chosen) and signed through the
// existing batch sign; the rest of the plan is cancelled
// (lib/proposals/sign-choice). Who may sign is batch sign's own rule. A
// refusal is batch sign's, with its problems; the plan stays chosen.
// 200 { signedOrderIds, cancelledOrderIds }.

import { NextResponse, type NextRequest } from 'next/server'
import { signChosenProposal } from '@/lib/proposals/sign-choice'
import { proposalCaller, proposalIdFrom } from '@/lib/proposals/request'
import { logPhiAccess } from '@/lib/audit/phi-access'
import { withApiErrors } from '@/lib/api/with-api-errors'

type Context = { params: Promise<{ proposalId: string }> }

async function postHandler(request: NextRequest, context: Context): Promise<NextResponse> {
  const c = await proposalCaller(request)
  if ('response' in c) return c.response
  const proposalId = await proposalIdFrom(context)
  if (!proposalId) return NextResponse.json({ error: 'Invalid plan id' }, { status: 400 })

  let signature: unknown
  try {
    signature = ((await request.json()) as { signature?: unknown }).signature
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const res = await signChosenProposal(c.db, {
    clinicId: c.clinicId, userId: c.caller.userId, appRole: c.caller.role, proposalId, signature,
  })
  if (!res.ok) {
    return NextResponse.json(
      { error: res.error, ...(res.code ? { code: res.code } : {}), ...(res.problems ? { problems: res.problems } : {}) },
      { status: res.status },
    )
  }
  await logPhiAccess({
    user: c.user, action: 'sign', resource: 'prescription', route: '/api/proposals/[proposalId]/sign',
    orderId: res.signedOrderIds.length === 1 ? res.signedOrderIds[0]! : null, clinicId: c.clinicId, headers: request.headers,
  })
  return NextResponse.json({ signedOrderIds: res.signedOrderIds, cancelledOrderIds: res.cancelledOrderIds }, { status: 200 })
}

export const POST = withApiErrors('/api/proposals/[proposalId]/sign', postHandler)
