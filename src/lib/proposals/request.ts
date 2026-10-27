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
import { refuseCrossSite } from '@/lib/security/same-origin'
import { getUserClinicId, getUserRole } from '@/lib/auth/claims'
import type { PhiUser } from '@/lib/audit/phi-access'
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
  const crossSite = refuseCrossSite(request)
  if (crossSite) return { response: crossSite }
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
