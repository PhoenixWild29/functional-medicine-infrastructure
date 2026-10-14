// ============================================================
// Pending review: the one server-side guard on every write that matters
// ============================================================
//
// A clinic that signed up on its own (or was invited) can look around
// before ops approves it: Dashboard, New Prescription, Practice, Settings.
// Nothing that orders, signs, charges or reaches a patient runs until it
// is approved. Hiding the buttons is not enough, so every such route asks
// this guard right after it knows the caller's clinic:
//
//   drafts (create, edit, remove), signing and its check, payment links
//   (single, group, group-and-send, payment group), refills, shipping,
//   reassign, add a patient, patient intake links, patient import, and
//   inbound EHR patients (Keragon).
//
// Approved means onboarding_status 'approved' AND is_active true (what
// batch-sign has always required). Fails closed: a clinic that cannot be
// read is 503; a missing row is not approved.

import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { PENDING_REVIEW_CODE, PENDING_REVIEW_MESSAGE } from './pending-review-copy'

/** The banner's words, also every refusal's (no em dashes in UI copy). */
export { PENDING_REVIEW_CODE, PENDING_REVIEW_MESSAGE }
export const APPROVAL_UNAVAILABLE_MESSAGE = 'We could not check your clinic just now. Nothing was saved. Try again.'

export type ClinicApproval =
  | { state: 'approved' }
  | { state: 'pending'; onboardingStatus: string | null }
  | { state: 'unavailable' }

export function isApprovedClinic(row: { onboarding_status?: string | null; is_active?: boolean | null } | null | undefined): boolean {
  return row?.onboarding_status === 'approved' && row?.is_active === true
}

export async function clinicApproval(
  supabase: SupabaseClient<Database>,
  clinicId: string,
): Promise<ClinicApproval> {
  const { data, error } = await supabase
    .from('clinics')
    .select('onboarding_status, is_active')
    .eq('clinic_id', clinicId)
    .maybeSingle()
  if (error) {
    console.error(`[approval-guard] clinic could not be read | clinic=${clinicId}:`, error.message)
    return { state: 'unavailable' }
  }
  if (isApprovedClinic(data)) return { state: 'approved' }
  return { state: 'pending', onboardingStatus: data?.onboarding_status ?? null }
}

/**
 * null when the clinic is approved; otherwise the response to return
 * (403 with the banner wording, or 503 when the clinic could not be read).
 */
export async function refuseUnlessApproved(
  supabase: SupabaseClient<Database>,
  clinicId: string,
): Promise<NextResponse | null> {
  const approval = await clinicApproval(supabase, clinicId)
  if (approval.state === 'approved') return null
  if (approval.state === 'unavailable') {
    return NextResponse.json({ error: APPROVAL_UNAVAILABLE_MESSAGE }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
  return NextResponse.json(
    { error: PENDING_REVIEW_MESSAGE, code: PENDING_REVIEW_CODE },
    { status: 403, headers: { 'Cache-Control': 'no-store' } },
  )
}
