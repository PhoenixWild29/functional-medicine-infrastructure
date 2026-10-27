// ============================================================
// POST /api/proposals/[proposalId]/send: send a prepared plan, or a new link
// ============================================================
//
// Patient protocol choice, PR 2. Every signing check runs again (canSign);
// a new token replaces the old one, so the previous link stops working.
// 200 { proposalId, resent, link: { url, expiresAt, texting } }.

import { NextResponse, type NextRequest } from 'next/server'
import { sendProposal } from '@/lib/proposals/propose'
import { failureResponse, proposalCaller, proposalIdFrom, refuseUnlessProposalWriteLogged } from '@/lib/proposals/request'
import { withApiErrors } from '@/lib/api/with-api-errors'

type Context = { params: Promise<{ proposalId: string }> }

async function postHandler(request: NextRequest, context: Context): Promise<NextResponse> {
  const c = await proposalCaller(request)
  if ('response' in c) return c.response
  const proposalId = await proposalIdFrom(context)
  if (!proposalId) return NextResponse.json({ error: 'Invalid plan id' }, { status: 400 })
  // B15: logged before the write; fail-closed.
  const notLogged = await refuseUnlessProposalWriteLogged(c, request, proposalId, '/api/proposals/[proposalId]/send')
  if (notLogged) return notLogged

  const res = await sendProposal(c.db, { clinicId: c.clinicId, caller: c.caller, proposalId })
  if (!res.ok) return failureResponse(res)
  return NextResponse.json(
    { proposalId: res.proposalId, resent: res.resent, link: res.link },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  )
}

export const POST = withApiErrors('/api/proposals/[proposalId]/send', postHandler)
