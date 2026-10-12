// ============================================================
// Pharmacy agreement acceptances: every read, by template_key
// ============================================================
//
// pharmacy_agreement_acceptances holds the BAA ('baa') and the Pharmacy
// Terms of Service ('pharmacy_terms') rows side by side. Every read here
// is filtered by template_key, so a terms row is never taken for a BAA
// (or the reverse) by the wizard, submit, ops review, approve or the
// pharmacy's Agreements page. Rows are append-only: a new version is a
// new row; what was accepted earlier stays on record.
//
// Server only.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Fail } from './invites'
import { PHARMACY_AGREEMENT_KEYS, acceptedText, isPharmacyAgreementKey, pharmacyAgreement, type PharmacyAgreementKey } from './agreement'

export interface AcceptanceRow {
  acceptance_id:    string
  signer_name:      string
  signer_title:     string
  accepted_at:      string
  template_key:     string
  template_version: string
  text_sha256:      string
}

const COLUMNS = 'acceptance_id, signer_name, signer_title, accepted_at, template_key, template_version, text_sha256'
const UNAVAILABLE = (what: string): Fail => ({ ok: false, status: 503, error: `${what} Try again.` })

/** The latest acceptance of one agreement (of one version, when given). */
export async function latestAcceptance(
  db: SupabaseClient, pharmacyId: string, key: PharmacyAgreementKey, version?: string,
): Promise<{ ok: true; row: AcceptanceRow | null } | { ok: false }> {
  let q = db.from('pharmacy_agreement_acceptances').select(COLUMNS).eq('pharmacy_id', pharmacyId).eq('template_key', key)
  if (version !== undefined) q = q.eq('template_version', version)
  const { data, error } = await q.order('accepted_at', { ascending: false }).limit(1)
  if (error) return { ok: false }
  return { ok: true, row: ((data ?? []) as AcceptanceRow[])[0] ?? null }
}

/** Each agreement's acceptance of its CURRENT version, or null. */
export async function currentAcceptances(
  db: SupabaseClient, pharmacyId: string,
): Promise<{ ok: true; baa: AcceptanceRow | null; terms: AcceptanceRow | null } | { ok: false }> {
  const [baa, terms] = await Promise.all([
    latestAcceptance(db, pharmacyId, 'baa', pharmacyAgreement('baa').version),
    latestAcceptance(db, pharmacyId, 'pharmacy_terms', pharmacyAgreement('pharmacy_terms').version),
  ])
  if (!baa.ok || !terms.ok) return { ok: false }
  return { ok: true, baa: baa.row, terms: terms.row }
}

// ── /pharmacy/agreements ─────────────────────────────────────

export interface AcceptedItem {
  acceptanceId: string
  version:      string
  signerName:   string
  signerTitle:  string
  acceptedAt:   string
  current:      boolean
}

export interface AgreementSummary {
  key:                 PharmacyAgreementKey
  title:               string
  currentVersion:      string
  acceptances:         AcceptedItem[]
  acceptedCurrent:     boolean
  /** An older version was accepted and the current one is newer. */
  newVersionAvailable: boolean
}

export async function listPharmacyAgreements(db: SupabaseClient, pharmacyId: string): Promise<{ ok: true; agreements: AgreementSummary[] } | Fail> {
  const reads = await Promise.all(PHARMACY_AGREEMENT_KEYS.map(key =>
    db.from('pharmacy_agreement_acceptances').select(COLUMNS).eq('pharmacy_id', pharmacyId).eq('template_key', key).order('accepted_at', { ascending: false })))
  if (reads.some(r => r.error)) return UNAVAILABLE('Your agreements could not be read.')
  const agreements = PHARMACY_AGREEMENT_KEYS.map((key, i) => {
    const current = pharmacyAgreement(key)
    const rows = (reads[i]!.data ?? []) as AcceptanceRow[]
    const acceptances = rows.map(r => ({
      acceptanceId: r.acceptance_id, version: r.template_version, signerName: r.signer_name, signerTitle: r.signer_title,
      acceptedAt: r.accepted_at, current: r.template_version === current.version,
    }))
    const acceptedCurrent = acceptances.some(a => a.current)
    return { key, title: current.title, currentVersion: current.version, acceptances, acceptedCurrent, newVersionAvailable: !acceptedCurrent && acceptances.length > 0 }
  })
  return { ok: true, agreements }
}

export interface AcceptedAgreementText {
  key:         PharmacyAgreementKey
  title:       string
  version:     string
  signerName:  string
  signerTitle: string
  acceptedAt:  string
  /** The exact text accepted; null when that version's text is not on record here. */
  text:        string | null
}

/** One acceptance of this pharmacy, with the text that was accepted. */
export async function acceptedAgreementText(
  db: SupabaseClient, pharmacyId: string, acceptanceId: string,
): Promise<{ ok: true; acceptance: AcceptedAgreementText } | Fail> {
  const { data, error } = await db.from('pharmacy_agreement_acceptances').select(COLUMNS)
    .eq('acceptance_id', acceptanceId).eq('pharmacy_id', pharmacyId).in('template_key', [...PHARMACY_AGREEMENT_KEYS]).maybeSingle()
  if (error) return UNAVAILABLE('The agreement could not be read.')
  const r = data as AcceptanceRow | null
  if (!r || !isPharmacyAgreementKey(r.template_key)) return { ok: false, status: 404, error: 'That agreement was not found.' }
  return {
    ok: true,
    acceptance: {
      key: r.template_key, title: pharmacyAgreement(r.template_key).title, version: r.template_version,
      signerName: r.signer_name, signerTitle: r.signer_title, acceptedAt: r.accepted_at,
      text: acceptedText(r.template_key, r.template_version, r.text_sha256),
    },
  }
}
