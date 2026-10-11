// ============================================================
// Pharmacy agreements: the BAA and the Pharmacy Terms of Service
// ============================================================
//
// Version, title and text come from the one shared source
// (src/lib/onboarding/agreement-texts.ts: AGREEMENTS.baa, which the clinic
// flow uses too, and PHARMACY_TERMS), generated from src/content/legal/
// (scripts/gen-legal-texts.mjs, kept identical by a test). Nothing is
// pinned here, so a new text and version there is what pharmacies are
// shown, hash and accept. DRAFT, pending legal review: shown with that
// banner.
//
// An acceptance (pharmacy_agreement_acceptances, append-only) stores the
// template_key, the version and the SHA-256 of the exact text, so what
// was accepted can be proven later. Every read of that table is filtered
// by template_key: a terms acceptance is never a BAA acceptance.
//
// acceptedText() finds the text an acceptance points to: the current
// text, or a superseded one kept word for word (src/content/legal/archive),
// and only when its hash is the one recorded.
//
// Server only (node:crypto).

import { createHash } from 'node:crypto'
import { AGREEMENTS, DRAFT_BANNER, PHARMACY_TERMS } from '@/lib/onboarding/agreement-texts'
import { BAA_V0_1_ORIGINAL_TEXT } from '@/lib/onboarding/legal-texts.generated'

export type PharmacyAgreementKey = 'baa' | 'pharmacy_terms'
export const PHARMACY_AGREEMENT_KEYS: ReadonlyArray<PharmacyAgreementKey> = ['baa', 'pharmacy_terms']

export function isPharmacyAgreementKey(v: unknown): v is PharmacyAgreementKey {
  return v === 'baa' || v === 'pharmacy_terms'
}

export interface PharmacyAgreement {
  key:        PharmacyAgreementKey
  version:    string
  title:      string
  draft:      boolean
  banner:     string
  text:       string
  textSha256: string
}

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')

const SOURCES: Record<PharmacyAgreementKey, { version: string; title: string; draft: boolean; text: string }> = {
  baa:            AGREEMENTS.baa,
  pharmacy_terms: PHARMACY_TERMS,
}

/** The current version of an agreement, with the hash of its exact text. */
export function pharmacyAgreement(key: PharmacyAgreementKey): PharmacyAgreement {
  const s = SOURCES[key]
  return { key, version: s.version, title: s.title, draft: s.draft, banner: DRAFT_BANNER, text: s.text, textSha256: sha256(s.text) }
}

/** Superseded texts a pharmacy may have accepted. Never offered for acceptance. */
const ARCHIVE: ReadonlyArray<{ key: PharmacyAgreementKey; version: string; text: string }> = [
  { key: 'baa', version: 'v0.1', text: BAA_V0_1_ORIGINAL_TEXT },
]

/** The exact text of an accepted version, or null when it is not on record here. */
export function acceptedText(key: PharmacyAgreementKey, version: string, textSha256: string): string | null {
  const candidates = [{ key, version: SOURCES[key].version, text: SOURCES[key].text }, ...ARCHIVE.filter(a => a.key === key)]
  const hit = candidates.find(c => c.version === version && sha256(c.text) === textSha256)
  return hit ? hit.text : null
}

// The BAA, as the rest of the pharmacy flow has always named it.
const BAA = pharmacyAgreement('baa')

export const AGREEMENT = {
  key:     BAA.key,
  version: BAA.version,
  draft:   BAA.draft,
  banner:  BAA.banner,
  title:   BAA.title,
} as const

/** The BAA text, exactly as the shared source has it (LF). */
export function agreementText(): string {
  return BAA.text
}

export function agreementTextSha256(text: string = agreementText()): string {
  return sha256(text)
}
