# Business Associate Agreement

_Draft v0.1 (October 9, 2026)_

> DRAFT, PENDING LEGAL REVIEW. This template has not been reviewed by counsel and is not ready for signature with real patient data. It is shown in onboarding for review only.

This Business Associate Agreement ("Agreement") is entered into between {{COVERED_ENTITY_LEGAL_NAME}} ("Covered Entity") and CompoundIQ ({{COMPOUNDIQ_LEGAL_ENTITY}}) ("Business Associate"), each a "Party", and is effective on the date it is accepted in the CompoundIQ onboarding portal (the "Effective Date").


## 1. Definitions

Capitalized terms used but not defined in this Agreement have the meanings given in the HIPAA Rules, including: Breach, Data Aggregation, Designated Record Set, Disclosure, Health Care Operations, Individual, Minimum Necessary, Notice of Privacy Practices, Protected Health Information ("PHI"), Electronic Protected Health Information ("ePHI"), Required by Law, Secretary, Security Incident, Subcontractor, Unsecured Protected Health Information, and Use.

"HIPAA Rules" means the Privacy, Security, Breach Notification, and Enforcement Rules at 45 CFR Part 160 and Part 164, as amended, including by the HITECH Act.

"Services" means the CompoundIQ platform services described in the CompoundIQ Terms of Service accepted by Covered Entity, including electronic prescription ordering for compounded medications, transmission of prescriptions to licensed pharmacies, patient payment collection, order status tracking, and related support.


## 2. Obligations and Activities of Business Associate

Business Associate agrees to:

- Not Use or Disclose PHI other than as permitted or required by this Agreement or as Required by Law.
- Use appropriate safeguards, and comply with Subpart C of 45 CFR Part 164 with respect to ePHI, to prevent Use or Disclosure of PHI other than as provided for by this Agreement.
- Report to Covered Entity any Use or Disclosure of PHI not provided for by this Agreement of which it becomes aware, including Breaches of Unsecured PHI as required by 45 CFR 164.410, and any Security Incident of which it becomes aware, without unreasonable delay and in no case later than {{BREACH_NOTICE_DAYS}} calendar days after discovery. The Parties agree that this paragraph is notice of the ongoing existence of unsuccessful Security Incidents (such as pings, port scans, and blocked log-in attempts) for which no further notice is required.
- In accordance with 45 CFR 164.502(e)(1)(ii) and 164.308(b)(2), ensure that any Subcontractors that create, receive, maintain, or transmit PHI on behalf of Business Associate agree in writing to the same restrictions, conditions, and requirements that apply to Business Associate with respect to such information.
- Make available PHI in a Designated Record Set to Covered Entity as necessary to satisfy Covered Entity's obligations under 45 CFR 164.524, within {{ACCESS_DAYS}} days of a request.
- Make any amendment to PHI in a Designated Record Set as directed or agreed to by Covered Entity under 45 CFR 164.526, or take other measures as necessary to satisfy Covered Entity's obligations under 45 CFR 164.526.
- Maintain and make available the information required to provide an accounting of Disclosures to Covered Entity as necessary to satisfy Covered Entity's obligations under 45 CFR 164.528.
- To the extent Business Associate carries out an obligation of Covered Entity under Subpart E of 45 CFR Part 164, comply with the requirements of Subpart E that apply to Covered Entity in the performance of that obligation.
- Make its internal practices, books, and records available to the Secretary for purposes of determining compliance with the HIPAA Rules.
- Limit its Uses and Disclosures of, and requests for, PHI to the Minimum Necessary to accomplish the intended purpose.

## 3. Permitted Uses and Disclosures by Business Associate

- Business Associate may Use or Disclose PHI as necessary to perform the Services, including Disclosure of prescription and shipping information to the licensed pharmacy selected for an order, and Disclosure to payment processors only to the extent necessary to collect payment.
- Business Associate may Use or Disclose PHI as Required by Law.
- Business Associate may not Use or Disclose PHI in a manner that would violate Subpart E of 45 CFR Part 164 if done by Covered Entity, except for the specific Uses and Disclosures set out below.
- Business Associate may Use PHI for its proper management and administration or to carry out its legal responsibilities, and may Disclose PHI for those purposes if the Disclosure is Required by Law, or if Business Associate obtains reasonable assurances from the recipient that the information will remain confidential, will be Used or further Disclosed only as Required by Law or for the purposes for which it was Disclosed, and that the recipient will notify Business Associate of any instance of which it is aware in which the confidentiality of the information has been breached.
- Business Associate may provide Data Aggregation services relating to the Health Care Operations of Covered Entity.
- Business Associate may de-identify PHI in accordance with 45 CFR 164.514(a) through (c). {{DEIDENTIFIED_DATA_USE: counsel to confirm whether de-identified data may be used for product analytics}}
- Business Associate will not sell PHI and will not Use or Disclose PHI for marketing, except as permitted by the HIPAA Rules.

## 4. Obligations of Covered Entity

- Covered Entity shall notify Business Associate of any limitation in its Notice of Privacy Practices, any change in or revocation of an Individual's permission, and any restriction on Use or Disclosure that Covered Entity has agreed to under 45 CFR 164.522, to the extent it may affect Business Associate's Use or Disclosure of PHI.
- Covered Entity shall not request Business Associate to Use or Disclose PHI in any manner that would not be permissible under Subpart E of 45 CFR Part 164 if done by Covered Entity.
- Covered Entity is responsible for obtaining any patient consents its jurisdiction requires, including consent to receive text messages, before entering a patient's contact information in the Services.

## 5. Term and Termination

- Term. This Agreement is effective on the Effective Date and continues until the Terms of Service between the Parties end, unless terminated earlier under this section.
- Termination for cause. Either Party may terminate this Agreement if the other Party has violated a material term and has not cured the violation within {{CURE_DAYS}} days of written notice.
- Obligations on termination. On termination, Business Associate shall return to Covered Entity or destroy all PHI received from, or created or received by Business Associate on behalf of, Covered Entity that Business Associate still maintains in any form, and retain no copies. Where return or destruction is not feasible, including where records must be retained under applicable pharmacy, prescription, or payment record-keeping laws, Business Associate shall extend the protections of this Agreement to that PHI and limit further Uses and Disclosures to those purposes that make return or destruction infeasible, for as long as Business Associate maintains it. {{RETENTION_SCHEDULE: counsel to confirm against the CompoundIQ retention schedule}}
- Survival. The obligations of Business Associate under this section survive termination of this Agreement.

## 6. Miscellaneous

- Regulatory references. A reference in this Agreement to a section of the HIPAA Rules means the section as in effect or as amended.
- Amendment. The Parties agree to amend this Agreement as necessary for compliance with the HIPAA Rules and any other applicable law.
- Interpretation. Any ambiguity in this Agreement shall be interpreted to permit compliance with the HIPAA Rules.
- No third-party beneficiaries. Nothing in this Agreement confers any rights on any person other than the Parties.
- Governing law. {{GOVERNING_LAW}}
- Electronic acceptance. Acceptance of this Agreement in the CompoundIQ onboarding portal by an authorized representative of Covered Entity, recorded with the representative's name, title, account, date and time, and the version and text of this Agreement, constitutes execution by Covered Entity.

## Notes for counsel (remove before use)

- Fill every {{PLACEHOLDER}}: legal entity names, breach notice period (HIPAA outer limit is 60 days; 5 to 10 business days is common), access request period, cure period, governing law.
- Pharmacy onboarding uses this same template. Confirm whether a BAA is the right instrument between CompoundIQ and a dispensing pharmacy, which is itself a covered entity receiving PHI for treatment, or whether a different data-sharing agreement fits better.
- Confirm the de-identified data clause, the retention carve-out, and whether a limitation of liability or indemnification section is wanted.
- This draft follows the structure of the HHS sample business associate agreement provisions and is not legal advice.
