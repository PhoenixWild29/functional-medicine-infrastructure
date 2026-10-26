// ============================================================
// Proposal routes: who is calling (patient protocol choice, PR 2)
// ============================================================
//
// The clinic route stack: writes are same-origin only; the user is
// verified with getUser() (never getSession()); role and clinic come from
// app_metadata (lib/auth/claims); the clinic must be approved
// (lib/onboarding/approval-guard). Which staff may send is decided by
// lib/proposals/propose (a medical assistant prepares, never sends).

import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { refuseUnlessApproved } from '@/lib/onboarding/approval-guard'
import { getUserClinicId, getUserRole } from '@/lib/auth/claims'
import { logPhiAccess, type PhiUser } from '@/lib/audit/phi-access'
import { UUID_RE } from '@/lib/api/input'
import type { ProposalFailure } from './propose'

const STAFF_ROLES = new Set(['provider', 'medical_assistant', 'clinic_admin'])

export type ProposalRequestContext = {
  db:       ReturnType<typeof createServiceClient>
  clinicId: string
  caller:   { userId: string; role: string | null }
  user:     PhiUser
}

export async function proposalCaller(request: NextRequest): Promise<ProposalRequestContext | { response: NextResponse }> {
  const site = request.headers.get('sec-fetch-site')
  if (site && site !== 'same-origin' && site !== 'none') {
    return { response: NextResponse.json({ error: 'Cross-site requests are not permitted' }, { status: 403 }) }
  }
  const supabaseAuth = await createServerClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const role = getUserRole(user) ?? null
  if (!STAFF_ROLES.has(role ?? '')) return { response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  const clinicId = getUserClinicId(user)
  if (!clinicId) return { response: NextResponse.json({ error: 'Session missing clinic_id' }, { status: 400 }) }
  const db = createServiceClient()
  const pending = await refuseUnlessApproved(db, clinicId)
  if (pending) return { response: pending }
  return { db, clinicId, caller: { userId: user.id, role }, user: user as PhiUser }
}

/** The library's refusal, as it is. */
export function failureResponse(f: ProposalFailure): NextResponse {
  return NextResponse.json(
    { error: f.error, ...(f.code ? { code: f.code } : {}), ...(f.problems ? { problems: f.problems } : {}) },
    { status: f.status, headers: { 'Cache-Control': 'no-store' } },
  )
}

export async function proposalIdFrom(context: { params: Promise<{ proposalId: string }> }): Promise<string | null> {
  const { proposalId } = await context.params
  return UUID_RE.test(proposalId) ? proposalId : null
}

const NOT_RECORDED = 'This change could not be recorded. Nothing was changed. Try again.'

/**
 * PHI access log (B14/B15) for a write on a known plan (send, cancel, a
 * delivery event): one 'update' / 'proposal' row with the plan's patient
 * and clinic, BEFORE the library writes. Returns the refusal to send, or
 * null to go on. Fail-closed: a plan that cannot be read, or a log row that
 * is not written, is a 503 and nothing is changed. A plan that is not
 * found (in the caller's clinic) writes no row; the library answers 404.
 */
export async function refuseUnlessProposalWriteLogged(
  c: ProposalRequestContext, request: NextRequest, proposalId: string, route: string,
): Promise<NextResponse | null> {
  const { data, error } = await c.db.from('treatment_proposals')
    .select('patient_id, clinic_id')
    .eq('proposal_id', proposalId)
    .eq('clinic_id', c.clinicId)
    .maybeSingle()
  if (error) {
    console.error('[proposals] plan could not be read for the access log:', error.message, '| proposal=', proposalId)
    return NextResponse.json({ error: 'The plan could not be read. Nothing was changed. Try again.' }, { status: 503 })
  }
  const plan = data as { patient_id: string; clinic_id: string } | null
  if (!plan) return null
  const logged = await logPhiAccess({
    user: c.user, action: 'update', resource: 'proposal', route,
    patientId: plan.patient_id, clinicId: plan.clinic_id, headers: request.headers,
  })
  return logged ? null : NextResponse.json({ error: NOT_RECORDED }, { status: 503 })
}
