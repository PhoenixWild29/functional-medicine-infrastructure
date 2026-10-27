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
import { logPhiAccess, logPhiWriteNotCompleted, type PhiAccessEntry } from '@/lib/audit/phi-access'
import { withApiErrors } from '@/lib/api/with-api-errors'
import { parseInput, UUID_RE } from '@/lib/api/input'
import { z } from 'zod'

// The ids are checked as ids here, before the library reads anything (a
// bad id reaching Postgres is error 22P02, a 500). A missing or wrongly
// typed field is left to the library, which answers in its own words
// (lib/proposals/propose parseCreateProposal); the order ids are checked
// there too (parseOrderIds).
const idIfGiven = z.unknown().refine(v => typeof v !== 'string' || v === '' || UUID_RE.test(v), 'must be an id').optional()
const ProposalIds = z.looseObject({
  patientId:  idIfGiven,
  providerId: idIfGiven,
  options: z.unknown().superRefine((v, ctx) => {
    if (!Array.isArray(v)) return
    v.forEach((o, i) => {
      const protocolId = o && typeof o === 'object' ? (o as Record<string, unknown>)['protocolId'] : undefined
      if (typeof protocolId === 'string' && protocolId !== '' && !UUID_RE.test(protocolId)) {
        ctx.addIssue({ code: 'custom', message: 'must be an id', path: [i, 'protocolId'] })
      }
    })
  }).optional(),
})

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const c = await proposalCaller(request)
  if ('response' in c) return c.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const ids = parseInput(ProposalIds, body)
    if (!ids.ok) return ids.response
  }

  // L1 (B15): the create row is written BEFORE the plan is stored
  // (createProposal calls beforeWrite once its checks have passed). If it
  // cannot be written, nothing is stored (503). If storing then fails, the
  // row gets a not_completed row; a plan stored whose link then failed was
  // created, so it does not.
  let logged: PhiAccessEntry | null = null
  const res = await createProposal(c.db, {
    clinicId: c.clinicId, caller: c.caller, input: body,
    beforeWrite: async target => {
      const entry: PhiAccessEntry = {
        user: c.user, action: 'create', resource: 'order', route: '/api/proposals',
        patientId: target.patientId, clinicId: c.clinicId, headers: request.headers,
      }
      if (!(await logPhiAccess(entry))) return false
      logged = entry
      return true
    },
  })
  if (!res.ok) {
    if (logged && !res.planStored) await logPhiWriteNotCompleted(logged)
    return failureResponse(res)
  }
  return NextResponse.json(
    { proposalId: res.proposalId, status: res.status, link: res.link },
    { status: 201, headers: { 'Cache-Control': 'no-store' } },
  )
}

export const POST = withApiErrors('/api/proposals', postHandler)
