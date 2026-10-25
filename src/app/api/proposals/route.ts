// ============================================================
// POST /api/proposals: send a plan to the patient for choice
// ============================================================
//
// Patient protocol choice, PR 2 (docs/design/patient-protocol-choice.md).
// Body: { patientId, providerId, send, options: [{ label, protocolId,
// lines: [{ orderId, required }] }] }. The lines are DRAFTs Review just
// saved. send=false prepares the plan (a medical assistant's only choice);
// send=true also makes the plan link.
//
// 201 { proposalId, status, link: { url, expiresAt, texting } | null }.
// The link is shown once: only its hash is stored. A refusal is sign's,
// with its problems (lib/proposals/propose).

import { NextResponse, type NextRequest } from 'next/server'
import { createProposal } from '@/lib/proposals/propose'
import { failureResponse, proposalCaller } from '@/lib/proposals/request'
import { logPhiAccess } from '@/lib/audit/phi-access'

export async function POST(request: NextRequest): Promise<NextResponse> {
  const c = await proposalCaller(request)
  if ('response' in c) return c.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const res = await createProposal(c.db, { clinicId: c.clinicId, caller: c.caller, input: body })
  if (!res.ok) return failureResponse(res)

  const patientId = (body as { patientId?: string }).patientId ?? null
  await logPhiAccess({
    user: c.user, action: 'create', resource: 'order', route: '/api/proposals',
    patientId, clinicId: c.clinicId, headers: request.headers,
  })
  return NextResponse.json(
    { proposalId: res.proposalId, status: res.status, link: res.link },
    { status: 201, headers: { 'Cache-Control': 'no-store' } },
  )
}
