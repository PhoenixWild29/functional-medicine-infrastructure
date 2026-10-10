// ============================================================
// The onboarding wizard's state, read server-side
// ============================================================
//
// Everything the wizard shows for one clinic: practice details, step
// statuses, providers (with licenses, NPI check result and invite
// status), staff invites and BAA / terms acceptances. Payout setup is not
// live for onboarding, so nothing about payouts is read.
// Read with the service role after the caller is verified as that
// clinic's admin. No patient data.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { fullStatuses, type OnboardingStatus, type StepKey, type StepStatus } from './steps'
import { inviteStatus, type InviteStatus } from './tokens'
import type { AgreementKey } from './agreement-texts'

export interface OnboardingClinicDetails {
  clinicId:            string
  name:                string
  onboardingStatus:    OnboardingStatus
  reviewNote:          string | null
  legalName:           string | null
  dbaName:             string | null
  addressLine1:        string | null
  addressLine2:        string | null
  city:                string | null
  state:               string | null
  postalCode:          string | null
  phone:               string | null
  practiceNpi:         string | null
  taxIdLast4:          string | null
  absorbShipping:      boolean
}

export interface OnboardingInviteSummary {
  inviteId: string
  email:    string
  status:   InviteStatus
}

export interface OnboardingProvider {
  providerId: string
  firstName:  string
  lastName:   string
  npiNumber:  string
  npiStatus:  string | null
  licenses:   Array<{ state: string; licenseNumber: string; expiresOn: string }>
  invite:     OnboardingInviteSummary | null
}

export interface OnboardingAcceptance {
  version:     string
  signerName:  string
  signerTitle: string
  acceptedAt:  string
}

export interface OnboardingState {
  clinic:      OnboardingClinicDetails
  steps:       Record<StepKey, StepStatus>
  providers:   OnboardingProvider[]
  staff:       OnboardingInviteSummary[]
  acceptances: Partial<Record<AgreementKey, OnboardingAcceptance>>
}

export async function loadOnboardingState(
  supabase: SupabaseClient<Database>,
  clinicId: string,
  now: Date = new Date(),
): Promise<OnboardingState | null> {
  const [clinicRes, stepsRes, providersRes, invitesRes, acceptRes] = await Promise.all([
    supabase.from('clinics')
      .select('clinic_id, name, onboarding_status, onboarding_review_note, legal_name, dba_name, address_line1, address_line2, city, state, postal_code, contact_phone, practice_npi, tax_id_last4, absorb_shipping')
      .eq('clinic_id', clinicId).maybeSingle(),
    supabase.from('clinic_onboarding_steps').select('step, status').eq('clinic_id', clinicId),
    supabase.from('providers').select('provider_id, first_name, last_name, npi_number').eq('clinic_id', clinicId).is('deleted_at', null).order('created_at'),
    supabase.from('onboarding_invites').select('invite_id, kind, email, provider_id, accepted_at, revoked_at, expires_at, created_at').eq('clinic_id', clinicId).order('created_at', { ascending: false }),
    supabase.from('agreement_acceptances').select('agreement, template_version, signer_name, signer_title, accepted_at').eq('clinic_id', clinicId).order('accepted_at', { ascending: false }),
  ])
  if (clinicRes.error || stepsRes.error || providersRes.error || invitesRes.error || acceptRes.error) {
    const msg = (clinicRes.error ?? stepsRes.error ?? providersRes.error ?? invitesRes.error ?? acceptRes.error)?.message
    throw new Error(`onboarding state could not be read: ${msg}`)
  }
  const c = clinicRes.data
  if (!c) return null

  const providers = providersRes.data ?? []
  const providerIds = providers.map(p => p.provider_id)
  const [licRes, npiRes] = providerIds.length
    ? await Promise.all([
        supabase.from('provider_state_licenses').select('provider_id, state, license_number, expires_on').in('provider_id', providerIds),
        supabase.from('provider_npi_verifications').select('provider_id, status').in('provider_id', providerIds),
      ])
    : [{ data: [], error: null }, { data: [], error: null }]
  if (licRes.error || npiRes.error) throw new Error(`provider credentials could not be read: ${(licRes.error ?? npiRes.error)?.message}`)

  const invites = invitesRes.data ?? []
  const summary = (i: (typeof invites)[number]): OnboardingInviteSummary => ({ inviteId: i.invite_id, email: i.email, status: inviteStatus(i, now) })

  const acceptances: Partial<Record<AgreementKey, OnboardingAcceptance>> = {}
  for (const a of acceptRes.data ?? []) {
    const key = a.agreement as AgreementKey
    if ((key === 'baa' || key === 'terms') && !acceptances[key]) {
      acceptances[key] = { version: a.template_version, signerName: a.signer_name, signerTitle: a.signer_title, acceptedAt: a.accepted_at }
    }
  }

  return {
    clinic: {
      clinicId:            c.clinic_id,
      name:                c.name,
      onboardingStatus:    c.onboarding_status as OnboardingStatus,
      reviewNote:          c.onboarding_review_note,
      legalName:           c.legal_name,
      dbaName:             c.dba_name,
      addressLine1:        c.address_line1,
      addressLine2:        c.address_line2,
      city:                c.city,
      state:               c.state,
      postalCode:          c.postal_code,
      phone:               c.contact_phone,
      practiceNpi:         c.practice_npi,
      taxIdLast4:          c.tax_id_last4,
      absorbShipping:      c.absorb_shipping,
    },
    steps: fullStatuses(stepsRes.data ?? []),
    providers: providers.map(p => {
      const invite = invites.find(i => i.kind === 'provider' && i.provider_id === p.provider_id)
      return {
        providerId: p.provider_id,
        firstName:  p.first_name,
        lastName:   p.last_name,
        npiNumber:  p.npi_number,
        npiStatus:  (npiRes.data ?? []).find(n => n.provider_id === p.provider_id)?.status ?? null,
        licenses:   (licRes.data ?? []).filter(l => l.provider_id === p.provider_id).map(l => ({ state: l.state, licenseNumber: l.license_number, expiresOn: l.expires_on })),
        invite:     invite ? summary(invite) : null,
      }
    }),
    staff: invites.filter(i => i.kind === 'medical_assistant').map(summary),
    acceptances,
  }
}
