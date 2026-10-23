// ============================================================
// A clinic's providers as ops review them (queue card and review page)
// ============================================================
//
// For each clinic in review: every live provider with their name, email,
// whether they are the account holder of a self sign-up, their invite's
// status, and whether their NPI is verified in the national registry.
//
//   - Account holder: in a clinic that signed up on its own (signup_source
//     'self_serve'), the provider linked to their own login with no invite.
//     Their email is their sign-in email (auth), not an invite's.
//   - Unverified: any NPI status but 'verified' (not found, mismatch,
//     invalid, registry unreachable, or never checked). Approval then needs
//     ops to confirm they checked the license with the state board; the
//     confirmation is the approval event's note.
//
// Service role, behind the ops_admin gate. No patient data. A failed read
// throws: ops never approve from a partial review.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { inviteStatus, type InviteStatus } from './tokens'

type Supabase = SupabaseClient<Database>

export const ACCOUNT_HOLDER_LABEL = 'Account holder (signed up on their own)'
export const LICENSE_CHECK_LABEL = 'I checked this provider’s license with the state board'
export const LICENSE_CHECK_REQUIRED_MESSAGE = 'A provider’s NPI is not verified in the national registry. Check their license with the state board and confirm it before approving.'

export function unverifiedWarning(name: string): string {
  return `${name}’s NPI was not found in the national registry. Check their license with the state board before approving.`
}

/** The approval event's note when ops approved with unverified providers. */
export function licenseCheckNote(names: ReadonlyArray<string>): string {
  return `Ops confirmed: ${LICENSE_CHECK_LABEL}. NPI not verified in the national registry for: ${names.join(', ')}.`
}

export interface ProviderSummary {
  providerId:    string
  name:          string
  email:         string | null
  accountHolder: boolean
  inviteStatus:  InviteStatus | null
  npiStatus:     string | null
  npiVerified:   boolean
}

export async function loadProviderSummaries(
  supabase: Supabase,
  clinics: ReadonlyArray<{ clinicId: string; signupSource: string | null | undefined }>,
  now: Date = new Date(),
): Promise<Map<string, ProviderSummary[]>> {
  const out = new Map<string, ProviderSummary[]>()
  if (clinics.length === 0) return out
  const clinicIds = clinics.map(c => c.clinicId)
  const selfServe = new Set(clinics.filter(c => c.signupSource === 'self_serve').map(c => c.clinicId))

  const [provRes, invRes] = await Promise.all([
    supabase.from('providers')
      .select('provider_id, clinic_id, first_name, last_name, user_id')
      .in('clinic_id', clinicIds)
      .is('deleted_at', null)
      .order('created_at'),
    supabase.from('onboarding_invites')
      .select('provider_id, email, accepted_at, revoked_at, expires_at, created_at')
      .in('clinic_id', clinicIds)
      .eq('kind', 'provider')
      .order('created_at', { ascending: false }),
  ])
  if (provRes.error || invRes.error) throw new Error(`providers could not be read: ${(provRes.error ?? invRes.error)?.message}`)
  const providers = (provRes.data ?? []) as Array<{ provider_id: string; clinic_id: string; first_name: string; last_name: string; user_id: string | null }>

  const providerIds = providers.map(p => p.provider_id)
  const npiRes = providerIds.length
    ? await supabase.from('provider_npi_verifications').select('provider_id, status').in('provider_id', providerIds)
    : { data: [], error: null }
  if (npiRes.error) throw new Error(`NPI checks could not be read: ${npiRes.error.message}`)
  const npi = new Map(((npiRes.data ?? []) as Array<{ provider_id: string; status: string }>).map(n => [n.provider_id, n.status]))

  // Newest invite per provider.
  const invites = new Map<string, { email: string; accepted_at: string | null; revoked_at: string | null; expires_at: string }>()
  for (const i of (invRes.data ?? []) as Array<{ provider_id: string | null; email: string; accepted_at: string | null; revoked_at: string | null; expires_at: string }>) {
    if (i.provider_id && !invites.has(i.provider_id)) invites.set(i.provider_id, i)
  }

  // The account holders' sign-in emails.
  const holders = providers.filter(p => selfServe.has(p.clinic_id) && p.user_id && !invites.has(p.provider_id))
  const emails = new Map<string, string>()
  await Promise.all(holders.map(async p => {
    const { data, error } = await supabase.auth.admin.getUserById(p.user_id!)
    if (error) console.error(`[ops/onboarding] account holder email not read | provider=${p.provider_id}: ${error.message}`)
    if (data?.user?.email) emails.set(p.provider_id, data.user.email)
  }))

  for (const c of clinicIds) out.set(c, [])
  for (const p of providers) {
    const invite = invites.get(p.provider_id)
    const accountHolder = holders.includes(p)
    const status = npi.get(p.provider_id) ?? null
    out.get(p.clinic_id)?.push({
      providerId:    p.provider_id,
      name:          `${p.first_name} ${p.last_name}`,
      email:         accountHolder ? emails.get(p.provider_id) ?? null : invite?.email ?? null,
      accountHolder,
      inviteStatus:  invite ? inviteStatus(invite, now) : null,
      npiStatus:     status,
      npiVerified:   status === 'verified',
    })
  }
  return out
}
