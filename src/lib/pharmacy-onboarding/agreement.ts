// ============================================================
// Pharmacy BAA and terms: the DRAFT template
// ============================================================
//
// DRAFT, pending legal review. Shown with that banner on every screen it
// appears on. The acceptance record (pharmacy_agreement_acceptances,
// append-only) stores the key, the version and the SHA-256 of this exact
// text, so what was accepted can be proven later. Change the text, change
// the version: an acceptance of an older version is refused, never
// silently carried over.

import { createHash } from 'node:crypto'

const TEXT = `CompoundIQ Pharmacy Business Associate Agreement and Terms of Participation

DRAFT, PENDING LEGAL REVIEW. This text is a placeholder for review and is not final.

1. Parties. This agreement is between CompoundIQ ("CompoundIQ") and the pharmacy named in this onboarding application ("Pharmacy").

2. Business Associate terms. To the extent Pharmacy receives, maintains or transmits protected health information through CompoundIQ, each party will comply with HIPAA and its implementing regulations (45 CFR Parts 160 and 164), use and disclose protected health information only as needed to fill and ship prescriptions sent through CompoundIQ, apply administrative, physical and technical safeguards, report any security incident or breach without unreasonable delay, ensure subcontractors agree to the same restrictions, and return or destroy protected health information at termination where feasible.

3. Licensure. Pharmacy will fill prescriptions only for states in which it holds an active, unexpired license that covers the product (including sterile compounding where required), will keep its license information current in CompoundIQ, and will notify CompoundIQ of any lapse, discipline or change in scope.

4. Controlled substances. Pharmacy will not receive controlled substance prescriptions through CompoundIQ. Any DEA registration provided is recorded only.

5. Order handling. Pharmacy will acknowledge, fill and ship orders received through its chosen method (API, portal or fax), keep order status current, and follow the shipping and cold-chain commitments in its profile.

6. Pricing and catalog. Pharmacy is responsible for the accuracy of its catalog and wholesale prices.

7. Term. Either party may end participation on written notice. Sections 2 and 3 survive as required by law.

By accepting, the signer confirms they are authorized to bind Pharmacy.`

export const AGREEMENT = {
  key:     'pharmacy_baa_terms',
  version: 'draft-2026-10-09',
  draft:   true,
  banner:  'Draft, pending legal review',
  title:   'Business Associate Agreement and Terms of Participation',
  text:    TEXT,
} as const

export function agreementTextSha256(text: string = AGREEMENT.text): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}
