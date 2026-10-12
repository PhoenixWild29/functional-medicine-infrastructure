// ============================================================
// Agreements: the BAA and the terms of service (final, v1.0)
// ============================================================
//
// The BAA and the Clinic Terms of Service a clinic accepts during
// onboarding (and again when a new version is published), and the
// Pharmacy Terms of Service a pharmacy accepts with the BAA. When a text
// changes, add a new file under src/content/legal/ AND bump the version:
// an acceptance records the version and the SHA-256 of the exact text the
// signer was shown, so a changed text with an unchanged version would make
// old records lie. Move the text it replaces into src/content/legal/archive/
// and list it in ./agreement-archive.ts, so "View text" can still show it.
//
// Pure data (no Node APIs): the wizard imports this in the browser. The
// hash is computed on the server (./agreements.ts).
//
// Texts: src/content/legal/baa-v1.0.md, clinic-terms-v1.0.md and
// pharmacy-terms-v1.0.md, via legal-texts.generated.ts
// (scripts/gen-legal-texts.mjs; a test keeps the two identical).
//
// Pharmacy Terms of Service: key "pharmacy_terms". It is not one of the
// clinic's AGREEMENTS, so the clinic agreement routes (isAgreementKey)
// never take it.

import { BAA_V1_0_TEXT, CLINIC_TERMS_V1_0_TEXT, PHARMACY_TERMS_V1_0_TEXT } from './legal-texts.generated'

export type AgreementKey = 'baa' | 'terms'

export interface AgreementTemplate<K extends string = AgreementKey> {
  key:     K
  title:   string
  version: string
  text:    string
}



export const AGREEMENTS: Record<AgreementKey, AgreementTemplate> = {
  baa:   { key: 'baa',   title: 'Business Associate Agreement', version: 'v1.0', text: BAA_V1_0_TEXT },
  terms: { key: 'terms', title: 'Terms of Service',             version: 'v1.0', text: CLINIC_TERMS_V1_0_TEXT },
}

export const PHARMACY_TERMS: AgreementTemplate<'pharmacy_terms'> = {
  key: 'pharmacy_terms', title: 'Pharmacy Terms of Service', version: 'v1.0', text: PHARMACY_TERMS_V1_0_TEXT,
}

export function isAgreementKey(v: unknown): v is AgreementKey {
  return v === 'baa' || v === 'terms'
}
