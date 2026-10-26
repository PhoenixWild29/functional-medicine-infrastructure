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
//   401 { remaining } a wrong date of birth   423 this request's wrong date
//       was the 5th (the link is now locked)
//   410 { state: 'closed' } an unknown, expired, closed, locked or signed
//       link: one answer, word for word, so a request never learns
//       whether a link existed (GET: 200 { state: 'closed' })
//   409 the plan moved on    429 rate limited (per IP and per link)
//   503 database unavailable
//
// No SMS is sent here (PR 2 sends the link) and nothing is signed (PR 4).
// Logs carry ids only.
//
// PHI access log (C-2026-10-25-17, B14/B15), the patient on the link as the
// actor: verify (the plan shown after the date of birth check) is one view
// row; choose and decline are writes on a known proposal, logged BEFORE
// the write and refused 503 (nothing changed) when the row cannot be
// written. A wrong date of birth is not access (its dob_failed event stays).

import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { clientIp } from '@/lib/audit/keyed-hash'
import { hashProposalToken } from '@/lib/proposals/token'
import { choosePlan, declinePlan, loadPlan, quotePlan, resolvePlan, verifyPlanDob, type PlanSelection } from '@/lib/proposals/plan'
import { PLAN_RATE_LIMITED_MESSAGE, planIpLimiter, planTokenLimiter } from '@/lib/proposals/plan-rate-limit'
import { notifyClinicOfChoice } from '@/lib/proposals/queue'
import { withApiErrors } from '@/lib/api/with-api-errors'
import { logPhiAccess, patientActor, type PhiAction } from '@/lib/audit/phi-access'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } })

type Params = { params: Promise<{ token: string }> }

const NOT_ACTIVE  = { status: 410, error: 'This link is no longer active. Please contact your clinic.' }
const LOCKED      = { status: 423, error: 'Too many incorrect dates of birth. This link is locked; please contact your clinic.' }
const UNAVAILABLE = { status: 503, error: 'Please try again in a moment.' }
const NOT_RECORDED = 'This change could not be recorded. Nothing was changed. Try again.'
const ROUTE = '/api/plan/[token]'

function limited(request: NextRequest, token: string | null): NextResponse | null {
  const ip = planIpLimiter.check(clientIp(request.headers) ?? 'unknown')
  if (!ip.allowed) return json({ error: PLAN_RATE_LIMITED_MESSAGE }, 429, { 'Retry-After': String(ip.retryAfterSeconds) })
  if (token !== null) {
    const link = planTokenLimiter.check(hashProposalToken(token))
    if (!link.allowed) return json({ error: PLAN_RATE_LIMITED_MESSAGE }, 429, { 'Retry-After': String(link.retryAfterSeconds) })
  }
  return null
}

async function getHandler(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const { token } = await params
  const refused = limited(request, null)
  if (refused) return refused
  const r = await resolvePlan(createServiceClient(), token, new Date())
  if (r.state === 'open') return json({ state: 'open', logoUrl: r.logoUrl })
  if (r.state === 'unavailable') return json({ state: 'unavailable' }, 503)
  return json({ state: 'closed' })
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

async function postHandler(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const { token } = await params
  const refused = limited(request, token)
  if (refused) return refused

  let body: unknown
  try { body = await request.json() } catch { return json({ error: 'Invalid request' }, 400) }
  const a = parse(body)
  if (!a) return json({ error: 'Invalid request' }, 400)

  const db = createServiceClient()
  const now = new Date()
  const r = await resolvePlan(db, token, now)
  if (r.state === 'unavailable') return json({ error: UNAVAILABLE.error, state: 'unavailable' }, UNAVAILABLE.status)
  if (r.state !== 'open') return json({ error: NOT_ACTIVE.error, state: 'closed' }, NOT_ACTIVE.status)
  const proposal = r.proposal

  const dob = await verifyPlanDob(db, proposal, a.dob, now)
  if (!dob.ok) {
    if (dob.reason === 'wrong') {
      return json({ error: `That date of birth doesn't match. ${dob.remaining} ${dob.remaining === 1 ? 'try' : 'tries'} left.`, remaining: dob.remaining }, 401)
    }
    // Only the request whose wrong date was the 5th learns of the lock (it
    // holds the link and was answering the date of birth question); every
    // later request gets the neutral 410 above.
    const reply = dob.reason === 'locked' ? LOCKED : UNAVAILABLE
    return json({ error: reply.error, state: dob.reason }, reply.status)
  }

  const logPlan = (action: PhiAction) => logPhiAccess({
    actor: patientActor(proposal.patient_id, proposal.clinic_id),
    action, resource: 'plan', route: ROUTE,
    patientId: proposal.patient_id, clinicId: proposal.clinic_id, headers: request.headers,
  })

  switch (a.action) {
    case 'verify': {
      const plan = await loadPlan(db, proposal)
      if (!plan) return json({ error: UNAVAILABLE.error }, UNAVAILABLE.status)
      // A read: served even when the row could not be written (the helper alerts).
      await logPlan('view')
      return json({ plan })
    }
    case 'quote': {
      const q = await quotePlan(db, proposal, a.selection)
      return q.ok ? json({ quote: q.quote }) : json({ error: q.error, code: q.code }, q.status)
    }
    case 'choose': {
      if (!(await logPlan('update'))) return json({ error: NOT_RECORDED }, 503)
      const c = await choosePlan(db, proposal, a.selection, now)
      if (!c.ok) return json({ error: c.error, code: c.code }, c.status)
      console.info(`[plan] ${c.rechosen ? 'rechosen' : 'chosen'} | proposal=${proposal.proposal_id}`)
      // PR 4: the clinic's in-app notification ("Plans ready to sign"). Idempotent per choice; never throws.
      await notifyClinicOfChoice(db, { proposalId: proposal.proposal_id })
      const plan = await loadPlan(db, { ...proposal, status: 'chosen', chosen_option_id: a.selection.optionId })
      return json({ ok: true, rechosen: c.rechosen, plan })
    }
    case 'decline': {
      if (!(await logPlan('update'))) return json({ error: NOT_RECORDED }, 503)
      const d = await declinePlan(db, proposal, now)
      if (!d.ok) return json({ error: d.error, code: d.code }, d.status)
      console.info(`[plan] declined | proposal=${proposal.proposal_id}`)
      return json({ ok: true })
    }
  }
}

export const GET = withApiErrors('/api/plan/[token]', getHandler)
export const POST = withApiErrors('/api/plan/[token]', postHandler)
