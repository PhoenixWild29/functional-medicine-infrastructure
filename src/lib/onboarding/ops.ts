// ============================================================
// Ops view of clinic onboarding
// ============================================================
//
// Clinic admin invites (pending, accepted, expired, revoked) and every
// clinic still in onboarding, with its step statuses, for /ops/onboarding;
// and the clinics approved through onboarding, with when and who approved
// (a name, else 'CompoundIQ ops'; never an email).
// Read with the service role behind the ops_admin gate. No patient data.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { fullStatuses, type OnboardingStatus, type StepKey, type StepStatus } from './steps'
import { inviteStatus, type InviteStatus } from './tokens'
import { resolveActorNames, ROLE_LABELS } from './review'
import { loadProviderSummaries, type ProviderSummary } from './provider-review'

export interface OpsInvite {
  inviteId:   string
  clinicId:   string
  clinicName: string
  email:      string
  status:     InviteStatus
  expiresAt:  string
  createdAt:  string
  sentCount:  number
}

export interface OpsClinicOnboarding {
  clinicId:         string
  name:             string
  onboardingStatus: OnboardingStatus
  submittedAt:      string | null
  reviewNote:       string | null
  steps:            Record<StepKey, StepStatus>
  /** 'self_serve' (signed up at /get-started), 'invite', or null (before either). */
  signupSource?:    string | null
  /** For a self sign-up: 'clinic' or 'solo_provider'. */
  signupKind?:      string | null
  /** Its providers: name, email, account holder, invite, NPI verified (lib/onboarding/provider-review). */
  providers?:       ProviderSummary[]
}

export interface OpsApprovedClinic {
  clinicId:   string
  name:       string
  approvedAt: string
  approvedBy: string
}

export interface OpsOnboarding {
  invites:  OpsInvite[]
  clinics:  OpsClinicOnboarding[]
  approved: OpsApprovedClinic[]
}

export async function loadOpsOnboarding(supabase: SupabaseClient<Database>, now: Date = new Date()): Promise<OpsOnboarding> {
  const [invRes, clinicRes, approvedRes] = await Promise.all([
    supabase.from('onboarding_invites')
      .select('invite_id, clinic_id, email, accepted_at, revoked_at, expires_at, created_at, sent_count, clinics(name)')
      .eq('kind', 'clinic_admin')
      .order('created_at', { ascending: false })
      .limit(200),
    supabase.from('clinics')
      .select('clinic_id, name, onboarding_status, onboarding_submitted_at, onboarding_review_note, signup_source, signup_kind')
      .neq('onboarding_status', 'approved')
      .is('deleted_at', null)
      .order('onboarding_submitted_at', { ascending: false, nullsFirst: false })
      .limit(200),
    // Approved THROUGH onboarding: reviewed. Clinics that predate onboarding
    // are 'approved' by default and were never reviewed, so they are not listed.
    supabase.from('clinics')
      .select('clinic_id, name, onboarding_reviewed_at, onboarding_reviewed_by')
      .eq('onboarding_status', 'approved')
      .not('onboarding_reviewed_at', 'is', null)
      .is('deleted_at', null)
      .order('onboarding_reviewed_at', { ascending: false })
      .limit(200),
  ])
  if (invRes.error || clinicRes.error || approvedRes.error) {
    throw new Error(`ops onboarding could not be read: ${(invRes.error ?? clinicRes.error ?? approvedRes.error)?.message}`)
  }
  const approvedRows = (approvedRes.data ?? []) as Array<{ clinic_id: string; name: string; onboarding_reviewed_at: string | null; onboarding_reviewed_by: string | null }>
  const approverNames = await resolveActorNames(supabase, approvedRows.map(r => r.onboarding_reviewed_by))

  const clinics = clinicRes.data ?? []
  const clinicIds = clinics.map(c => c.clinic_id)
  const stepsRes = clinicIds.length
    ? await supabase.from('clinic_onboarding_steps').select('clinic_id, step, status').in('clinic_id', clinicIds)
    : { data: [], error: null }
  if (stepsRes.error) throw new Error(`onboarding steps could not be read: ${stepsRes.error.message}`)
  const providers = await loadProviderSummaries(supabase, clinics.map(c => ({ clinicId: c.clinic_id, signupSource: c.signup_source ?? null })))

  return {
    invites: (invRes.data ?? []).map(i => ({
      inviteId:   i.invite_id,
      clinicId:   i.clinic_id,
      clinicName: (i.clinics as { name?: string } | null)?.name ?? 'Unknown clinic',
      email:      i.email,
      status:     inviteStatus(i, now),
      expiresAt:  i.expires_at,
      createdAt:  i.created_at,
      sentCount:  i.sent_count,
    })),
    clinics: clinics.map(c => ({
      clinicId:         c.clinic_id,
      name:             c.name,
      onboardingStatus: c.onboarding_status as OnboardingStatus,
      submittedAt:      c.onboarding_submitted_at,
      reviewNote:       c.onboarding_review_note,
      steps:            fullStatuses((stepsRes.data ?? []).filter(s => s.clinic_id === c.clinic_id)),
      signupSource:     c.signup_source ?? null,
      signupKind:       c.signup_kind ?? null,
      providers:        providers.get(c.clinic_id) ?? [],
    })),
    approved: approvedRows.map(r => ({
      clinicId:   r.clinic_id,
      name:       r.name,
      approvedAt: r.onboarding_reviewed_at ?? '',
      approvedBy: (r.onboarding_reviewed_by && approverNames.get(r.onboarding_reviewed_by)) || ROLE_LABELS['ops_admin']!,
    })),
  }
}
