// ============================================================
// POST /api/proposals/[proposalId]/events: how the link reached the patient
// ============================================================
//
// Patient protocol choice, PR 2. Body { delivery: 'copied' | 'qr' }:
// recorded as link_copied or qr_shown (the text is recorded where it is
// sent). No PHI is stored with an event.

import { NextResponse, type NextRequest } from 'next/server'
import { recordLinkDelivery } from '@/lib/proposals/propose'
import { failureResponse, proposalCaller, proposalIdFrom } from '@/lib/proposals/request'
import { withApiErrors } from '@/lib/api/with-api-errors'

type Context = { params: Promise<{ proposalId: string }> }

async function postHandler(request: NextRequest, context: Context): Promise<NextResponse> {
  const c = await proposalCaller(request)
  if ('response' in c) return c.response
  const proposalId = await proposalIdFrom(context)
  if (!proposalId) return NextResponse.json({ error: 'Invalid plan id' }, { status: 400 })

  let delivery: unknown
  try {
    delivery = ((await request.json()) as { delivery?: unknown }).delivery
  } catch {
    delivery = null
  }
  if (delivery !== 'copied' && delivery !== 'qr') return NextResponse.json({ error: "delivery must be 'copied' or 'qr'" }, { status: 400 })

  const res = await recordLinkDelivery(c.db, { clinicId: c.clinicId, caller: c.caller, proposalId, delivery })
  if (!res.ok) return failureResponse(res)
  return NextResponse.json({ ok: true }, { status: 200 })
}

export const POST = withApiErrors('/api/proposals/[proposalId]/events', postHandler)
