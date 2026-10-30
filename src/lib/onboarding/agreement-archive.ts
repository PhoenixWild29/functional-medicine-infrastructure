// ============================================================
// Superseded agreement texts, kept word for word
// ============================================================
//
// Every version a clinic or pharmacy may already have accepted, exactly
// as it was shown (src/content/legal/archive/, via
// legal-texts.generated.ts). An acceptance records its version and the
// SHA-256 of the text; "View text" shows an archived text only when both
// match (lib/agreements/clinic-agreements, lib/pharmacy-onboarding/agreement).
// Never offered for acceptance.
//
// Server use only: keeps the old texts out of the browser bundles that
// import the current ones (./agreement-texts).

import {
  BAA_V0_1_ORIGINAL_TEXT, BAA_V0_1_1_TEXT, CLINIC_TERMS_DRAFT_2026_10_2_TEXT, PHARMACY_TERMS_V0_1_TEXT, PHARMACY_TERMS_V1_0_TEXT,
} from './legal-texts.generated'

export type ArchivedAgreementKey = 'baa' | 'terms' | 'pharmacy_terms'

export interface ArchivedAgreement {
  key:     ArchivedAgreementKey
  version: string
  file:    string
  text:    string
}

export const AGREEMENT_ARCHIVE: ReadonlyArray<ArchivedAgreement> = [
  { key: 'baa',            version: 'v0.1',                  file: 'src/content/legal/archive/baa-draft-v0.1-original.md',      text: BAA_V0_1_ORIGINAL_TEXT },
  { key: 'baa',            version: 'v0.1.1',                file: 'src/content/legal/archive/baa-draft-v0.1.1.md',             text: BAA_V0_1_1_TEXT },
  { key: 'terms',          version: 'terms-draft-2026-10.2', file: 'src/content/legal/archive/clinic-terms-draft-2026-10.2.md', text: CLINIC_TERMS_DRAFT_2026_10_2_TEXT },
  { key: 'pharmacy_terms', version: 'v0.1',                  file: 'src/content/legal/archive/pharmacy-terms-draft-v0.1.md',    text: PHARMACY_TERMS_V0_1_TEXT },
  // v1.1 (Oct 30): two-step sign-in when CompoundIQ requires it for all users.
  { key: 'pharmacy_terms', version: 'v1.0',                  file: 'src/content/legal/archive/pharmacy-terms-v1.0.md',          text: PHARMACY_TERMS_V1_0_TEXT },
]

/** The archived text of one version of an agreement, or null. */
export function archivedAgreementText(key: ArchivedAgreementKey, version: string): string | null {
  return AGREEMENT_ARCHIVE.find(a => a.key === key && a.version === version)?.text ?? null
}
