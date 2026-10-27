// ============================================================
// POST /api/proposals/[proposalId]/cancel
// ============================================================
//
// Patient protocol choice, PR 2. The plan is cancelled and its link
// stops working; its lines go DRAFT -> CANCELLED (never signed).
// 200 { cancelledOrderIds }.

import { NextResponse, type NextRequest } from 'next/server'
import { cancelProposal } from '@/lib/proposals/propose'
import { failureResponse, proposalCaller, proposalIdFrom, refuseUnlessProposalWriteLogged } from '@/lib/proposals/request'
import { withApiErrors } from '@/lib/api/with-api-errors'

type Context = { params: Promise<{ proposalId: string }> }

async function postHandler(request: NextRequest, context: Context): Promise<NextResponse> {
  const c = await proposalCaller(request)
  if ('response' in c) return c.response
  const proposalId = await proposalIdFrom(context)
  if (!proposalId) return NextResponse.json({ error: 'Invalid plan id' }, { status: 400 })
  // B15: logged before the write; fail-closed.
  const notLogged = await refuseUnlessProposalWriteLogged(c, request, proposalId, '/api/proposals/[proposalId]/cancel')
  if (notLogged) return notLogged

  const res = await cancelProposal(c.db, { clinicId: c.clinicId, caller: c.caller, proposalId })
  if (!res.ok) return failureResponse(res)
  return NextResponse.json({ cancelledOrderIds: res.cancelledOrderIds }, { status: 200 })
}

export const POST = withApiErrors('/api/proposals/[proposalId]/cancel', postHandler)
