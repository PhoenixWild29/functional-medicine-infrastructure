// ============================================================
// Who may sign — the one answer for the sign page and the sign API
// ============================================================
//
// A provider signs as their own linked provider record (providers.user_id,
// see current-provider.ts). Their NPI and licenses are checked per line by
// batch-sign (C4), as before.
//
// Self sign-up, decision 1: a solo provider signs up as a clinic_admin who
// is also a provider. A clinic_admin may sign only when a provider record
// in their clinic is linked to their login AND that record's NPI passed
// the registry check (provider_npi_verifications, for the NPI on file
// now). They sign only as that provider. A plain clinic_admin, and every
// other role, cannot sign.
//
// The middleware cannot read the provider record, so it lets providers and
// clinic admins reach the sign page (mayOpenSignPage); the page, POST
// /api/orders/batch-sign and its /check all ask resolveSigner.
//
// Fails closed: a record that cannot be read is 503 (a check that could
// not run), never a yes.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import type { CurrentProvider } from './current-provider'

export type SignerResult =
  | { ok: true; provider: CurrentProvider }
  | { ok: false; status: 403 | 503; message: string }

export const SIGNER_COPY = {
  notProvider: 'Only a provider can sign prescriptions.',
  unlinked:    'Only a provider can sign, and your login is not linked to a provider in this clinic.',
  unverified:  'Your NPI has not passed the registry check yet, so nothing can be signed. Check it on Settings, or contact CompoundIQ.',
  unavailable: 'Your provider record could not be read. Nothing was signed. Try again.',
} as const

/** Roles that may reach /new-prescription/sign. The page then asks resolveSigner. */
export function mayOpenSignPage(role: unknown): boolean {
  return role === 'provider' || role === 'clinic_admin'
}

export async function resolveSigner(
  supabase: SupabaseClient<Database>,
  { userId, clinicId, role }: { userId: string; clinicId: string; role: string | null | undefined },
): Promise<SignerResult> {
  if (!mayOpenSignPage(role) || !userId || !clinicId) {
    return { ok: false, status: 403, message: SIGNER_COPY.notProvider }
  }

  const { data: provider, error } = await supabase
    .from('providers')
    .select('provider_id, clinic_id, first_name, last_name, npi_number, signature_hash')
    .eq('user_id', userId)
    .eq('clinic_id', clinicId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) {
    console.error('[signer] provider lookup failed:', error.message)
    return { ok: false, status: 503, message: SIGNER_COPY.unavailable }
  }
  if (!provider) {
    return { ok: false, status: 403, message: role === 'provider' ? SIGNER_COPY.unlinked : SIGNER_COPY.notProvider }
  }
  if (role === 'provider') return { ok: true, provider }

  // clinic_admin: also a provider, with an NPI that passed the registry check.
  const { data: verification, error: verificationError } = await supabase
    .from('provider_npi_verifications')
    .select('npi, status')
    .eq('provider_id', provider.provider_id)
    .maybeSingle()
  if (verificationError) {
    console.error('[signer] NPI verification lookup failed:', verificationError.message)
    return { ok: false, status: 503, message: SIGNER_COPY.unavailable }
  }
  if (verification?.status !== 'verified' || verification.npi !== provider.npi_number) {
    return { ok: false, status: 403, message: SIGNER_COPY.unverified }
  }
  return { ok: true, provider }
}
