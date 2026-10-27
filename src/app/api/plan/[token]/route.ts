// ============================================================
// GET / POST /api/plan/[token]: the patient's plan link
// ============================================================
//
// Patient protocol choice PR 3. Public: middleware lets /api/plan through
// without a session; the token is the credential, checked against its
// stored SHA-256 (lib/proposals/plan). The service role reads and writes,
// scoped to the proposal's clinic.
//
//   GET                       { state, logoUrl } only: nothing about the plan
//   POST { action, dob, ... } every action re-checks the date of birth
//     verify                  200 { plan }
//     quote   { optionId, orderIds }   200 { quote }  (the total, computed here)
//     choose  { optionId, orderIds }   200 { ok, rechosen, plan }
//     decline                 200 { ok }
//
//   400 a malformed request, or a choice the rules refuse (required items,
//       one option, at least one item)
//   401 { remaining } a wrong date of birth   423 locked (5 wrong)
//   404 unknown link   409 signed, or the plan moved on   410 expired / closed
//   429 rate limited (per IP and per link)    503 database unavailable
//
// No SMS is sent here (PR 2 sends the link) and nothing is signed (PR 4).
// Logs carry ids only.

import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { clientIp } from '@/lib/audit/keyed-hash'
import { hashProposalToken } from '@/lib/proposals/token'
import { choosePlan, declinePlan, loadPlan, quotePlan, resolvePlan, verifyPlanDob, type PlanSelection } from '@/lib/proposals/plan'
import { PLAN_RATE_LIMITED_MESSAGE, planIpLimiter, planTokenLimiter } from '@/lib/proposals/plan-rate-limit'
import { notifyClinicOfChoice } from '@/lib/proposals/queue'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } })

type Params = { params: Promise<{ token: string }> }

const STATE_REPLY: Record<'not_found' | 'expired' | 'closed' | 'locked' | 'signed' | 'unavailable', { status: number; error: string }> = {
  not_found:   { status: 404, error: 'This link is not valid.' },
  expired:     { status: 410, error: 'This link has expired. Please contact your clinic.' },
  closed:      { status: 410, error: 'This plan is no longer open. Please contact your clinic.' },
  locked:      { status: 423, error: 'Too many incorrect dates of birth. This link is locked; please contact your clinic.' },
  signed:      { status: 409, error: 'Your provider has already approved your plan.' },
  unavailable: { status: 503, error: 'Please try again in a moment.' },
}

async function limited(request: NextRequest, token: string | null): Promise<NextResponse | null> {
  const ip = await planIpLimiter.check(clientIp(request.headers) ?? 'unknown')
  if (!ip.allowed) return json({ error: PLAN_RATE_LIMITED_MESSAGE }, 429, { 'Retry-After': String(ip.retryAfterSeconds) })
  if (token !== null) {
    const link = await planTokenLimiter.check(hashProposalToken(token))
    if (!link.allowed) return json({ error: PLAN_RATE_LIMITED_MESSAGE }, 429, { 'Retry-After': String(link.retryAfterSeconds) })
  }
  return null
}

export async function GET(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const { token } = await params
  const refused = await limited(request, null)
  if (refused) return refused
  const r = await resolvePlan(createServiceClient(), token, new Date())
  if (r.state === 'open') return json({ state: 'open', logoUrl: r.logoUrl })
  return json({ state: r.state }, r.state === 'unavailable' ? 503 : 200)
}

type Action =
  | { action: 'verify' | 'decline'; dob: string }
  | { action: 'quote' | 'choose'; dob: string; selection: PlanSelection }

function parse(body: unknown): Action | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  const dob = b['dob']
  if (typeof dob !== 'string' || dob.length === 0 || dob.length > 20) return null
  const action = b['action']
  if (action === 'verify' || action === 'decline') return { action, dob }
  if (action === 'quote' || action === 'choose') {
    const optionId = b['optionId']
    const orderIds = b['orderIds']
    if (typeof optionId !== 'string' || optionId.length > 64) return null
    if (!Array.isArray(orderIds) || orderIds.length > 50 || !orderIds.every(id => typeof id === 'string' && id.length <= 64)) return null
    return { action, dob, selection: { optionId, orderIds: orderIds as string[] } }
  }
  return null
}

export async function POST(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const { token } = await params
  const refused = await limited(request, token)
  if (refused) return refused

  let body: unknown
  try { body = await request.json() } catch { return json({ error: 'Invalid request' }, 400) }
  const a = parse(body)
  if (!a) return json({ error: 'Invalid request' }, 400)

  const db = createServiceClient()
  const now = new Date()
  const r = await resolvePlan(db, token, now)
  if (r.state !== 'open') {
    const reply = STATE_REPLY[r.state]
    return json({ error: reply.error, state: r.state }, reply.status)
  }
  const proposal = r.proposal

  const dob = await verifyPlanDob(db, proposal, a.dob, now)
  if (!dob.ok) {
    if (dob.reason === 'wrong') {
      return json({ error: `That date of birth doesn't match. ${dob.remaining} ${dob.remaining === 1 ? 'try' : 'tries'} left.`, remaining: dob.remaining }, 401)
    }
    const reply = STATE_REPLY[dob.reason]
    return json({ error: reply.error, state: dob.reason }, reply.status)
  }

  switch (a.action) {
    case 'verify': {
      const plan = await loadPlan(db, proposal)
      return plan ? json({ plan }) : json({ error: STATE_REPLY.unavailable.error }, 503)
    }
    case 'quote': {
      const q = await quotePlan(db, proposal, a.selection)
      return q.ok ? json({ quote: q.quote }) : json({ error: q.error, code: q.code }, q.status)
    }
    case 'choose': {
      const c = await choosePlan(db, proposal, a.selection, now)
      if (!c.ok) return json({ error: c.error, code: c.code }, c.status)
      console.info(`[plan] ${c.rechosen ? 'rechosen' : 'chosen'} | proposal=${proposal.proposal_id}`)
      // PR 4: the clinic's in-app notification ("Plans ready to sign"). Idempotent per choice; never throws.
      await notifyClinicOfChoice(db, { proposalId: proposal.proposal_id })
      const plan = await loadPlan(db, { ...proposal, status: 'chosen', chosen_option_id: a.selection.optionId })
      return json({ ok: true, rechosen: c.rechosen, plan })
    }
    case 'decline': {
      const d = await declinePlan(db, proposal, now)
      if (!d.ok) return json({ error: d.error, code: d.code }, d.status)
      console.info(`[plan] declined | proposal=${proposal.proposal_id}`)
      return json({ ok: true })
    }
  }
}
