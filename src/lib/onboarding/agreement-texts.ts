// ============================================================
// Onboarding agreements: DRAFT templates (pending legal review)
// ============================================================
//
// The BAA and the terms of service a clinic accepts during onboarding.
// Both are DRAFTS pending legal review: the wizard says so in a banner,
// and the version string says "draft". When counsel supplies the final
// text, replace it here AND bump the version: an acceptance records the
// version and the SHA-256 of the exact text the signer was shown, so a
// changed text with an unchanged version would make old records lie.
//
// Pure data (no Node APIs): the wizard imports this in the browser. The
// hash is computed on the server (./agreements.ts).
//
// BAA: src/content/legal/baa-draft-v0.1.md (PR #213), version "v0.1", via
// legal-texts.generated.ts (scripts/gen-legal-texts.mjs; a test keeps the
// two identical). Terms: our own draft, below, until counsel's arrives.

import { BAA_V0_1_TEXT } from './legal-texts.generated'

export type AgreementKey = 'baa' | 'terms'

export interface AgreementTemplate {
  key:     AgreementKey
  title:   string
  version: string
  draft:   true
  text:    string
}


const TERMS_TEXT = `COMPOUNDIQ TERMS OF SERVICE (DRAFT TEMPLATE)

These Terms govern the clinic's use of CompoundIQ ("Service").

1. Accounts. The clinic admin is responsible for the accounts they invite and for keeping sign-in credentials, including two-step verification, secure. Each person uses their own account.

2. Clinical responsibility. Prescribing decisions are made solely by the clinic's licensed providers. CompoundIQ does not practice medicine or pharmacy and does not give medical advice.

3. Licensure and credentials. The clinic keeps its providers' NPIs, state licenses and any DEA registrations current, and only providers licensed in the patient's state prescribe for that patient.

4. Pharmacies. Orders are fulfilled by independent licensed compounding pharmacies, which are responsible for compounding, dispensing and shipping.

5. Payments. Patient payments are collected through CompoundIQ's payment processor. Payouts to the clinic are set up separately and are subject to the processor's terms. Platform fees are as agreed with CompoundIQ.

6. Acceptable use. The clinic will use the Service lawfully, will not attempt to access other clinics' data, and will not interfere with the Service's operation or security.

7. Privacy and security. PHI is handled under the Business Associate Agreement between the clinic and CompoundIQ.

8. Availability and changes. CompoundIQ may update the Service and these Terms, with notice for material changes.

9. Termination. Either party may end the clinic's use of the Service on written notice. Records are kept or returned as required by law and the Business Associate Agreement.

10. Limitation of liability. To the extent permitted by law, CompoundIQ's liability is limited as set out in the final agreement.

THIS IS A DRAFT TEMPLATE PENDING LEGAL REVIEW. It will be replaced by the final terms before general availability.`

export const AGREEMENTS: Record<AgreementKey, AgreementTemplate> = {
  baa:   { key: 'baa',   title: 'Business Associate Agreement', version: 'v0.1',                  draft: true, text: BAA_V0_1_TEXT },
  terms: { key: 'terms', title: 'Terms of Service',             version: 'terms-draft-2026-10.2', draft: true, text: TERMS_TEXT },
}

export const DRAFT_BANNER = 'Draft, pending legal review'

export function isAgreementKey(v: unknown): v is AgreementKey {
  return v === 'baa' || v === 'terms'
}
