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

export type AgreementKey = 'baa' | 'terms'

export interface AgreementTemplate {
  key:     AgreementKey
  title:   string
  version: string
  draft:   true
  text:    string
}

const BAA_TEXT = `BUSINESS ASSOCIATE AGREEMENT (DRAFT TEMPLATE)

This Business Associate Agreement ("Agreement") is entered into between the clinic identified in its CompoundIQ account ("Covered Entity") and CompoundIQ ("Business Associate").

1. Purpose. Business Associate provides software that lets Covered Entity prescribe compounded medications, route orders to compounding pharmacies and collect patient payments. In doing so Business Associate may create, receive, maintain or transmit protected health information ("PHI") on behalf of Covered Entity, as those terms are defined in the HIPAA Privacy, Security and Breach Notification Rules (45 CFR Parts 160 and 164).

2. Permitted uses and disclosures. Business Associate will use and disclose PHI only to provide the services, as this Agreement permits or requires, or as required by law. Business Associate will not use or disclose PHI in a way that would violate the HIPAA Rules if done by Covered Entity, and will limit PHI to the minimum necessary.

3. Safeguards. Business Associate will use appropriate administrative, physical and technical safeguards, and comply with Subpart C of 45 CFR Part 164, to prevent use or disclosure of electronic PHI other than as provided by this Agreement.

4. Reporting. Business Associate will report to Covered Entity any use or disclosure of PHI not provided for by this Agreement, and any security incident and breach of unsecured PHI, without unreasonable delay and in no case later than the time required by 45 CFR 164.410.

5. Subcontractors. Business Associate will ensure that any subcontractor that creates, receives, maintains or transmits PHI on its behalf agrees in writing to the same restrictions and conditions that apply to Business Associate.

6. Individual rights. Business Associate will make PHI available to Covered Entity as needed for Covered Entity to meet its obligations for access, amendment and an accounting of disclosures under 45 CFR 164.524, 164.526 and 164.528.

7. Books and records. Business Associate will make its internal practices, books and records relating to PHI available to the Secretary of Health and Human Services for determining compliance with the HIPAA Rules.

8. Term and termination. This Agreement lasts as long as Business Associate holds PHI for Covered Entity. Either party may terminate it if the other materially breaches it and does not cure the breach within a reasonable time. On termination Business Associate will return or destroy PHI where feasible, and otherwise extend these protections to it.

9. Miscellaneous. This Agreement is interpreted to permit compliance with the HIPAA Rules. Any ambiguity is resolved in favor of a meaning that complies with them.

THIS IS A DRAFT TEMPLATE PENDING LEGAL REVIEW. It will be replaced by the final agreement before general availability.`

const TERMS_TEXT = `COMPOUNDIQ TERMS OF SERVICE (DRAFT TEMPLATE)

These Terms govern the clinic's use of CompoundIQ ("Service").

1. Accounts. The clinic admin is responsible for the accounts they invite and for keeping sign-in credentials, including two-step verification, secure. Each person uses their own account.

2. Clinical responsibility. Prescribing decisions are made solely by the clinic's licensed providers. CompoundIQ does not practice medicine or pharmacy and does not give medical advice.

3. Licensure and credentials. The clinic keeps its providers' NPIs, state licenses and any DEA registrations current, and only providers licensed in the patient's state prescribe for that patient.

4. Pharmacies. Orders are fulfilled by independent licensed compounding pharmacies, which are responsible for compounding, dispensing and shipping.

5. Payments. Patient payments are processed by Stripe. Payouts to the clinic require an active Stripe Connect account and are subject to Stripe's terms. Platform fees are as agreed with CompoundIQ.

6. Acceptable use. The clinic will use the Service lawfully, will not attempt to access other clinics' data, and will not interfere with the Service's operation or security.

7. Privacy and security. PHI is handled under the Business Associate Agreement between the clinic and CompoundIQ.

8. Availability and changes. CompoundIQ may update the Service and these Terms, with notice for material changes.

9. Termination. Either party may end the clinic's use of the Service on written notice. Records are kept or returned as required by law and the Business Associate Agreement.

10. Limitation of liability. To the extent permitted by law, CompoundIQ's liability is limited as set out in the final agreement.

THIS IS A DRAFT TEMPLATE PENDING LEGAL REVIEW. It will be replaced by the final terms before general availability.`

export const AGREEMENTS: Record<AgreementKey, AgreementTemplate> = {
  baa:   { key: 'baa',   title: 'Business Associate Agreement', version: 'baa-draft-2026-10.1',   draft: true, text: BAA_TEXT },
  terms: { key: 'terms', title: 'Terms of Service',             version: 'terms-draft-2026-10.1', draft: true, text: TERMS_TEXT },
}

export const DRAFT_BANNER = 'Draft, pending legal review'

export function isAgreementKey(v: unknown): v is AgreementKey {
  return v === 'baa' || v === 'terms'
}
