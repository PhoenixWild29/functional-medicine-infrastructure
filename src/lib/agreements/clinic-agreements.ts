// ============================================================
// A clinic's agreements after onboarding (/settings/agreements)
// ============================================================
//
// The BAA and the terms of service a clinic has accepted, newest first,
// and whether the current template (lib/onboarding/agreement-texts) is a
// newer version than the clinic's latest acceptance. A new version is
// accepted exactly as the onboarding wizard records it: the current
// version and the SHA-256 of the SERVER's copy of the text (a hash or
// version the browser sends is never trusted; a stale version is 409).
//
// "View text" shows the text a clinic accepted only when that version's
// text is known (the current templates, plus the archive of earlier ones)
// AND its SHA-256 matches the acceptance record. Otherwise it says so:
// a record is never shown beside text it does not match.
//
// Server-only (node:crypto). Reads and writes with the service role,
// always scoped to the caller's clinic from app_metadata (claims.ts),
// after getUser(). No patient data.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { getUserClinicId, getUserRole, type ClaimsUser } from '@/lib/auth/claims'
import { AGREEMENTS, agreementSha256, type AgreementKey } from '@/lib/onboarding/agreements'
import { BAA_V0_1_ORIGINAL_TEXT } from '@/lib/onboarding/legal-texts.generated'

type Supabase = SupabaseClient<Database>

export const AGREEMENT_KEYS: AgreementKey[] = ['baa', 'terms']

/** Earlier versions a clinic may have accepted, word for word. */
const ARCHIVE: Record<AgreementKey, Record<string, string>> = {
  baa:   { 'v0.1': BAA_V0_1_ORIGINAL_TEXT },
  terms: {},
}

/** The text of one version of an agreement, if it is known. */
export function agreementTextFor(agreement: AgreementKey, version: string): string | null {
  if (AGREEMENTS[agreement].version === version) return AGREEMENTS[agreement].text
  return ARCHIVE[agreement][version] ?? null
}

/** The accepted text, only when it is known and its SHA-256 matches the record. */
export function verifiedAcceptedText(a: { agreement: AgreementKey; version: string; textSha256: string }): string | null {
  const text = agreementTextFor(a.agreement, a.version)
  return text !== null && agreementSha256(text) === a.textSha256 ? text : null
}

export interface ClinicAcceptance {
  acceptanceId: string
  agreement:    AgreementKey
  version:      string
  textSha256:   string
  signerName:   string
  signerTitle:  string
  acceptedAt:   string
}

export interface ClinicAgreement {
  current:         { title: string; version: string }
  acceptances:     ClinicAcceptance[]
  latest:          ClinicAcceptance | null
  /** The current template is a newer version than the latest acceptance. */
  updateAvailable: boolean
}

export type ClinicAgreements = Record<AgreementKey, ClinicAgreement>

interface AcceptanceRow {
  acceptance_id:    string
  agreement:        string
  template_version: string
  text_sha256:      string
  signer_name:      string
  signer_title:     string
  accepted_at:      string
}

export const ACCEPTANCE_COLUMNS = 'acceptance_id, agreement, template_version, text_sha256, signer_name, signer_title, accepted_at'

export function toAcceptance(r: AcceptanceRow): ClinicAcceptance {
  return {
    acceptanceId: r.acceptance_id, agreement: r.agreement as AgreementKey, version: r.template_version, textSha256: r.text_sha256,
    signerName: r.signer_name, signerTitle: r.signer_title, acceptedAt: r.accepted_at,
  }
}

/** Every acceptance of the clinic, by agreement. Throws when it cannot be read. */
export async function loadClinicAgreements(supabase: Supabase, clinicId: string): Promise<ClinicAgreements> {
  const { data, error } = await supabase
    .from('agreement_acceptances')
    .select(ACCEPTANCE_COLUMNS)
    .eq('clinic_id', clinicId)
    .order('accepted_at', { ascending: false })
    .limit(200)
  if (error) throw new Error(`agreement acceptances could not be read: ${error.message}`)
  const all = ((data ?? []) as AcceptanceRow[]).map(toAcceptance).sort((a, b) => b.acceptedAt.localeCompare(a.acceptedAt))

  const out = {} as ClinicAgreements
  for (const key of AGREEMENT_KEYS) {
    const acceptances = all.filter(a => a.agreement === key)
    const latest = acceptances[0] ?? null
    out[key] = {
      current: { title: AGREEMENTS[key].title, version: AGREEMENTS[key].version },
      acceptances,
      latest,
      updateAvailable: latest !== null && latest.version !== AGREEMENTS[key].version,
    }
  }
  return out
}

export type AcceptanceResult =
  | { ok: true; version: string }
  | { ok: false; status: 400 | 409 | 500; error: string; errors?: Record<string, string> }

/** Records an acceptance of the CURRENT version, as the onboarding wizard does. */
export async function recordAgreementAcceptance(
  supabase: Supabase,
  input: { clinicId: string; userId: string; agreement: AgreementKey; version: unknown; signerName: unknown; signerTitle: unknown },
): Promise<AcceptanceResult> {
  const template = AGREEMENTS[input.agreement]
  const signerName = typeof input.signerName === 'string' ? input.signerName.trim().slice(0, 200) : ''
  const signerTitle = typeof input.signerTitle === 'string' ? input.signerTitle.trim().slice(0, 200) : ''
  const errors: Record<string, string> = {}
  if (!signerName) errors['signerName'] = 'Enter your full name.'
  if (!signerTitle) errors['signerTitle'] = 'Enter your title.'
  if (Object.keys(errors).length > 0) return { ok: false, status: 400, error: 'Check the highlighted fields.', errors }
  if (input.version !== template.version) {
    return { ok: false, status: 409, error: `The ${template.title} has been updated since this page loaded. Reload and review it again.` }
  }

  const { error } = await supabase.from('agreement_acceptances').insert({
    clinic_id:        input.clinicId,
    agreement:        input.agreement,
    template_version: template.version,
    text_sha256:      agreementSha256(template.text),
    signer_name:      signerName,
    signer_title:     signerTitle,
    user_id:          input.userId,
  })
  if (error) {
    console.error(`[agreements] acceptance not recorded | clinic=${input.clinicId} agreement=${input.agreement}: ${error.message}`)
    return { ok: false, status: 500, error: 'Your acceptance could not be recorded. Try again.' }
  }
  console.info(`[agreements] accepted | clinic=${input.clinicId} agreement=${input.agreement} version=${template.version}`)
  return { ok: true, version: template.version }
}

export interface AgreementNotice {
  agreements: Array<{ key: AgreementKey; title: string; version: string }>
}

/**
 * The dashboard banner: for the clinic admin only, the agreements whose
 * current version is newer than the clinic's latest acceptance. A read
 * that fails shows no banner; ordering is never blocked by it.
 */
export async function loadAgreementNotice(supabase: Supabase, user: (ClaimsUser & { id?: string; user_metadata?: unknown }) | null | undefined): Promise<AgreementNotice | null> {
  const clinicId = getUserClinicId(user)
  if (getUserRole(user) !== 'clinic_admin' || !clinicId) return null
  try {
    const agreements = await loadClinicAgreements(supabase, clinicId)
    const due = AGREEMENT_KEYS.filter(k => agreements[k].updateAvailable)
      .map(k => ({ key: k, title: agreements[k].current.title, version: agreements[k].current.version }))
    return due.length > 0 ? { agreements: due } : null
  } catch (err) {
    console.error('[agreements] dashboard notice could not be read:', err instanceof Error ? err.message : err)
    return null
  }
}
