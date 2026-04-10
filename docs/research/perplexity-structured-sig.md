# Research Area 2: Structured Sig Building for Compounded Medications

*Compiled: April 7, 2026*

---

## Table of Contents

1. [NCPDP Structured Sig Standard](#1-ncpdp-structured-sig-standard)
2. [Surescripts and Compounded Medication Sigs](#2-surescripts-and-compounded-medication-sigs)
3. [Standard Frequency Codes](#3-standard-frequency-codes)
4. [Complex Sig Handling](#4-complex-sig-handling)
5. [Sig Component Databases](#5-sig-component-databases)
6. [Sig Building UI Patterns](#6-sig-building-ui-patterns)
7. [Summary and Implications](#7-summary-and-implications)

---

## 1. NCPDP Structured Sig Standard

### 1.1 What is the SIG?

The term "Sig" (from Latin *signatura*, meaning "let it be labeled") refers to the patient directions on a prescription — the instructions for use conveyed from prescriber to pharmacist and ultimately printed on the medication label. A complete sig typically includes: action verb, dose, dose units, dose form, route of administration, frequency/timing, duration, and optionally an indication.

**Source:** [JAMIA Evaluation of NCPDP Structured and Codified Sig Format](https://pmc.ncbi.nlm.nih.gov/articles/PMC3168301/)

### 1.2 The NCPDP SCRIPT Standard

The NCPDP SCRIPT Standard defines XML-based transaction messages for electronic prescription exchange. Key transactions include NEWRX (new prescription), REFREQ (refill request), CANRX (cancellation), and RXHREQ (medication history query). Every NEWRX message includes a Sig element.

**Version timeline relevant to sigs:**

| Version | Mandated | Key Sig Changes |
|---------|----------|-----------------|
| SCRIPT 10.5 | ~2012 | Formally incorporated Structured and Codified Sig Format v1.0 |
| SCRIPT 10.6 | 2013 | Introduced RxNorm drug coding; Structured Sig codification optionally available |
| SCRIPT 2017071 | Jan 1, 2020 (CMS mandate) | Sig field expanded from 140 to 1,000 characters; compound prescriptions supported (up to 25 ingredients); IV/wound care instructions added |
| SCRIPT 2023011 | Effective 2028 (CMS mandate) | Further enhancements; electronic prior authorization |

**Sources:** [NCPDP SCRIPT Standard Guide (Intuition Labs, 2026)](https://intuitionlabs.ai/articles/ncpdp-script-standard-guide); [NCPDP press release on v2017071](https://www.ncpdp.org/Resources/NCPDP-SCRIPT-Version-2017071-ePrescribing-Testing)

### 1.3 Structured and Codified Sig (S&C SIG) Format

The S&C SIG format, developed by NCPDP starting in 2004 and released in 2006 (v1.0 in 2008), structures and codifies individual components of e-prescription directions into discrete XML fields. NCPDP requires the free-text direction generated from S&C SIG fields to be displayed to the prescriber and included in the e-prescription transmission. **Free text is always mandatory; structured fields are optional.**

#### 13 Segments and Their Fields

| Segment | Key Fields |
|---------|-----------|
| **Repeating Sig** | Sig sequence position number; Multiple Sig modifier (AND/THEN/etc.) |
| **Code System** | SNOMED CT version; FMT (Federal Medication Terminologies) version |
| **Sig Free Text String** | The mandatory human-readable text string |
| **Dose** | Dose delivery method (action verb); Dose delivery method modifier; Dose quantity; Dose form; Dose range modifier |
| **Dose Calculation** | Dosing basis numeric value/units; Body metric qualifier/value; Calculated dose numeric value/units; Dosing basis range modifier |
| **Vehicle** | Vehicle name; Vehicle quantity; Vehicle unit of measure; Multiple vehicle modifier |
| **Route of Administration** | Route; Multiple route modifier |
| **Site of Administration** | Site; Multiple site modifier |
| **Sig Timing** | Administration timing; Rate of administration; Rate unit of measure; Time period basis; **Frequency numeric value**; **Frequency units**; Variable frequency modifier; **Interval numeric value**; **Interval units**; Variable interval modifier |
| **Duration** | Duration numeric value; Duration text |
| **Maximum Dose Restriction** | Max dose value/units; Variable max dose with duration |
| **Indication** | Indication precursor; Indication text; Indication value |

**Terminology systems used:**
- **SNOMED CT** — For dose delivery method, vehicle, route, site, administration timing, frequency/interval units, duration, indication precursor
- **Federal Medication Terminologies (FMT) / NCI Thesaurus (NCIt)** — For dose form
- All other fields accept free text

**Source:** [JAMIA Evaluation of NCPDP S&C Sig Format, 2011](https://pmc.ncbi.nlm.nih.gov/articles/PMC3168301/)

### 1.4 Representational Coverage

A 2011 JAMIA study evaluating 20,161 ambulatory e-prescriptions found:

| Capability | Result |
|-----------|--------|
| Sigs fully representable by the Format's field structure | 95% (CI 93–97%) |
| Administration timing terms mappable to SNOMED CT | Only 33% |
| Dose delivery method terms codifiable | 60% |
| Route of administration terms codifiable | 95% |
| Site of administration terms codifiable | 70% |
| Indication terms codifiable | 93% |
| Dose form terms codifiable (FMT) | 84% |

**Key limitation:** The format can *structurally* hold 95% of sigs, but codified vocabulary coverage for specific fields (especially timing and dose delivery method) is far lower, driving continued reliance on free text.

**Source:** [JAMIA Evaluation of NCPDP S&C Sig Format, 2011](https://pmc.ncbi.nlm.nih.gov/articles/PMC3168301/)

### 1.5 Adoption Rates

- In 2020, only **~10% of e-prescriptions** used S&C SIG structured fields ([Intuition Labs, 2026](https://intuitionlabs.ai/articles/ncpdp-script-standard-guide))
- A 2022 JAMIA study of 3.8 million e-prescriptions (2019–2021) found **32.4%** transmitted with at least one S&C SIG component, but this was concentrated in 22 specific business accounts ([JAMIA S&C SIG Implementation Outcomes, 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC9552209/))
- Quality issues persisted in **10.3%** of S&C SIG-formatted prescriptions

---

## 2. Surescripts and Compounded Medication Sigs

### 2.1 Surescripts Network Overview

Surescripts operates the dominant U.S. electronic prescribing network. In 2025, **1.39 million prescribers** used e-prescribing via Surescripts, as did virtually all pharmacies. The network transmitted over 27.2 billion health intelligence exchanges in 2024.

**Source:** [Surescripts 2025 Annual Impact Report](https://surescripts.com/why-surescripts/our-impact/annual-impact-report)

### 2.2 How Surescripts Handles Compounded Medication Sigs

**Prior to SCRIPT 2017071:** No version of NCPDP SCRIPT prior to 2017071 was designed to convey compound prescription information electronically. Prescribers had to "shoehorn" compound information into standard fields, causing confusion at the pharmacy.

**With SCRIPT 2017071 (mandated Jan 1, 2020):**
- Supports transmission of compound ingredients and quantities for **up to 25 active ingredients** in one electronic prescription
- Sig field expanded from **140 to 1,000 characters** to accommodate complex compound directions
- Additional support for: IV administration information, wound care information, flavoring, number of packages, manufacturer/lot/expiration data

**Critical limitation:** Even with 2017071, the compound sig itself remains **primarily free text**. There is no structured compound-specific sig format — the 1,000-character free text field is the mechanism used for complex compound directions. A 2019 Surescripts/NCPA CE article noted: "hopefully there will be very few instances in which a prescriber will actually use all 1,000 characters available to write a sig, because that would cause a different type of problem at the pharmacy end."

**Sources:** [Surescripts/NCPA SCRIPT 2017071 CE Article, 2019](https://surescripts.com/sites/default/files/legacy/docs/default-source/intelligence-in-action/ncpa-surescripts_script_2017071_pharmacist_ce_article_11-2019.pdf); [NCPDP SCRIPT v2017071 Testing Tool announcement](https://www.ncpdp.org/Resources/NCPDP-SCRIPT-Version-2017071-ePrescribing-Testing)

### 2.3 Surescripts Sig IQ

Surescripts has deployed **Sig IQ**, a machine learning technology that:
- Translates free-text Sigs into the Structured & Codified Sig format automatically
- Operates on new e-prescriptions, renewal messages, and Medication History responses
- In 2025, augmented **12.7% of all E-Prescribing transactions**
- Augmented **60% of Medication History for Ambulatory and Reconciliation responses** (up from 52% in 2024)

This is a significant development: rather than requiring prescribers to use structured sig builders, Sig IQ applies NLP/ML post-transmission to generate structured representations from free text.

**Source:** [Surescripts 2025 Annual Impact Report](https://surescripts.com/why-surescripts/our-impact/annual-impact-report)

### 2.4 Practical Limitations for Compound Sigs via Surescripts

1. **No NDC for compounds:** Compounded medications have no NDC numbers, which breaks standard pharmacy system auto-matching. Surescripts/SCRIPT 2017071 uses the ingredient list (up to 25 components) as the compound identifier instead.
2. **Free text sig dominates:** Complex compound sigs (titration schedules, multi-phase dosing) are invariably entered as free text — the S&C SIG structured fields cannot reliably express titration or conditional dose escalation.
3. **Character limits:** Even at 1,000 characters, very complex titration sigs may still be truncated or require supplemental pharmacist notes.
4. **Interoperability gaps:** A 2024 scoping review found that "prescribing compounded medications using e-prescribing systems is a challenge due to the inconsistencies in drug names and interoperability issues between both computer systems." ([Healthcare scoping review, 2024](https://pmc.ncbi.nlm.nih.gov/articles/PMC11241554/))
5. **Sig character limits in EHR systems:** Some EHR systems (e.g., Enterprise Health) warn that "SureScripts limits the number of characters in the sig, so you may need to put the complex sig in the Pharmacist Note field instead." ([Enterprise Health Documentation](https://docs.enterprisehealth.com/features/medication-management-and-e-prescribing/prescribing-adding-medications/))

---

## 3. Standard Frequency Codes

### 3.1 Core Latin-Derived Frequency Abbreviations

These are the foundational pharmacy sig frequency codes derived from Latin phrases:

| Code | Latin Origin | Meaning | Structured Data Mapping |
|------|-------------|---------|------------------------|
| **QD** (or qd) | *quaque die* | Every day / once daily | Frequency: 1 per day |
| **BID** (or bid) | *bis in die* | Twice a day | Frequency: 2 per day |
| **TID** (or tid) | *ter in die* | Three times a day | Frequency: 3 per day |
| **QID** (or qid) | *quater in die* | Four times a day | Frequency: 4 per day |
| **QHS** (or qhs) | *quaque hora somni* | Every night at bedtime | Administration timing: bedtime |
| **PRN** (or prn) | *pro re nata* | As needed | Variable frequency; requires indication |
| **QOD** (or qod) | *quaque altera die* | Every other day | Interval: 48 hours |
| **QW** (or qw) | — | Every week / once weekly | Frequency: 1 per week |
| **BIW** | — | Twice a week | Frequency: 2 per week |
| **TIW** (or tiw) | — | Three times a week | Frequency: 3 per week |
| **Q2W** | — | Every 2 weeks | Interval: 14 days |
| **QM** | — | Every month / monthly | Frequency: 1 per month |
| **STAT** | *statim* | Immediately / now | One-time, urgent |

### 3.2 Extended Frequency / Interval Codes

| Code | Meaning | Notes |
|------|---------|-------|
| **QAM** | Every morning | Paired with QPM |
| **QPM** | Every evening | — |
| **QH** | Every hour | — |
| **Q2H** | Every 2 hours | Interval: 2 hours |
| **Q3H** | Every 3 hours | Interval: 3 hours |
| **Q4H** | Every 4 hours | Common for acute pain |
| **Q6H** | Every 6 hours | Interval: 6 hours |
| **Q8H** | Every 8 hours | Interval: 8 hours |
| **Q12H** | Every 12 hours | Interval: 12 hours |
| **Q24H** | Every 24 hours | Functionally equivalent to QD |
| **Q2-3H** | Every 2–3 hours | Variable interval |
| **Q4-6H** | Every 4–6 hours | Variable interval, common PRN |
| **Q2D** | Every 2 days | = QOD |
| **Q3D** | Every 3 days | Interval: 72 hours |
| **Q4W** | Every 4 weeks | Common for injectables |
| **5X/D** | Five times a day | e.g., antiviral eye drops |
| **AC** | Before meals | Administration timing |
| **PC** | After meals | Administration timing |
| **ATC** | Around the clock | Scheduled, no PRN |

**Sources:** [Denali Rx Sig Abbreviations](https://denalirx.com/sig-explanations/); [PharmaClik Rx SIG Codes PDF](https://www.pharmacytechnologysolutions.ca/pharmaclik-rx-doc/Content/Resources/PDFs/SIG%20Codes.pdf); [Pharmacy Sig Codes Quia reference](https://www.quia.com/jg/1204727list.html)

### 3.3 ISMP Error-Prone Abbreviations (Do Not Use)

The Institute for Safe Medication Practices (ISMP) maintains a list of abbreviations that should NOT be used due to misinterpretation risk. Updated April 2024:

| Problematic | Reason | Preferred |
|-------------|--------|-----------|
| **QD** (once daily) | Can be misread as QID (4x/day) | Write "daily" or "once daily" |
| **HS** (at bedtime) | Can be confused with "half-strength" | Use **QHS** |
| **U** (units) | Mistaken for "0" | Write "units" |
| **µg** (micrograms) | Confused with mg | Write "mcg" |
| **nanog** (nanograms) | Abbreviation error-prone | Spell out "nanograms" |
| **NAS** (intranasal) | Error-prone | Spell out "intranasal" |
| **/** (slash for "per") | Misread as "1" | Use "and" or "per" |
| **nightly** / **HS** | Confused with other meanings | Use **QHS** |

**Source:** [ISMP 2024 Error-Prone Abbreviations update](https://www.ismp.org/recommendations/error-prone-abbreviations-list); [PSQH summary](https://www.psqh.com/analysis/ismp-updates-tool-for-error-prone-abbreviations-symbols-and-dose-designations/)

### 3.4 How Frequency Codes Map to Structured Data (NCPDP S&C SIG)

In the NCPDP S&C SIG Timing Segment, frequency is captured as:
- **Frequency Numeric Value** — the number (e.g., "2" for BID)
- **Frequency Units** — the time period (e.g., "day" for per day)
- **Variable Frequency Modifier** — for ranges (e.g., "3 to 4 times per day")
- **Interval Numeric Value + Interval Units** — for every-X-hours patterns (e.g., "8" + "hours" for Q8H)
- **Administration Timing** — for event-based timing (e.g., "bedtime" for QHS, "with meals" for AC)

The separation of frequency (events-per-unit-time) from interval (time-between-events) allows both patterns to be captured, though in practice the JAMIA 2022 study found only **33% of administration timing terms** in real prescriptions could be mapped to SNOMED CT codes.

---

## 4. Complex Sig Handling

### 4.1 The Challenge of Multi-Phase and Titration Sigs

Modern pharmacy practice frequently requires complex sigs that encode:
- **Titration schedules** — dose escalation over defined intervals
- **Conditional dose changes** — "increase if tolerated"
- **Multi-phase therapy** — distinct phases with different doses/frequencies
- **Site rotation** — instructions for topical or injectable medications

These patterns are extremely common in compounded medications, particularly:
- GLP-1 receptor agonist compounds (semaglutide, tirzepatide) — requiring weekly dose escalation
- Hormone replacement therapy (HRT) — e.g., topical gels with rotating sites
- Pain management compounds — with PRN and scheduled components
- Titration-sensitive medications — ketamine, naltrexone LDN formulations

### 4.2 Example Complex Sigs and Structural Analysis

**Example 1: GLP-1 Titration**
> *"Inject 0.25mg SubQ weekly for 4 weeks, then increase to 0.5mg weekly"*

- NCPDP handling: Requires **two Repeating Sig segments** connected by the "THEN" Multiple Sig Modifier
- Phase 1: Dose=0.25mg, Route=SubQ, Frequency=1/week, Duration=4 weeks
- Phase 2: Dose=0.5mg, Route=SubQ, Frequency=1/week, Duration=ongoing
- Challenge: The duration-based transition trigger and the dose change are representable in theory, but real-world S&C SIG adoption makes this almost always a free-text sig

**Example 2: Oral Liquid Titration**
> *"Take 0.1mL by mouth nightly, titrate up by 0.1mL every 3–4 days as tolerated up to 0.5mL"*

- Requires: Starting dose, titration increment, variable interval, conditional modifier, maximum dose restriction
- NCPDP representation: The Maximum Dose Restriction segment captures the 0.5mL ceiling; the titration instruction ("increase by 0.1mL every 3–4 days as tolerated") has **no native structured representation** and falls into free text
- The 2011 JAMIA study identified "Increase dose quantity or frequency if tolerated" as a sig concept that was not representable, appearing in ~0.06% of study sigs

**Example 3: Topical with Site Rotation**
> *"Apply 1 click to inner forearm daily, rotate sites"*

- Route/Site: Topical to forearm (captured in Site of Administration segment)
- "Rotate sites" instruction: **Not representable** in S&C SIG structured fields — must be free text
- Dose form "click" (pump actuations): May require custom mapping

**Example 4: Extended Titration Protocol**
> *"Take 0.1mL nightly weeks 1–2, then 0.2mL nightly weeks 3–4, then 0.3mL nightly thereafter"*

- Requires 3 Repeating Sig segments with THEN modifiers
- Each segment needs: Dose + Duration
- In theory representable; in practice, the temporal linkage and conditional escalation push most prescribers to free text

### 4.3 NCPDP's Mechanism for Complex Sigs: Repeating Sig Segments

The S&C SIG format handles multi-step instructions through the **Repeating Sig Segment** with a **Multiple Sig Modifier** field that accepts:
- **THEN** — sequential phases ("take X for 3 days, THEN take Y for 3 days")
- **AND** — concurrent instructions ("take X in morning AND Y at bedtime")
- Numeric ranges within a single segment ("take 1–2 tablets")

**Key limitation identified in research:** The need to repeat the entire Sig segment for compound expressions creates ambiguity when combining numeric range repeats with multi-part AND/THEN instructions. There are no grouping/parenthetical rules, making complex titrations difficult to represent unambiguously.

**Sources:** [JAMIA Evaluation of NCPDP S&C Sig Format, 2011](https://pmc.ncbi.nlm.nih.gov/articles/PMC3168301/); [ADL Data Systems - ABCs of SCRIPT Standard](https://www.adldata.org/wp-content/uploads/2016/11/NCPDP_HIMSS_SCRIPT_final.pdf)

### 4.4 Do Any Systems Support Structured Titration Sigs?

**Current state:** No mainstream e-prescribing system fully structures titration/multi-phase sigs as discrete machine-readable data in a standardized way. The approaches observed in practice:

1. **Free text fallback (most common):** Complex titration sigs are entered as 1,000-character free text. The prescriber writes the full protocol in plain English. DoseSpot, Epic, and most EHRs handle complex compound sigs this way.

2. **Template-based "pre-built sigs":** Some compounding pharmacy systems (e.g., SiCompounding) allow prescribers to create **templates** that can contain one or multiple prescriptions, enabling reusable titration protocols as stored text templates. ([SiCompounding Release Notes](https://www.sicompounding.io/release-notes))

3. **Repeating S&C SIG (theoretical):** NCPDP's standard technically supports multi-phase sigs through repeating segments, but this is rarely implemented by EHR vendors due to interface complexity.

4. **Pharmacist Note field:** For sigs that exceed character limits or contain instructions requiring pharmacist interpretation (not patient-facing), the NCPDP SCRIPT standard provides a separate Notes field.

5. **Oncology compounding software (BD Cato, etc.):** Specialty compounding workflow software for IV/oncology medications handles multi-phase regimens through standardized protocol templates that calculate doses automatically from weight/BSA — but these are internal compounding workflow tools, not prescribing sig builders. ([JMIR Human Factors evaluation of BD Cato workflow software](https://pmc.ncbi.nlm.nih.gov/articles/PMC8596227/))

---

## 5. Sig Component Databases

### 5.1 First Databank (FDB) MedKnowledge

**What it is:** FDB is one of the two dominant drug database vendors in the U.S. FDB MedKnowledge is integrated into thousands of healthcare IT systems including EHRs, pharmacy management systems, and e-prescribing platforms.

**Relevance to sigs:**
- Provides **compound-drug clinical screening** — enables drug-drug interaction and contraindication screening for multi-ingredient compounded drugs at both the compound level and the individual ingredient level
- Provides **drug product nomenclature** including routes, dose forms, and strength descriptors that feed sig builder dropdown menus
- Offers **min/max dose modules** supporting dosing range validation in sig builders
- Drug vocabulary includes cross-references to NLM RxNorm
- Does **not** assign NDC codes to compounded medications (compounds are not FDA-registered products)
- NDC codes from FDB have been integrated into RxNorm since 2011

**Sources:** [FDB MedKnowledge Drug Database](https://www.fdbhealth.com/solutions/medknowledge-drug-database); [FDB MedKnowledge Framework Datasheet](https://www.fdbhealth.com/-/media/documents/form-not-required/us/datasheets/datasheet---fdb-medknowledge-framework.ashx); [First Databank Wikipedia](https://en.wikipedia.org/wiki/First_Databank)

### 5.2 Medi-Span (Wolters Kluwer)

**What it is:** Medi-Span is the other major drug database provider, owned by Wolters Kluwer. Its primary classification system is the **Generic Product Identifier (GPI)**.

**The GPI System:**
- 14-character hierarchical classification system
- 7 levels of granularity: drug group → class → subclass → base → name → dose form → dose strength
- Unlike NDC (static number), GPI characters encode clinical meaning at each level
- Enables grouping, sorting, searching, and matching across drug products
- Used in retail pharmacy systems for finding all brand/generic options for a prescribed product
- Used by PBMs and payers for formulary development

**Relevance to compounded medications and sigs:**
- GPI can identify drugs at any level of the hierarchy — this allows matching compounded drugs by ingredient/class even without an NDC
- Supports medication reconciliation by grouping drugs with the "same ingredient, different sigs"
- Helps overcome different medication spellings from different providers/pharmacies

**Limitation for compounded medications:** GPI is designed around marketed drug products. Custom compounded formulations (unique strength/base combinations) often lack GPI entries and require manual entry or custom codes within the dispensing system.

**Sources:** [Medi-Span GPI page (Wolters Kluwer)](https://www.wolterskluwer.com/en/solutions/medi-span/about/gpi); [PAAS National - Medi-Span GPI overview](https://paasnational.com/medi-span-generic-product-identifier/)

### 5.3 RxNorm

**What it is:** RxNorm is a standardized drug nomenclature system maintained by the National Library of Medicine (NLM). It assigns **RxCUI** (RxNorm Concept Unique Identifiers) to drug concepts defined by combinations of: active ingredient(s) + strength + dose form.

**Key RxNorm concept types:**
| Term Type | Description | Example |
|-----------|-------------|---------|
| **IN** | Ingredient | Metformin |
| **SCD** | Semantic Clinical Drug | Metformin 500 mg Oral Tablet |
| **SBD** | Semantic Branded Drug | Metformin 500 mg Oral Tablet [Glucophage] |
| **SCDF** | Semantic Clinical Drug Form | Metformin Oral Tablet |
| **GPCK** | Generic Pack | Metformin 500 mg Tablet [100 per pack] |
| **BPCK** | Branded Pack | Metformin 500 mg Tablet [Glucophage, 100 per pack] |

**In NCPDP SCRIPT:** The standard allows either an NDC in the "Drug Product Code" field or an RxNorm RxCUI in the "Drug Database Code" field. In practice, most pharmacy workflows use NDC codes for dispensing/billing but may carry RxCUI for clinical decision support.

**Compounded medications and RxNorm:**
- Compounded medications typically **do not have RxCUI codes** because they are not FDA-registered finished drug products
- RxNorm contains only "clinically significant active ingredients" of marketed drugs
- A 2011 JAMIA paper proposed that "linking compounded products to Unique Ingredient Identifier (UNII) codes in the FDA Substance Registration System to create an indirect mapping to RxNorm at the ingredient level" as a workaround ([Mapping Partners Master Drug Dictionary to RxNorm](https://pmc.ncbi.nlm.nih.gov/articles/PMC12834468/))
- In practice, e-prescribing systems transmit compound ingredients using individual ingredient-level RxCUIs (or NDCs for the base ingredients if commercially available) rather than a single compound-level code

**NCPDP's position:** NCPDP strongly opposes replacing NDC with RxNorm for pharmacy transactions, noting that "RxNorm lacks specificity and rarely maps to an NDC in a one-to-one relationship" and that "pharmacy claims systems are specifically coded to utilize [NDC] identifiers." ([NCPDP Letter to ONC on RxNorm, 2021](https://standards.ncpdp.org/Standards/media/pdf/Correspondence/2021/NCPDPLettertoONConRxNorm.pdf))

**Sources:** [RxNorm Technical Documentation (NLM)](https://www.nlm.nih.gov/research/umls/rxnorm/docs/techdoc.html); [NDC vs RxNorm Guide (Intuition Labs, 2025)](https://intuitionlabs.ai/articles/ndc-vs-rxnorm-hcpcs-j-codes)

### 5.4 Compounded Medication Coding — No NDC Problem

This is one of the fundamental challenges in building structured sigs for compounded medications:

**The core problem:**
- Standard medications are identified in pharmacy systems by NDC number
- NDC numbers are issued by FDA only to registered finished drug products
- Compounded medications are **custom preparations** — they have no NDC
- Without an NDC, the standard auto-matching and drug identification workflows in pharmacy systems fail

**Coding approaches used in practice:**

| Approach | Description | Used By |
|----------|-------------|---------|
| **Ingredient-level NDCs** | Use NDC codes for individual bulk drug ingredients; send compound as list of ingredients with quantities | NCPDP SCRIPT 2017071 compound support |
| **HCPCS miscellaneous J-codes** | J3490 (unspecified drug, non-oral), J3590 (unspecified biologics), J7999 (compounded drug) | Medicare billing for compounded drugs |
| **Custom local drug codes** | Pharmacy creates internal database entry with custom code | Most compounding pharmacy management systems (PK Software, SiCompounding) |
| **UNII codes** | FDA Substance Registration System Unique Ingredient Identifiers for bulk chemicals | Research systems; not widely adopted in e-prescribing |
| **Pharmacy-specific compound databases** | Compounding pharmacy maintains a formulary database of their standard compounds with custom IDs | Specialty compounding pharmacies |

**Source:** [Retinal Physician - Coding Q&A on Compounded Medications, 2021](https://retinalphysician.com/issues/2021/may/coding-qa-the-lowdown-on-compounded-medications/)

---

## 6. Sig Building UI Patterns

### 6.1 Overview of Approaches

EHR and e-prescribing systems have evolved several UI patterns for sig construction. The approaches exist on a spectrum from fully structured to fully free text:

| Pattern | Description | Advantages | Limitations |
|---------|-------------|-----------|-------------|
| **Pure free text** | Single text field for entire sig | Maximum flexibility; no constraints | Error-prone; no structured data; downstream rekeying burden |
| **Structured sig builder (dropdown/pick-list)** | Series of dropdowns for each sig component | Standardized output; reduced keystrokes | May not accommodate complex sigs; SNOMED CT vocabulary gaps |
| **Hybrid (builder + free text)** | Dropdowns for standard components + optional free text appendage | Balances standardization and flexibility | Free text may contradict structured fields |
| **Template-based (pre-built sigs)** | Library of complete sig strings selectable by prescriber | Fast; consistent; reduces variation | Limited to pre-built options; customization requires manual edit |
| **Auto-complete / NLP-assisted** | Free text with intelligent suggestions based on drug/frequency patterns | Natural workflow; faster than dropdowns | Quality depends on NLP accuracy; may still produce free text output |

**Source:** [JAMIA Quality and Variability of Patient Directions, 2018](https://pmc.ncbi.nlm.nih.gov/articles/PMC10398147/)

### 6.2 Structured Sig Builder Design (Dropdown-Based)

Most ePrescribing-enabled EHRs provide Sig builders that work as follows:

1. **Sequential component selection:** Prescriber selects options from dropdowns in order: action verb → dose amount → dose units → route → site (if applicable) → frequency → duration → auxiliary instructions
2. **Auto-concatenation:** The system concatenates selected values into a free text string displayed to the prescriber for review
3. **Favorites/recently used:** Sig builders typically allow adding frequently used sigs to a "favorites" list for one-click retrieval
4. **Hidden structured data:** In systems with S&C SIG support, the dropdown selections simultaneously populate both the free text field AND the structured SNOMED CT-coded fields — but the prescriber only sees the text output

**The critical gap noted by experts:** Even though prescribers create sigs using individual component fields (dose, route, frequency), most EHRs only populate the free text Directions field from those selections — not the separate S&C SIG structured fields. Vendors must create "behind-the-scenes tables" to map sig elements to S&C SIG codes, which is costly and has low prioritization due to lack of mandate and user demand. ([LinkedIn - Tony Schueth on Structured Sig, 2016](https://www.linkedin.com/pulse/taking-eprescribing-next-level-structured-codified-sig-tony-schueth))

### 6.3 Template-Based Sig Building

Template-based approaches are particularly valuable for compounding pharmacies:

**In compounding pharmacy systems (e.g., SiCompounding):**
- Prescribers can create **prescription templates** containing one or multiple prescriptions
- Templates encode complete sig text including complex titration instructions
- Reused for patients on the same protocol without re-entering the sig
- Reduces transcription errors for complex compounded medications

**In EHR systems (Epic, Cerner, etc.):**
- "Preference lists" or "order sets" contain pre-built medication orders with standard sigs
- For common compounded formulations (e.g., standard HRT protocols), these templates provide consistent sig text
- Smart text / dot phrases allow rapid insertion of standard sig text

**Source:** [SiCompounding Release Notes](https://www.sicompounding.io/release-notes)

### 6.4 Validation for Completeness

**Surescripts/NCPDP guidance** ([Surescripts Best Practices via ChartMaker](https://chartmaker.com/best-practices-for-constructing-high-quality-patient-instructions-sig-within-e-prescriptions/)) specifies that complete sigs must include all of:
1. **Action** verb (take, inject, apply, instill, inhale)
2. **Dose** quantity
3. **Dose units**
4. **Route** of administration
5. **Frequency**
6. **Auxiliary information** (duration, indication, PRN qualifier)

**Required element order:** action → dose → dose units → route → frequency → auxiliary

**Recommended UI validation rules:**
- If prescriber selects PRN frequency, **require** entry of indication/condition before allowing submission
- If prescriber selects "take as directed," **require** specification of the direction source (e.g., "as per package insert," "as per prescriber")
- **Expand Latin abbreviations** to plain English automatically (e.g., convert "BID" to "twice daily" in the displayed sig)
- **Do not allow truncation** across multiple fields — if the sig exceeds character limits, flag it rather than silently truncating
- For acute treatments, **require** duration of therapy entry

**Common sig deficiencies identified in research:**
- Missing dose/dose form (especially for topical products): Topical sigs had the highest rate of quality-related events (QREs) in e-prescriptions — lacking explicit dose amounts and site specifications ([JAMIA Quality and Variability study, 2018](https://pmc.ncbi.nlm.nih.gov/articles/PMC10398147/))
- Missing indication for PRN medications
- Conflicting information between free text and structured fields
- Abbreviations that could be misinterpreted (QD misread as QID)

### 6.5 DoseSpot Compound Prescribing Workflow

DoseSpot (a major e-prescribing platform used by many telehealth and specialty practices) provides a representative example of compound prescribing UI:

1. Prescriber clicks **"Compound"** button in the prescription entry interface
2. **Search for each ingredient** and select from database
3. Specify **strength and dispense unit** for each ingredient
4. Add ingredients one at a time using a "+" button
5. **Name the compound** and click "Build Compound"
6. System displays a standard prescription details screen — the sig is entered in the same fields as any standard medication (with pharmacist notes section for complex instructions)
7. Submit as standard e-prescription

**Limitation:** The sig entry step is effectively free text for complex compounds. There is no compound-specific structured sig builder for titration schedules.

**Sources:** [DoseSpot Prescribing Compound Medications guide (via Healthie)](https://help.gethealthie.com/article/1188-dosespot-prescribing-a-compounding-medication); [DoseSpot ePrescribing Process guide](https://dosespot.com/the-process-of-eprescribing-a-quick-start-guide-from-dosespot/)

### 6.6 PK Software (PCCA's Compounder Rx) — Dedicated Compounding Software

For pharmacies (not prescribers), PK Software's "The Compounder Rx" is one of the dominant dedicated compounding pharmacy management systems. It:
- Tracks patients, prescriptions, formulas, chemicals/ingredients, quality assurance, clinical screening
- Provides clinical drug screening (drug-drug interactions, contraindications) at the ingredient level for compounded products
- Supports OBRA 90 compliance for compounded products
- Integrates barcode scanning with scales for gravimetric verification during compounding
- Does **not** provide a prescriber-facing structured sig builder — it receives prescriptions and processes them

**Source:** [PK Software Products](http://www.rxcmpd.com/products/products.aspx)

---

## 7. Summary and Implications

### 7.1 Key Findings Summary

| Topic | Key Finding |
|-------|------------|
| **NCPDP S&C SIG adoption** | Only 10–32% of e-prescriptions use any structured sig fields; free text dominates |
| **Compound sigs in SCRIPT 2017071** | Supported (up to 25 ingredients, 1,000-char sig) but sig itself is free text |
| **Titration/multi-phase sigs** | No standardized structured representation; NCPDP Repeating Sig segments theoretically work but are rarely implemented; free text is universal |
| **Frequency code standardization** | Codes (QD, BID, etc.) are widely standardized but ISMP discourages many Latin abbreviations; SNOMED CT vocabulary coverage of timing terms is only 33% |
| **Compounded med coding** | No NDC; no RxCUI; use ingredient-level codes + custom local identifiers or HCPCS J-codes for billing |
| **FDB / Medi-Span role** | Provide drug vocabulary, dose form, route, and interaction data that feed sig builders; neither assigns codes to custom compounds |
| **Sig builder UI** | Dropdown builders are standard in EHRs but populate only free text, not structured fields; template-based sigs are the best practical approach for complex compounds |
| **Validation** | Completeness validation is UI-enforced (require action+dose+route+frequency+PRN indication) but structured data validation is largely absent |
| **Surescripts Sig IQ** | ML-based post-transmission conversion of free text → structured sig; augments 12.7% of transactions in 2025 |

### 7.2 The Practical Reality for Compounded Medication Sigs

Building a system that handles compounded medication sigs must confront:

1. **The free text reality:** Despite the existence of structured sig standards, the vast majority of compounded medication sigs — especially titration protocols — are and will be transmitted as free text. Any system must be capable of parsing, validating, and working with free text sigs.

2. **No drug code for compounds:** Systems cannot rely on NDC or RxCUI to identify compounded medications. Drug identity must be derived from ingredient names and strengths. This creates interoperability friction.

3. **Titration sigs are unsupported by current standards:** There is no standardized machine-readable format for expressing "increase dose by X every Y days up to Z." This must either be: (a) free text that humans parse, (b) a proprietary template system, or (c) a custom multi-phase sig data structure built outside the NCPDP standard.

4. **Character limits matter for complex protocols:** Even at 1,000 characters (SCRIPT 2017071), complex multi-month titration protocols may exceed limits. Systems should validate and warn.

5. **Sig quality is a documented patient safety problem:** Studies consistently show 10–16% of e-prescription sigs contain quality issues. Validation rules, template libraries, and post-transmission NLP (like Sig IQ) are the industry's responses.

---

## Sources

| Source | URL |
|--------|-----|
| JAMIA - Evaluation of NCPDP S&C Sig Format (2011) | https://pmc.ncbi.nlm.nih.gov/articles/PMC3168301/ |
| JAMIA - S&C SIG Implementation Outcomes (2022) | https://pmc.ncbi.nlm.nih.gov/articles/PMC9552209/ |
| JAMIA - Quality and Variability of Patient Directions (2018) | https://pmc.ncbi.nlm.nih.gov/articles/PMC10398147/ |
| Surescripts 2025 Annual Impact Report | https://surescripts.com/why-surescripts/our-impact/annual-impact-report |
| Surescripts/NCPA SCRIPT 2017071 CE Article (2019) | https://surescripts.com/sites/default/files/legacy/docs/default-source/intelligence-in-action/ncpa-surescripts_script_2017071_pharmacist_ce_article_11-2019.pdf |
| NCPDP SCRIPT v2017071 Testing Tool | https://www.ncpdp.org/Resources/NCPDP-SCRIPT-Version-2017071-ePrescribing-Testing |
| NCPDP ePrescribing Standards PDF | https://www.ncpdp.org/ncpdp/media/pdf/ncpdpeprescribing101.pdf |
| NCPDP Letter to ONC on RxNorm (2021) | https://standards.ncpdp.org/Standards/media/pdf/Correspondence/2021/NCPDPLettertoONConRxNorm.pdf |
| NCPDP/HIMSS ABCs of the SCRIPT Standard PDF | https://www.adldata.org/wp-content/uploads/2016/11/NCPDP_HIMSS_SCRIPT_final.pdf |
| Intuition Labs - NCPDP SCRIPT Standard Guide (2026) | https://intuitionlabs.ai/articles/ncpdp-script-standard-guide |
| Intuition Labs - NDC vs RxNorm Guide (2025) | https://intuitionlabs.ai/articles/ndc-vs-rxnorm-hcpcs-j-codes |
| LinkedIn - Tony Schueth on Structured Codified Sig (2016) | https://www.linkedin.com/pulse/taking-eprescribing-next-level-structured-codified-sig-tony-schueth |
| ChartMaker / Surescripts Best Practices for Sig Construction | https://chartmaker.com/best-practices-for-constructing-high-quality-patient-instructions-sig-within-e-prescriptions/ |
| Denali Rx - Sig Abbreviations | https://denalirx.com/sig-explanations/ |
| PharmaClik Rx SIG Codes (PDF) | https://www.pharmacytechnologysolutions.ca/pharmaclik-rx-doc/Content/Resources/PDFs/SIG%20Codes.pdf |
| Pharmacy Sig Codes (Quia) | https://www.quia.com/jg/1204727list.html |
| ISMP Error-Prone Abbreviations (2024 update) | https://www.ismp.org/recommendations/error-prone-abbreviations-list |
| PSQH - ISMP Updates Error-Prone Abbreviations (2024) | https://www.psqh.com/analysis/ismp-updates-tool-for-error-prone-abbreviations-symbols-and-dose-designations/ |
| FDB MedKnowledge Drug Database | https://www.fdbhealth.com/solutions/medknowledge-drug-database |
| FDB MedKnowledge Framework Datasheet (PDF) | https://www.fdbhealth.com/-/media/documents/form-not-required/us/datasheets/datasheet---fdb-medknowledge-framework.ashx |
| First Databank Wikipedia | https://en.wikipedia.org/wiki/First_Databank |
| Medi-Span GPI (Wolters Kluwer) | https://www.wolterskluwer.com/en/solutions/medi-span/about/gpi |
| PAAS National - Medi-Span GPI | https://paasnational.com/medi-span-generic-product-identifier/ |
| RxNorm Technical Documentation (NLM) | https://www.nlm.nih.gov/research/umls/rxnorm/docs/techdoc.html |
| Mapping Partners Master Drug Dictionary to RxNorm (JAMIA) | https://pmc.ncbi.nlm.nih.gov/articles/PMC12834468/ |
| Retinal Physician - Compounded Medication Coding Q&A (2021) | https://retinalphysician.com/issues/2021/may/coding-qa-the-lowdown-on-compounded-medications/ |
| SiCompounding Release Notes | https://www.sicompounding.io/release-notes |
| DoseSpot - Prescribing Compound Medications (Healthie) | https://help.gethealthie.com/article/1188-dosespot-prescribing-a-compounding-medication |
| DoseSpot ePrescribing Quick Start Guide | https://dosespot.com/the-process-of-eprescribing-a-quick-start-guide-from-dosespot/) |
| PK Software Products (PCCA/Compounder Rx) | http://www.rxcmpd.com/products/products.aspx |
| BD Cato Compounding Workflow Software (JMIR, 2021) | https://pmc.ncbi.nlm.nih.gov/articles/PMC8596227/ |
| Healthcare e-Prescribing Scoping Review (2024) | https://pmc.ncbi.nlm.nih.gov/articles/PMC11241554/ |
| Enterprise Health Documentation - Prescribing/Adding Medications | https://docs.enterprisehealth.com/features/medication-management-and-e-prescribing/prescribing-adding-medications/ |
