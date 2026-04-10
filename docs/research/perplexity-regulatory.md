# Research Area 6: Regulatory Requirements for Electronic Compounding Prescription Platforms

*Research compiled: April 2026*

---

## Table of Contents

1. [Required Fields on a Compounding Prescription](#1-required-fields-on-a-compounding-prescription)
2. [EPCS: Electronic Prescribing of Controlled Substances](#2-epcs-electronic-prescribing-of-controlled-substances)
3. [DEA UI Requirements (21 CFR 1311)](#3-dea-ui-requirements-21-cfr-1311)
4. [Compounded vs. Manufactured Medications — Regulatory Differences](#4-compounded-vs-manufactured-medications--regulatory-differences)
5. [State Board of Pharmacy Regulations](#5-state-board-of-pharmacy-regulations)
6. [HIPAA and PHI Considerations](#6-hipaa-and-phi-considerations)
7. [Summary: Key UI Design Implications](#7-summary-key-ui-design-implications)

---

## 1. Required Fields on a Compounding Prescription

### 1.1 Federal Requirements — 21 CFR 1306

The DEA specifies distinct field requirements based on controlled substance schedule. These apply to all prescriptions, including compounded preparations containing controlled substances.

**Schedule II Controlled Substances** ([21 CFR § 1306.05(a)](https://www.deadiversion.usdoj.gov/mtgs/pract_awareness/conf_2018/sept_2018/hershey/miller.pdf)):

| # | Required Field |
|---|----------------|
| 1 | Date of issuance |
| 2 | Patient's full name |
| 3 | Patient's address |
| 4 | Drug name |
| 5 | Drug strength |
| 6 | Dosage form |
| 7 | Quantity prescribed |
| 8 | Directions for use |
| 9 | Practitioner's name |
| 10 | DEA registered address of practitioner |
| 11 | Practitioner's DEA registration number |
| 12 | Practitioner's signature (no stamps) |

**Schedule III–V Controlled Substances** ([21 CFR § 1306.21(a)](https://www.deadiversion.usdoj.gov/mtgs/pract_awareness/conf_2018/sept_2018/hershey/miller.pdf)): Same 12 fields plus:

| # | Additional Field |
|---|------------------|
| 13 | Number of refills authorized (maximum: original + 5 refills) |

**Note on Opioid Treatment (X-waiver):** Prescriptions for Schedule III–V narcotic drugs approved for detoxification or maintenance treatment must also include the practitioner's DEA "X number" per [21 CFR § 1306.05(b)](https://www.deadiversion.usdoj.gov/mtgs/pract_awareness/conf_2018/sept_2018/hershey/miller.pdf).

**Note on NPI:** The NPI (National Provider Identifier) is not explicitly required by DEA regulations under 21 CFR 1306, but is required by many state boards of pharmacy and payers. Most platforms collect it as a standard field.

### 1.2 Non-Controlled Substance Prescriptions

Non-controlled prescriptions for compounded medications are governed by state pharmacy boards, not DEA. The standard required fields mirror the DEA structure but the DEA registration number is replaced by the prescriber's state license number. Core fields common across virtually all states: patient name/DOB/address, prescriber name/address/credentials, medication name, strength/dosage form, quantity, directions, refills, date.

### 1.3 Compounding-Specific Required Fields

Compounded prescriptions carry **additional requirements** beyond a standard prescription, driven by federal law (Section 503A of the FD&C Act) and state boards:

#### (a) "Clinically Necessary" Notation

Under [Section 503A of the FD&C Act](https://www.fda.gov/files/drugs/published/Prescription-Requirement-Under-Section-503A-of-the-Federal-Food--Drug--and-Cosmetic-Act-Guidance-for-Industry.pdf), for a 503A pharmacy to qualify for exemptions from FDA approval requirements, the prescription must be for an **identified individual patient** and must indicate that the compounded product is clinically necessary for that patient. The [Brookings Institution's analysis](https://www.brookings.edu/articles/fda-oversight-of-drug-manufacturing-and-compounding-a-comparison/) notes that "the prescriber must include a notation on the prescription that the compounded product is needed as compared to the approved version (e.g., compound without dye, patient allergy)."

Per [FDA's final guidance on Section 503A (December 2016)](https://www.fda.gov/files/drugs/published/Prescription-Requirement-Under-Section-503A-of-the-Federal-Food--Drug--and-Cosmetic-Act-Guidance-for-Industry.pdf), a prescription for a compounded drug product must indicate that the compounded product is "based on the receipt of a valid prescription order or a notation, approved by the prescribing practitioner, on the prescription order that a compounded product is necessary for the identified patient." This effectively creates a required field on every compound prescription: a reason or notation that compounding is clinically necessary for this specific patient.

#### (b) Formulation Details (Strength, Dosage Form, Ingredients)

Unlike a manufactured drug prescription where the drug name (brand or generic) implies a complete formulation, a compounded prescription must specify:
- The active ingredient(s) by name and strength/concentration
- The dosage form (cream, capsule, oral suspension, injectable, etc.)
- Any special instructions for preparation (e.g., specific base, vehicle, flavorings)

The ingredient list requirement is at the **pharmacy level** (internal compounding records under USP 795/797), not necessarily on the face of the prescription. However, in practice, the prescriber must specify the formulation clearly enough that the pharmacy can compound it, which requires listing the active ingredients and their concentrations. For multi-ingredient compounds, all ingredients and their quantities must be communicated.

#### (c) "Essentially a Copy" Differentiation

Both federal law and state boards (notably California since October 2025) require documentation that the compound is **not essentially a copy** of a commercially available product, or if it is similar, why clinical differences justify compounding. [California's October 2025 regulations](https://www.frierlevitt.com/articles/state-federal-legislative-developments-drug-compounding-2026/) place an affirmative duty on the pharmacist to verify and document a "clinically significant difference" — but this starts with prescriber documentation on the prescription.

### 1.4 Summary: Required Fields for a Compounding Prescription (UI Checklist)

| Field | Controlled Substance | Non-Controlled | Compounding-Specific |
|-------|---------------------|----------------|----------------------|
| Patient full name | Required | Required | — |
| Patient date of birth | State-dependent | State-dependent | — |
| Patient address | Required | Required | — |
| Date of issuance | Required | Required | — |
| Drug/compound name | Required | Required | — |
| Active ingredient(s) + strength | Required | Required | Critical for compounding |
| Dosage form | Required | Required | Must specify (not implied) |
| Quantity prescribed | Required | Required | — |
| Directions for use (sig) | Required | Required | May need extended text |
| Refills authorized | Sched III–V only | State-dependent | — |
| Prescriber name | Required | Required | — |
| Prescriber address | Required | Required | — |
| Prescriber DEA number | Required (CS only) | N/A | — |
| Prescriber NPI | State/payer requirement | State/payer requirement | — |
| Prescriber signature | Required | Required | — |
| Clinical necessity notation | Not required by DEA | N/A | **Required for 503A** |
| Reason compounding is necessary (vs. commercial product) | Not required by DEA | N/A | **Required for 503A compliance** |

---

## 2. EPCS: Electronic Prescribing of Controlled Substances

### 2.1 Federal Framework — 21 CFR Part 1311

The DEA's EPCS regulations were established by interim final rule published March 31, 2010, effective June 1, 2010, and are codified at [21 CFR Parts 1300, 1304, 1306, and 1311](https://deadiversion.usdoj.gov/faq/epcs-faq.html). EPCS applies to all Schedule II–V controlled substances, including compounded preparations containing them.

**Key points:**
- EPCS is **not mandatory** at the federal level from DEA's perspective — practitioners may still write and manually sign paper prescriptions ([DEA EPCS FAQ](https://deadiversion.usdoj.gov/faq/epcs-faq.html))
- However, many states now mandate EPCS for some or all controlled substances (see Section 5)
- An electronic controlled substance prescription is only valid if both the prescriber application and the receiving pharmacy application meet all 21 CFR Part 1311 requirements
- Applications must be certified by a DEA-approved third-party auditor before use ([DEA Approved Certification Processes](https://www.deadiversion.usdoj.gov/ecomm/thirdparty.html))

### 2.2 Two-Factor Authentication Requirements

Per [21 CFR § 1311.115](https://www.oloid.com/blog/dea-epcs-compliance-guide-for-healthcare) and confirmed by the [DEA EPCS FAQ](https://deadiversion.usdoj.gov/faq/epcs-faq.html), two-factor authentication (2FA) is required for signing all EPCS prescriptions. 2FA uses two of three factor categories:

| Factor Category | Examples | Technical Requirements |
|-----------------|----------|------------------------|
| Something you **know** | Password, PIN | Cannot be used alone — username + password = one factor only |
| Something you **have** | Hard token, cryptographic device | Must meet FIPS 140-2 Security Level 1 |
| Something you **are** | Biometric (fingerprint, iris, facial) | False match rate ≤ 0.001 (1 in 1,000); meets FIPS-201 PIV |

**Important:** A username + password combination is considered **one factor** (both are "something you know") and does not satisfy 2FA requirements. An additional factor — hardware token or biometric — is always required ([Imprivata](https://www.imprivata.com/blog/two-factor-authentication-considerations-e-prescribing-controlled-substances)).

Identity proofing must be conducted at NIST SP 800-63-1 Assurance Level 3 or higher, by a federally approved Credential Service Provider (CSP) or Certification Authority (CA) ([DEA EPCS FAQ](https://deadiversion.usdoj.gov/faq/epcs-faq.html)). Remote identity proofing at IAL2 is acceptable and was reinforced by [DEA guidance](https://www.proof.com/blog/electronic-prescription-requirements).

### 2.3 Which Compounded Medications Are Controlled?

| Drug | Schedule | DEA Citation |
|------|----------|-------------|
| Testosterone (all forms, including compounded injectable, cream, gel, pellet) | Schedule III (anabolic steroid) | [21 CFR § 1308.13](https://www.ncbi.nlm.nih.gov/books/NBK557426/) |
| Ketamine (including compounded lozenges, nasal spray, injectable) | Schedule III | [21 CFR § 1308.13(c)(7)](https://www.nyccriminalattorneys.com/how-does-the-dea-classify-ketamine/) |
| Buprenorphine (compounded formulations) | Schedule III | 21 CFR § 1308.13 |
| Codeine (products with < 90mg/dosage unit) | Schedule III | 21 CFR § 1308.13 |
| Diazepam, alprazolam, clonazepam (compounded) | Schedule IV | 21 CFR § 1308.14 |
| Tramadol (compounded) | Schedule IV | 21 CFR § 1308.14 |
| Testosterone cypionate, enanthate (most compounded androgens) | Schedule III | DEA drug scheduling |

All common telehealth compounding categories — testosterone replacement therapy (TRT), ketamine mental health treatment, and many hormone optimization compounds — involve **controlled substances requiring EPCS compliance**.

### 2.4 How EPCS-Certified Systems Handle Compound Prescriptions

EPCS-certified systems like Surescripts handle compound prescriptions through the NCPDP SCRIPT Standard v2017071 (mandatory since January 2020), which added compound prescription support allowing **up to 25 active ingredients** per electronic prescription ([Surescripts press release, May 2021](https://surescripts.com/press-releases/surescripts-leads-industry-transformation-ncpdps-script-standard-v2017071-strengthen-patient-safety-and-improve-workflow-efficiency)). Prior versions (v10.6 and earlier) had no mechanism for compound prescriptions, leading prescribers to "shoehorn" compound information into electronic prescriptions in ways that caused pharmacy confusion ([Surescripts CE article](https://surescripts.com/sites/default/files/legacy/docs/default-source/intelligence-in-action/ncpa-surescripts_script_2017071_pharmacist_ce_article_11-2019.pdf)).

For compounded controlled substances sent via EPCS:
- The prescription must still satisfy all DEA field requirements (21 CFR Part 1306)
- Two-factor authentication by the prescriber is required at signing
- The transmitted EPCS record must be retained electronically and cannot be converted to fax
- The pharmacy application must be separately DEA-certified ([DEA EPCS FAQ](https://deadiversion.usdoj.gov/faq/epcs-faq.html))

Not all compounding pharmacies are connected to the Surescripts network or EPCS-certified. Many specialty compounding pharmacies that primarily serve telehealth platforms maintain their own proprietary intake systems alongside or instead of Surescripts integration.

### 2.5 Exemptions for Compounded Controlled Substances

There are no general exemptions from EPCS requirements specifically for compounded controlled substances. However, there are **exemptions from the e-prescribing mandate** for compounded medications in states that otherwise require EPCS:

- **Utah**: Exempts prescriptions for "a medication that requires compounding two or more ingredients" from the mandatory EPCS requirement ([NABP Utah newsletter, February 2024](https://nabp.pharmacy/wp-content/uploads/2024/02/February-2024-Utah-State-Newsletter.pdf))
- **Other states** with mandatory EPCS may have similar carve-outs — this is a state-by-state issue

The DEA itself does not create a compound-specific exemption: if a practitioner chooses to e-prescribe a compounded controlled substance, all 21 CFR Part 1311 requirements apply in full.

**Fax exception for Schedule II narcotics for direct administration:** Under [21 CFR § 1306.11(e)](https://www.deadiversion.usdoj.gov/drugreg/Manual_Signatures_Are_Required_On_All_Prescriptions_11-02-2021.pdf), Schedule II narcotic prescriptions for compounded preparations intended for **direct administration to a patient** (e.g., infusion, injection in a clinical setting) may be faxed as the original. This is a narrow exception and does not apply to compound prescriptions dispensed directly to a patient.

---

## 3. DEA UI Requirements (21 CFR 1311)

### 3.1 What 21 CFR 1311 Mandates for Application UI/UX

[21 CFR § 1311.120](https://www.law.cornell.edu/cfr/text/21/1311.120) is the primary source for specific UI requirements imposed on electronic prescription applications. These are binding technical and design requirements for any EPCS-certified system.

#### (a) Prescriber Identity and DEA Linkage
- The application must link each prescriber by name to at least one DEA registration number
- If the prescriber has multiple DEA registrations (e.g., multi-state practice), the system must require selection of the correct DEA number for each prescription
- DEA registration must be valid and current before access controls can be set

#### (b) Logical Access Controls (Two-Person Rule)
- The system must support setting access controls by **individual name or role**
- **Two separate people** must be involved in setting or changing access controls for EPCS: one enters the data, one approves it — no single person can both grant and approve their own access ([21 CFR § 1311.125](https://www.ibeta.com/dea-epcs-requirements-a-clear-guide-for-prescriber-app-developers/))
- Access must be promptly revoked when a practitioner loses DEA registration or state licensure

#### (c) Required Pre-Signing Display to Prescriber

Before a controlled substance prescription can be signed, the application **must display all of the following** to the prescriber for review ([21 CFR § 1311.120(b)(9)](https://www.law.cornell.edu/cfr/text/21/1311.120)):

| Required Display Element |
|--------------------------|
| Date of issuance |
| Full name of the patient |
| Drug name |
| Dosage strength and form |
| Quantity prescribed |
| Directions for use |
| Number of refills authorized (Schedule III–V) |
| Earliest fill date (for multiple prescriptions per § 1306.12(b)) |
| Prescriber's name, address, and DEA registration number |
| The mandatory attestation statement (see below) |

#### (d) Mandatory Attestation Statement

The review screen must display the following statement (or its **substantial equivalent**) per [21 CFR § 1311.140(a)(3)](https://deadiversion.usdoj.gov/faq/epcs-faq.html):

> *"By completing the two-factor authentication protocol at this time, you are legally signing the prescription(s) and authorizing the transmission of the above information to the pharmacy for dispensing. The two-factor authentication protocol may only be completed by the practitioner whose name and DEA registration number appear above."*

No additional keystroke acknowledgment is required — completing the 2FA protocol itself constitutes agreement. However, the system must not allow any other person to complete the protocol on the named prescriber's behalf.

#### (e) "Ready to Sign" Workflow

- The prescriber must **affirmatively indicate** that each prescription is ready to be signed ([21 CFR § 1311.120(b)(10)](https://www.law.cornell.edu/cfr/text/21/1311.120))
- After this indication, the system must **not permit alteration of DEA-required elements** without forcing a new review and re-indication of readiness
- Any alteration of required fields after digital signing **cancels the prescription**
- Multiple prescriptions for the same patient can be signed with a single 2FA invocation, provided each was individually indicated as ready while its full details were displayed

#### (f) Two-Factor Authentication at Point of Signing

The 2FA credential use at signing serves as the prescriber's legal digital signature. The system must ([21 CFR § 1311.140(a)(4)](https://deadiversion.usdoj.gov/faq/epcs-faq.html)):
- Prompt for 2FA after the prescriber indicates readiness to sign
- Complete the 2FA protocol while the prescription details remain displayed
- Timestamp the prescription when signing occurs
- Synchronize system time within **5 minutes of official NIST time**

#### (g) Digital Signature and Archiving Requirements

Per [21 CFR § 1311.120(b)](https://www.law.cornell.edu/cfr/text/21/1311.120) and [21 CFR § 1311.145](https://www.law.cornell.edu/cfr/text/21/1311.145):
- The cryptographic module for signing must meet **FIPS 140-2 Security Level 1**
- Digital signature algorithm and hash function must comply with **FIPS 186-3** and **FIPS 180-3**
- The private key must be stored encrypted on a FIPS 140-2 validated module
- The digitally signed record must be electronically archived
- The system must not transmit a prescription unless the digital signing function has been used

### 3.2 Audit Trail Requirements

Under [21 CFR § 1311.120(b)(23)–(25)](https://www.law.cornell.edu/cfr/text/21/1311.120) and [§ 1311.150](https://www.ibeta.com/dea-epcs-requirements-a-clear-guide-for-prescriber-app-developers/), the system must maintain a comprehensive, tamper-evident audit trail capturing:

**Auditable Events:**
- Creation, alteration, indication of readiness for signing, signing, transmission, or deletion of any controlled substance prescription
- Setting or changing of logical access control permissions
- Failed transmission notifications
- Authentication events (successes and failures)
- Administrative changes (access grants, revocations, updates)

**Required Data in Each Audit Record:**
- Date and time of the event
- Type of event
- Identity of the person taking the action
- Outcome (success or failure)

**Retention and Reporting:**
- Records must be retained electronically for **at least two years** ([21 CFR § 1311.305](https://www.ibeta.com/dea-epcs-requirements-a-clear-guide-for-prescriber-app-developers/))
- The system must conduct **automated internal audits** at least daily and generate reports of security incidents
- If a compromise is identified, it must be reported to the application provider and **DEA within one business day**
- The system must generate monthly logs of controlled substance prescriptions issued, provided to the practitioner within 7 days after month-end; on-demand logs covering at least the previous 2 years must also be available

### 3.3 Third-Party Certification Requirement

Before any application can be used to transmit EPCS prescriptions, a **DEA-approved third-party auditor** must certify that the application meets all 21 CFR Part 1311 requirements. The DEA maintains a list of [approved certification organizations](https://www.deadiversion.usdoj.gov/ecomm/thirdparty.html). Re-certification is required every two years or whenever significant changes are made to the application.

---

## 4. Compounded vs. Manufactured Medications — Regulatory Differences

### 4.1 Prescribing a Compounded vs. Manufactured Medication

The core legal difference is that compounded medications are **not FDA-approved** and receive no pre-market safety, efficacy, or quality review. This creates several downstream differences in the prescribing and transmission workflow:

| Dimension | Manufactured Drug | Compounded Drug (503A) |
|-----------|-------------------|------------------------|
| FDA approval status | FDA-approved | Not FDA-approved |
| Drug identification | Standard NDC code | No NDC; formulation must be fully specified |
| Prescribing authority | Any licensed prescriber | Same, but with additional documentation requirements |
| "Clinically necessary" notation | Not required | Required (Section 503A) |
| Can be an "essentially a copy" | N/A | Restricted (must differ meaningfully from commercial product) |
| Patient-specific prescription | Not always required | Always required for 503A |
| Sig character limit (NCPDP SCRIPT) | 140 chars (v10.6) / 1,000 chars (v2017071) | 1,000 chars (v2017071 required for compounds) |
| E-prescribing standards | Full NCPDP SCRIPT support | NCPDP SCRIPT v2017071+ required (compound field support) |

Per the [Brookings Institution analysis](https://www.brookings.edu/articles/fda-oversight-of-drug-manufacturing-and-compounding-a-comparison/), the FDA oversight asymmetry is significant: manufactured drugs face pre-market review; 503A compounds are primarily overseen by state boards of pharmacy with no routine FDA inspection or pre-market quality assessment.

### 4.2 Can Compounded Medications Be E-Prescribed via Surescripts?

**Yes, since January 2020** — but with important limitations.

NCPDP SCRIPT Standard v2017071, which became mandatory for Medicare Part D on January 1, 2020, added compound prescription support for the first time. It allows for the [drug name and quantity of up to 25 different ingredients](https://surescripts.com/press-releases/surescripts-leads-industry-transformation-ncpdps-script-standard-v2017071-strengthen-patient-safety-and-improve-workflow-efficiency) in a single electronic prescription. Prior to this, no version of NCPDP SCRIPT was designed to handle compound prescriptions, causing widespread "shoehorning" of compound data into standard free-text fields ([Surescripts CE article](https://surescripts.com/sites/default/files/legacy/docs/default-source/intelligence-in-action/ncpa-surescripts_script_2017071_pharmacist_ce_article_11-2019.pdf)).

**Practical limitations that still exist:**

1. **Pharmacy connectivity**: Not all compounding pharmacies are connected to the Surescripts network. Many specialty compounding pharmacies serving telehealth platforms operate outside the standard Surescripts network and have proprietary or direct API integrations with prescribing platforms.

2. **NDC codes**: Surescripts and standard pharmacy systems rely on NDC codes to identify drugs. Compounded preparations have no NDC. While v2017071 added structured compound fields, many pharmacy systems still struggle with non-NDC prescriptions in their dispensing workflow.

3. **Formulary checking**: Real-time drug interaction checks, formulary lookups, and benefit checking tools built on NDC databases do not work for compounded medications.

4. **Controlled substance compound e-prescribing**: Possible under v2017071 with EPCS certification, but both the sending EHR and the receiving pharmacy system must be EPCS-certified. Not all compounding pharmacies have this capability.

5. **Sig complexity**: Compounded preparations often require elaborate dosing instructions (e.g., topical application techniques, injection volumes, titration schedules) that can exceed even the expanded 1,000-character sig field.

### 4.3 When Is Fax Still Required (and Why)?

Fax remains common or required for compounded prescriptions in several scenarios:

| Scenario | Why Fax Is Used |
|----------|-----------------|
| Pharmacy not on Surescripts network | No electronic connection available |
| Compounding pharmacy uses proprietary intake | Surescripts integration not built or maintained |
| State compounding exemption from e-prescribing mandate | Some states (e.g., Utah) exempt compound prescriptions from EPCS mandate |
| Schedule II for direct administration | 21 CFR § 1306.11(e) allows fax for Schedule II narcotics for direct patient administration |
| Technical system failure | E-prescribing regulations require fax fallback capability |
| Older EHR not updated to v2017071 | Cannot generate structured compound prescription electronically |

**Important:** Per [DEA guidance (November 2021)](https://www.deadiversion.usdoj.gov/drugreg/Manual_Signatures_Are_Required_On_All_Prescriptions_11-02-2021.pdf), any prescription generated by computer and faxed is a **paper prescription** and must be manually signed. Computer-generated faxes that are not manually signed are not valid. This means that "fax from a prescribing platform" workflows require a printed-and-signed step, unless the platform transmits as a true EPCS.

### 4.4 Limitations of E-Prescribing Standards for Compounds

The [NCPDP SCRIPT standard analysis](https://intuitionlabs.ai/articles/ncpdp-script-standard-guide) identifies several ongoing limitations relevant to compound prescriptions:

- **No standard compound drug codes**: Unlike manufactured drugs (which use NDC), there is no universal coding system for compounded drug formulations. This impedes clinical decision support and drug interaction checking.
- **Free-text Sig still dominates**: Despite structured Sig fields in v2017071, only ~10% of prescriptions used structured Sig as of 2020. Complex compound instructions are almost always free text.
- **Preparation instructions**: NCPDP SCRIPT has no standard mechanism for conveying preparation instructions to the pharmacist (e.g., "use propylene glycol 30% base" or "sterile filter required").
- **Base/vehicle specification**: There is no standard field for specifying the compounding vehicle or base, which is critical for topical compounds.
- **Beyond-use dates**: BUD requirements from USP 795/797 are not part of the prescription transmission standard; they are handled internally by the pharmacy.

---

## 5. State Board of Pharmacy Regulations

### 5.1 State E-Prescribing Mandates

The national landscape is rapidly evolving toward mandatory e-prescribing. As of early 2024, [35 states require e-prescribing in some form](https://nabp.pharmacy/news/blog/revolutionizing-health-care-the-evolving-path-of-e-prescriptions/) by state law ([NABP, January 2024](https://nabp.pharmacy/news/blog/revolutionizing-health-care-the-evolving-path-of-e-prescriptions/)):

| Mandate Type | States |
|-------------|--------|
| **All prescriptions** (CS and non-CS) mandated electronically | California, Delaware, Florida, Iowa, Michigan, Minnesota, New York |
| **All controlled substances** mandated electronically | Illinois, Rhode Island, South Carolina, and others |
| **Certain CS only** (often opioids) | Kansas, Maine, Virginia, Arizona, Tennessee, and others |
| No state e-prescribing mandate | Remaining ~15 states (as of 2024) |

**CMS Medicare Part D requirement**: CMS requires that prescriptions for most controlled substances under Medicare Part D be sent electronically using NCPDP SCRIPT Standard v2017071 ([Surescripts, 2021](https://surescripts.com/press-releases/surescripts-leads-industry-transformation-ncpdps-script-standard-v2017071-strengthen-patient-safety-and-improve-workflow-efficiency)).

### 5.2 Compounding Exemptions from E-Prescribing Mandates

Some states with mandatory e-prescribing create specific exemptions for compounded preparations:

- **Utah**: Explicitly exempts "a medication that requires compounding two or more ingredients" from mandatory EPCS, with documentation requirement on the hard copy ([NABP Utah newsletter, February 2024](https://nabp.pharmacy/wp-content/uploads/2024/02/February-2024-Utah-State-Newsletter.pdf))
- Other states with blanket e-prescribing mandates may not have explicit compound exemptions, meaning compound prescriptions must be e-prescribed in those states unless another valid exemption (e.g., technical failure) applies

### 5.3 Wet Signature / Fax Still Required

Even under a state e-prescribing mandate, the following remain valid fallbacks when exceptions apply:
- Technical failure of the e-prescribing system (with documentation)
- Prescriber licensed in another jurisdiction (in some states)
- Research protocol prescriptions
- Some state-specific carve-outs for compounds (as above)

Schedule II controlled substances **without EPCS** require paper with a **wet (manual) signature** — computer-generated and computer-faxed prescriptions must still be manually signed ([DEA, November 2021](https://www.deadiversion.usdoj.gov/drugreg/Manual_Signatures_Are_Required_On_All_Prescriptions_11-02-2021.pdf)).

### 5.4 State-Specific Fields Required on Compounding Prescriptions

Beyond federal requirements, states add various fields or attestations:

| State | Notable Additional Requirement |
|-------|-------------------------------|
| **California** (as of Oct 2025) | Pharmacist must verify and document "clinically significant difference" vs. commercially available product ([Frier Levitt, January 2026](https://www.frierlevitt.com/articles/state-federal-legislative-developments-drug-compounding-2026/)); prescriber notation triggers this obligation |
| **Florida** (SB 860/HB 877, proposed 2026) | Active pharmaceutical ingredient (API)-sourcing documentation and certification requirements for certain compounded drugs, including weight-loss medications |
| **Indiana** (SB 282, proposed 2026) | Tightened bulk drug substance compounding, new medical spa registration regime |
| **Most states** | Require prescriber's state license number on prescription (NPI increasingly common) |
| **Some states** | Require prescriber DEA number even for non-controlled compounded substances if compound contains a controlled substance precursor |

Workers' compensation programs in many states require additional fields for compound prescriptions billed to WC:
- Individual ingredient NDCs, quantities, and calculated reimbursement values (Arizona, Nevada, Texas)
- Prior authorization documentation for all compounds (Texas, Montana, Louisiana) ([Optum state-by-state analysis, February 2025](https://preview-workcompauto.optum.com/content/dam/noindex-resources/owca/insights/ppra/compounded-medications-state-by-state-rules-2025.pdf))

### 5.5 Interstate Compounding — 503A vs. 503B

The interstate shipping rules differ fundamentally between 503A and 503B:

**503A Pharmacies (traditional patient-specific compounders):**
- May not distribute compounded drugs outside their state **in excess of 5% of total prescriptions** unless the state has entered an MOU with FDA ([NCBI / National Academies of Sciences analysis](https://www.ncbi.nlm.nih.gov/books/NBK562888/))
- Must be licensed in each state where they ship to patients
- Licensing requires separate applications, inspections, and compliance with each state's pharmacy law — typically 3–12 months per state ([Newtropin, February 2026](https://newtropin.com/state-licensing-pharmacy-regulations-what-patients-need-to-know/))
- State-by-state heterogeneity is substantial: some states prohibit sterile office stock compounding, some allow it with restrictions

**503B Outsourcing Facilities:**
- Can ship interstate without patient-specific prescriptions ([Frier Levitt](https://www.frierlevitt.com/service/pharmacy-providers/outsourcing-facilities-503b/))
- Subject to FDA CGMP requirements and risk-based inspections
- States regulate 503B facilities inconsistently — some treat them as pharmacies (New York), some as manufacturers (Texas), some have distinct frameworks (California, New Hampshire) ([FDLI, October 2022](https://www.fdli.org/2022/09/state-by-state-patchwork-creates-onerous-burdens-for-503b-outsourcing-facilities/))
- 503B facilities must register in every state they ship to for patient-specific prescriptions if those states require pharmacy licensure

**UI Design Implication**: A compounding prescription platform serving multiple pharmacies must be aware of and potentially flag when a patient's state may not be serviced by a given pharmacy, particularly for 503A facilities.

---

## 6. HIPAA and PHI Considerations

### 6.1 Coverage Status

All entities in the compounding prescription ecosystem are HIPAA covered entities or business associates:

- **Prescribing telehealth platform**: Covered entity (health care provider) and/or business associate depending on structure
- **Compounding pharmacy**: Covered entity — pharmacies that transmit PHI in connection with HIPAA standard electronic transactions (claims, eligibility, e-prescribing) qualify as covered entities under [45 CFR § 160.103](https://www.hipaajournal.com/hipaa-compliance-for-pharmacies/)
- **E-prescribing intermediaries** (e.g., Surescripts): Business associate
- **Technology vendors** (cloud hosting, EHR, API services): Business associates

### 6.2 Patient Data in Transit — Prescription Transmission

NCPDP SCRIPT e-prescribing transactions carry PHI and must be protected under the HIPAA Security Rule even though SCRIPT is not itself a named HIPAA standard transaction ([Accountable, January 2025](https://www.accountablehq.com/post/are-pharmacies-covered-entities-under-hipaa-requirements-examples-and-compliance-guide)):
- All transmission channels must use encryption in transit (TLS 1.2+)
- Access to prescriptions in transit must be restricted to authorized parties
- Audit logs of all prescription transmissions must be maintained
- No PHI may be included in transmission metadata visible to unauthorized parties

For fax transmissions: HIPAA-compliant electronic fax (not plain fax) is standard; the fax must be sent to a verified secure recipient number with cover sheet protections.

### 6.3 Patient Shipping Address Handling

Shipping address is PHI when combined with patient name and treatment information. For compounding pharmacies shipping medications to patients:

**Minimum Necessary Standard ([45 CFR § 164.502(b)](https://www.postgrid.com/articles/minimum-necessary-rule-for-hipaa-mailing-a-practical-checklist/)):**
- Only the shipping address data necessary for delivery should be shared with shipping carriers and logistics vendors
- The carrier (UPS, FedEx, USPS) receives only: patient name, address, weight, dimensions — not health information
- **Nothing on the exterior of the package may reveal the nature of the medication or health condition** (e.g., no "Testosterone Pharmacy" return addresses, no medication names on labels)

**Packaging and labeling:**
- Exterior label: patient name and address only; neutral return address using pharmacy's general name, not a specialty name that implies a diagnosis
- Tracking information shared with platforms via API should be treated as PHI-adjacent data if it can be correlated back to a prescription

**Special sensitivity for certain compound categories:**
- Testosterone, ketamine, and hormonal compounds may be considered particularly sensitive PHI as they can reveal mental health conditions, gender-affirming care, or reproductive health status
- Some states (California, New York, Texas) have additional state privacy laws beyond HIPAA that may apply to certain medication categories

### 6.4 Minimum Necessary Standard for Compounding Orders

In the compounding prescription context, the minimum necessary standard applies to what data each entity receives:

| Entity | Minimum Necessary PHI |
|--------|----------------------|
| Prescriber platform | Full prescription data + patient clinical history needed for safe prescribing |
| Compounding pharmacy | Full prescription data (all required fields) + shipping address |
| Shipping carrier | Name, shipping address, package dimensions — no clinical data |
| Analytics/reporting tools | De-identified or aggregated data where possible |
| Payment processors | Billing data only; no clinical details beyond diagnosis codes where required |

### 6.5 Business Associate Agreement (BAA) Requirements

Under [45 CFR § 164.504(e)](https://remedora.com/blog/posts/hipaa-compliant-telehealth-platforms-guide/), a BAA must be executed before any business associate can access PHI. The full chain requires BAAs between:

| Relationship | BAA Required? |
|-------------|---------------|
| Telehealth platform ↔ Compounding pharmacy | **Yes** (pharmacy is BA of platform, or both are covered entities — treatment exception may apply; see below) |
| Telehealth platform ↔ EHR/e-prescribing software vendor | **Yes** |
| Telehealth platform ↔ Cloud infrastructure provider | **Yes** |
| Telehealth platform ↔ Surescripts (or other network) | **Yes** |
| Prescribing provider → Compounding pharmacy (for treatment) | **Possible exception** — under 45 CFR § 164.502(e)(1), disclosures from a covered entity to a healthcare provider for treatment purposes do not require a BAA ([Holland & Hart, October 2023](https://www.hollandhart.com/avoiding-business-associate-agreements)); however, the telehealth platform intermediary likely does require one |
| Compounding pharmacy ↔ Shipping vendor handling PHI | **Yes** |
| Compounding pharmacy ↔ API integration partners | **Yes** |

A BAA must specify:
- Permitted uses and disclosures of PHI
- Required safeguards
- Breach reporting obligations and timelines
- Data return or destruction at end of relationship
- Right-to-audit provisions
- Flow-down obligations to subcontractors

**Common platform error:** Launching a telehealth prescribing platform without executing BAAs with every vendor in the stack. Per [Compliancy Group](https://compliancy-group.com/hipaa-and-telehealth/), telehealth provision does not alter a covered entity's HIPAA obligations — all standard requirements apply.

### 6.6 Security Rule Technical Safeguards

For the prescribing platform and pharmacy systems:
- **Access controls**: Unique user IDs, automatic logoff, encryption of ePHI at rest and in transit
- **Audit controls**: Hardware, software, and procedural mechanisms to record and examine ePHI access
- **Integrity controls**: Electronic mechanisms to ensure ePHI is not improperly altered or destroyed
- **Transmission security**: Encryption for all ePHI transmitted over open networks

For EPCS-specific systems, the DEA audit trail requirements (Section 3.2 above) and HIPAA audit requirements overlap substantially — a single robust audit log system can satisfy both sets of requirements.

---

## 7. Summary: Key UI Design Implications

The following table distills the regulatory requirements into actionable UI/UX design constraints for an electronic compounding prescription platform:

| Design Area | Requirement | Regulatory Source |
|-------------|-------------|-------------------|
| **Required prescription fields** | Must collect all 12–13 DEA fields for CS; clinical necessity notation mandatory for all compounds | 21 CFR § 1306.05; FDA Section 503A guidance |
| **Compound-specific fields** | Active ingredient(s) + strength, dosage form, basis for clinical necessity, reason compounding vs. commercial product | FDA 503A guidance; state boards |
| **Review screen before signing** | Must display all required DEA fields + mandatory attestation statement — no signing without this screen | 21 CFR § 1311.120(b)(9)–(10) |
| **Mandatory attestation** | The specific DEA attestation language must appear on the signing screen | 21 CFR § 1311.140(a)(3) |
| **Two-factor authentication** | 2FA required at signing for all CS; must use 2 of 3 factor types (know/have/are); password alone is insufficient | 21 CFR § 1311.115 |
| **Post-signing immutability** | Fields cannot be altered after digital signing; any alteration must cancel the prescription and require re-creation | 21 CFR § 1311.120(b)(19) |
| **Logical access controls** | Two-person rule for granting prescribing access; cannot be set by one person alone | 21 CFR § 1311.125 |
| **Audit trail** | Every create/edit/sign/transmit/delete event must be logged with timestamp, user identity, and outcome | 21 CFR § 1311.120(b)(23)–(25) |
| **Prescription log** | Monthly CS prescription logs delivered to prescribers within 7 days of month-end; on-demand 2-year lookback | 21 CFR § 1311.120(b) |
| **No DEA element alteration after ready-to-sign** | Once prescriber clicks "ready to sign," DEA elements are locked; any change requires re-review | 21 CFR § 1311.120(b)(10) |
| **NCPDP SCRIPT v2017071+** | Required for electronic compound prescriptions; supports up to 25 ingredients | CMS Final Rule 2018; Surescripts |
| **State license validation** | Must verify pharmacy is licensed in patient's state before routing compound prescription | 503A state licensing requirements |
| **PHI on packaging** | Shipping integrations must not expose medication name or clinical information on exterior labels | HIPAA minimum necessary standard |
| **BAA execution** | Every vendor in the stack touching PHI must sign a BAA before go-live | 45 CFR § 164.504(e) |
| **Fax fallback** | Platform must support fax output for pharmacies not on EPCS network; all faxed CS prescriptions require manual signature | 21 CFR § 1306.05(d); DEA 2021 guidance |
| **EPCS certification** | Third-party DEA audit required before platform can transmit CS prescriptions electronically | 21 CFR § 1311.300; DEA certification list |
| **Time synchronization** | System clock must stay within 5 minutes of NIST time | 21 CFR § 1311.120(b) |

---

*Sources referenced throughout this document are cited inline. All federal regulatory citations are to the Code of Federal Regulations as published at [law.cornell.edu/cfr](https://www.law.cornell.edu/cfr/text/21/chapter-II) and the [DEA Diversion Control Division](https://www.deadiversion.usdoj.gov/).*
