// ============================================================
// Ops review of one clinic in onboarding
// ============================================================
//
// What ops reads before approving a clinic (/ops/onboarding/[clinicId]):
//
//   - practice: legal name, DBA, address, phone, practice NPI, tax ID
//     last 4, who pays shipping (from the wizard's state)
//   - providers: name, email (their invite's; providers have no email
//     column), NPI, the NPPES registry result (status, reason, the name
//     the registry holds), licenses, invite status
//   - staff: the medical assistant invites
//   - agreements: the latest BAA and terms acceptance, with the first 12
//     characters of the accepted text's SHA-256
//   - history: clinic_onboarding_events, oldest first
//
// Who acted is a name (user_metadata full_name, then name) beside the
// role, or the role alone. An email is never shown as a name.
//
// Read with the service role behind the ops_admin gate. No patient data.
// A read that fails throws: ops never approve from a partial review.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import type { NpiStatus } from '@/lib/providers/npi'
import { loadOnboardingState, type OnboardingClinicDetails, type OnboardingInviteSummary, type OnboardingProvider } from './state'
import type { OnboardingEvent } from './events'

type Supabase = SupabaseClient<Database>

export interface ReviewClinic extends OnboardingClinicDetails {
  submittedAt: string | null
  reviewedAt:  string | null
  /** Who last approved or sent it back: a name, or 'CompoundIQ ops'. */
  reviewedBy:  string | null
}

export interface ReviewProvider extends Omit<OnboardingProvider, 'npiStatus'> {
  email: string | null
  npi: {
    status:       NpiStatus | null
    reason:       string | null
    registryName: string | null
    checkedAt:    string | null
  }
}

export interface ReviewAgreement {
  agreement:      'baa' | 'terms'
  signerName:     string
  signerTitle:    string
  version:        string
  acceptedAt:     string
  textHashPrefix: string
}

export interface ReviewHistoryEntry {
  eventId: string
  event:   OnboardingEvent
  at:      string
  actor:   string
  note:    string | null
}

export interface ClinicReview {
  clinic:     ReviewClinic
  providers:  ReviewProvider[]
  staff:      OnboardingInviteSummary[]
  agreements: ReviewAgreement[]
  history:    ReviewHistoryEntry[]
}

export const ROLE_LABELS: Record<string, string> = {
  ops_admin:         'CompoundIQ ops',
  clinic_admin:      'Clinic admin',
  provider:          'Provider',
  medical_assistant: 'Medical assistant',
}

const clean = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

/**
 * Display names for auth user ids: user_metadata full_name, then name.
 * Never the email. A lookup that fails leaves that id unnamed.
 */
export async function resolveActorNames(supabase: Supabase, ids: ReadonlyArray<string | null | undefined>): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const unique = [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))]
  await Promise.all(unique.map(async id => {
    try {
      const { data, error } = await supabase.auth.admin.getUserById(id)
      if (error || !data?.user) return
      const profile = (data.user.user_metadata ?? {}) as Record<string, unknown>
      const name = clean(profile['full_name']) ?? clean(profile['name'])
      if (name && !name.includes('@')) out.set(id, name)
    } catch (err) {
      console.warn('[ops/onboarding] user lookup failed (non-fatal):', err instanceof Error ? err.message : err)
    }
  }))
  return out
}

export async function loadClinicReview(supabase: Supabase, clinicId: string, now: Date = new Date()): Promise<ClinicReview | null> {
  const state = await loadOnboardingState(supabase, clinicId, now)
  if (!state) return null

  const providerIds = state.providers.map(p => p.providerId)
  const [clinicRes, invitesRes, npiRes, acceptRes, eventsRes] = await Promise.all([
    supabase.from('clinics')
      .select('onboarding_submitted_at, onboarding_reviewed_at, onboarding_reviewed_by')
      .eq('clinic_id', clinicId).maybeSingle(),
    supabase.from('onboarding_invites')
      .select('provider_id, email, created_at')
      .eq('clinic_id', clinicId).eq('kind', 'provider')
      .order('created_at', { ascending: false }),
    providerIds.length
      ? supabase.from('provider_npi_verifications')
          .select('provider_id, status, reason, registry_first_name, registry_last_name, checked_at')
          .in('provider_id', providerIds)
      : Promise.resolve({ data: [], error: null }),
    supabase.from('agreement_acceptances')
      .select('agreement, template_version, text_sha256, signer_name, signer_title, accepted_at')
      .eq('clinic_id', clinicId)
      .order('accepted_at', { ascending: false }),
    supabase.from('clinic_onboarding_events')
      .select('event_id, event, actor_user_id, actor_role, note, created_at')
      .eq('clinic_id', clinicId)
      .order('created_at', { ascending: true })
      .limit(500),
  ])
  const failed = clinicRes.error ?? invitesRes.error ?? npiRes.error ?? acceptRes.error ?? eventsRes.error
  if (failed) throw new Error(`clinic review could not be read: ${failed.message}`)

  const c = clinicRes.data as { onboarding_submitted_at: string | null; onboarding_reviewed_at: string | null; onboarding_reviewed_by: string | null } | null
  const events = ((eventsRes.data ?? []) as Array<{ event_id: string; event: string; actor_user_id: string | null; actor_role: string | null; note: string | null; created_at: string }>)
    .slice().sort((a, b) => a.created_at.localeCompare(b.created_at))
  const names = await resolveActorNames(supabase, [...events.map(e => e.actor_user_id), c?.onboarding_reviewed_by])

  const providerEmails = new Map<string, string>()
  for (const i of (invitesRes.data ?? []) as Array<{ provider_id: string | null; email: string }>) {
    if (i.provider_id && !providerEmails.has(i.provider_id)) providerEmails.set(i.provider_id, i.email)
  }
  type NpiRow = { provider_id: string; status: string; reason: string | null; registry_first_name: string | null; registry_last_name: string | null; checked_at: string | null }
  const npiRows = (npiRes.data ?? []) as NpiRow[]

  const agreements: ReviewAgreement[] = []
  for (const key of ['baa', 'terms'] as const) {
    const a = ((acceptRes.data ?? []) as Array<{ agreement: string; template_version: string; text_sha256: string; signer_name: string; signer_title: string; accepted_at: string }>)
      .filter(r => r.agreement === key)
      .sort((x, y) => y.accepted_at.localeCompare(x.accepted_at))[0]
    if (a) {
      agreements.push({
        agreement: key, signerName: a.signer_name, signerTitle: a.signer_title, version: a.template_version,
        acceptedAt: a.accepted_at, textHashPrefix: a.text_sha256.slice(0, 12),
      })
    }
  }

  return {
    clinic: {
      ...state.clinic,
      submittedAt: c?.onboarding_submitted_at ?? null,
      reviewedAt:  c?.onboarding_reviewed_at ?? null,
      reviewedBy:  c?.onboarding_reviewed_by ? names.get(c.onboarding_reviewed_by) ?? ROLE_LABELS['ops_admin']! : null,
    },
    providers: state.providers.map(({ npiStatus: _ignored, ...p }) => {
      const n = npiRows.find(r => r.provider_id === p.providerId)
      const registryName = n ? [n.registry_first_name, n.registry_last_name].filter(Boolean).join(' ') || null : null
      return {
        ...p,
        email: providerEmails.get(p.providerId) ?? p.invite?.email ?? null,
        npi: { status: (n?.status as NpiStatus | undefined) ?? null, reason: n?.reason ?? null, registryName, checkedAt: n?.checked_at ?? null },
      }
    }),
    staff: state.staff,
    agreements,
    history: events.map(e => {
      const role = e.actor_role ? ROLE_LABELS[e.actor_role] ?? e.actor_role : 'System'
      const name = e.actor_user_id ? names.get(e.actor_user_id) : undefined
      return { eventId: e.event_id, event: e.event as OnboardingEvent, at: e.created_at, actor: name ? `${name} (${role})` : role, note: e.note }
    }),
  }
}
