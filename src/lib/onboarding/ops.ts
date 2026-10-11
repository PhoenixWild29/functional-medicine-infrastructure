// ============================================================
// Ops view of clinic onboarding
// ============================================================
//
// Clinic admin invites (pending, accepted, expired, revoked) and every
// clinic still in onboarding, with its step statuses, for /ops/onboarding.
// Read with the service role behind the ops_admin gate. No patient data.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { fullStatuses, type OnboardingStatus, type StepKey, type StepStatus } from './steps'
import { inviteStatus, type InviteStatus } from './tokens'

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
}

export interface OpsOnboarding {
  invites: OpsInvite[]
  clinics: OpsClinicOnboarding[]
}

export async function loadOpsOnboarding(supabase: SupabaseClient<Database>, now: Date = new Date()): Promise<OpsOnboarding> {
  const [invRes, clinicRes] = await Promise.all([
    supabase.from('onboarding_invites')
      .select('invite_id, clinic_id, email, accepted_at, revoked_at, expires_at, created_at, sent_count, clinics(name)')
      .eq('kind', 'clinic_admin')
      .order('created_at', { ascending: false })
      .limit(200),
    supabase.from('clinics')
      .select('clinic_id, name, onboarding_status, onboarding_submitted_at, onboarding_review_note')
      .neq('onboarding_status', 'approved')
      .is('deleted_at', null)
      .order('onboarding_submitted_at', { ascending: false, nullsFirst: false })
      .limit(200),
  ])
  if (invRes.error || clinicRes.error) throw new Error(`ops onboarding could not be read: ${(invRes.error ?? clinicRes.error)?.message}`)

  const clinics = clinicRes.data ?? []
  const clinicIds = clinics.map(c => c.clinic_id)
  const stepsRes = clinicIds.length
    ? await supabase.from('clinic_onboarding_steps').select('clinic_id, step, status').in('clinic_id', clinicIds)
    : { data: [], error: null }
  if (stepsRes.error) throw new Error(`onboarding steps could not be read: ${stepsRes.error.message}`)

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
    })),
  }
}
