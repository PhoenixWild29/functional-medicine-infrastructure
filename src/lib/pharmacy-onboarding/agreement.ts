// ============================================================
// Pharmacy BAA: the shared onboarding template
// ============================================================
//
// Version, title and text come from the one shared source the clinic flow
// uses too: AGREEMENTS.baa in src/lib/onboarding/agreement-texts.ts, whose
// text is generated from src/content/legal/ (scripts/gen-legal-texts.mjs,
// kept identical by a test). Nothing is pinned here, so a new text and
// version there (e.g. v0.1 to v0.1.1) is what pharmacies are shown, hash
// and accept. DRAFT, pending legal review: shown with that banner.
//
// The acceptance record (pharmacy_agreement_acceptances, append-only)
// stores the key, the version and the SHA-256 of this exact text, so what
// was accepted can be proven later. An acceptance of another version is
// not current: the pharmacy accepts the new one.

import { createHash } from 'node:crypto'
import { AGREEMENTS, DRAFT_BANNER } from '@/lib/onboarding/agreement-texts'

const BAA = AGREEMENTS.baa

export const AGREEMENT = {
  key:     BAA.key,
  version: BAA.version,
  draft:   BAA.draft,
  banner:  DRAFT_BANNER,
  title:   BAA.title,
} as const

/** The agreement text, exactly as the shared source has it (LF). */
export function agreementText(): string {
  return BAA.text
}

export function agreementTextSha256(text: string = agreementText()): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}
