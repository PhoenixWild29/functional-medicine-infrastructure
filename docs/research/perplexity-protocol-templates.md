# Research Area 4: Protocol Templates in Functional Medicine
*Compiled: April 2026*

---

## Executive Summary

Functional medicine clinics rely heavily on multi-medication treatment protocols that combine compounded pharmaceuticals, peptides, hormones, and supplements into coordinated care plans. Current EHR software provides highly variable support for these workflows: some platforms (Cerbo, CharmHealth) offer meaningful compounding prescription infrastructure, while others (Practice Better, Fullscript) are limited to supplement and lifestyle recommendations without true prescription capability. No mainstream functional medicine EHR currently offers native conditional logic (lab-triggered medication additions), and titration is universally handled through workarounds rather than purpose-built scheduling engines. The compounding pharmacy workflow — direct-to-patient shipping, pharmacy routing, and multi-medication bundling — remains a largely manual process across most platforms.

---

## 1. Protocol Definition and Storage in Functional Medicine Clinics

### 1.1 What Constitutes a "Protocol"

Functional medicine protocols are structured, multi-medication care plans designed around root-cause investigation rather than symptom management. Unlike single-drug prescriptions, these protocols bundle multiple compounded medications, peptides, hormones, and nutraceuticals into a unified clinical plan that may run for 12–24 weeks or longer. ([Fullscript — Functional Medicine Protocols](https://fullscript.com/blog/functional-medicine-protocols))

Common protocol archetypes in functional medicine clinics include:

| Protocol Name | Typical Components |
|---|---|
| **Weight Loss Protocol** | Semaglutide + BPC-157 + Lipo-Mino injection (B vitamins + MIC) |
| **Hormone Optimization — Male** | Testosterone Cypionate + Anastrozole + HCG |
| **Hormone Optimization — Female** | Estradiol + Progesterone + DHEA + Testosterone |
| **Pain Management / Recovery** | BPC-157 + KPV peptide + Low-Dose Naltrexone (LDN) |
| **Anti-Aging / Longevity** | Sermorelin + NAD+ + Thymosin Alpha-1 |
| **Metabolic Optimization** | Tirzepatide + Metformin (compounded) + Berberine |
| **IV Therapy (Myers Cocktail)** | Magnesium + Calcium + B vitamins + Vitamin C |

([King's Pharmacy — Functional Medicine and Compounding](https://kingspharma.com/functional-medicine-and-compounding-the-perfect-partnership-for-personalized-wellness/))

### 1.2 How Multi-Medication Protocols Are Structured

Functional medicine protocols typically follow a three-phase framework — **Assessment → Intervention → Monitoring** — with each protocol defining:

- **Active ingredients** with specific doses and concentrations
- **Delivery method** (injection, sublingual, capsule, cream/gel, IV)
- **Frequency and timing** (e.g., weekly injection, nightly capsule)
- **Duration** (e.g., 12-week initial course, then maintenance)
- **Lab triggers or titration milestones** (e.g., recheck labs at week 8)

In practice, protocols are often stored as:

1. **Paper or PDF prescription templates** — Faxed to compounding pharmacies; providers fill in patient-specific fields by hand. Example: [JohnsRx Compounded Semaglutide/Tirzepatide Prescription Template](https://www.johnsrx.com/wp-content/uploads/2025/12/JohnsRx_WeightLoss_Prescription_Template.pdf) shows a pre-printed form with checkboxes for dose selection and pre-filled SIG language.

2. **EHR Chart Part templates** — In platforms like Cerbo, a "Chart Part" can bundle text, diagnoses, plan items, and prescriptions. The provider types a template name and the system inserts the entire protocol block into the encounter note.

3. **Supplement protocol templates** — In Fullscript or Practice Better, providers build reusable templates of supplement stacks that can be applied to patients with one click.

4. **Shared Google Docs / internal wikis** — Many smaller functional medicine clinics maintain protocol reference documents outside their EHR.

### 1.3 Patient Profile Differentiation (Male vs. Female, Weight-Based)

Protocol differentiation by patient profile is handled in current practice primarily through **clinical judgment at prescribing time** rather than automated branching. The provider selects a base protocol template and manually adjusts:

- **Sex-specific hormone substitutions** (testosterone for males vs. estradiol/progesterone for females)
- **Weight-based dosing** (e.g., semaglutide dose sometimes anchored to starting BMI)
- **Lab-informed adjustments** (e.g., anastrozole added only if estradiol is elevated; see Section 4)

No mainstream functional medicine EHR has a built-in "patient profile selector" that automatically serves a male vs. female variant of the same protocol. This is a manual workflow step.

---

## 2. Existing Protocol Management Software

### 2.1 Practice Better

**Category:** Health coaching / wellness EHR  
**Primary Users:** Nutritionists, health coaches, naturopaths, integrative practitioners

Practice Better supports reusable **Protocol Templates** under My Practice > Protocol Templates. A protocol can contain food recommendations, supplement recommendations (via built-in database or Fullscript integration), lifestyle recommendations, and attached files. ([Practice Better Help — Working with Protocol Templates](https://help.practicebetter.io/hc/en-us/articles/115004180527-Working-with-Protocol-Templates))

**Key features:**
- Create named protocol templates with defined focus, duration, and notes
- Add supplement recommendations from the Practice Better database or Fullscript catalog
- Import templates from a linked Fullscript account
- Apply a template to a client with one click, then customize per patient before publishing
- Share protocols across providers within a practice (via the My Practice library)

**Critical limitations:**
- **No prescription medication support** — Practice Better protocols handle supplements and lifestyle only; they do not support Rx prescriptions or compounded medications.
- **No titration scheduling** — Protocol supplements have a dose and frequency, but there is no phased titration engine.
- **No conditional logic** — Cannot define "add medication X if lab value Y"
- Supplement recommendations generate a patient-facing "supplement chart," not a prescription

([Practice Better — Protocols and Recommendations](https://practicebetter.io/features/protocols))

**Assessment:** Suitable for supplement-only functional medicine practices (health coaches, nutritionists). Not suitable for compounding prescription management.

---

### 2.2 Cerbo EHR

**Category:** Clinical EHR for integrative and functional medicine  
**Primary Users:** Physicians, NPs, PAs at functional medicine and DPC practices

Cerbo is widely considered the most feature-complete EHR for functional and integrative medicine. Its **Chart Parts** system is its core templating mechanism: a Chart Part is a named template that can auto-populate text, diagnoses, lab orders, treatment plan items (prescriptions, supplements, IV therapies), and charges when the provider types the template name in an encounter note. ([Cerbo — EHR Features](https://www.cer.bo/features/ehr-features/))

**Compounding prescription support:**
- Supports **e-prescribing of compounded medications** via eRx and e-fax
- Custom compounded medications (bio-identical hormones, peptides) can be added to the medication list and formally prescribed
- **Preferred pharmacy pre-selection**: the patient's preferred compounding pharmacy can be set in advance, making it the default routing destination when sending a compounded prescription ([Cerbo FAQ](https://www.cer.bo/resources/frequently-asked-questions/))
- Compounded medications are managed in the **Medications module** (not the Alternate Plan Items module, which is for supplements, IV therapy, and injections)

**Protocol template support:**
- Chart Parts can bundle multiple prescriptions, diagnoses, and plan items into one insertable template
- Custom **IV therapy protocols** are supported with structured dosing fields
- **Dosing profiles** for supplements, injections, and IV infusions save default dosing parameters
- Wellness Plan tracker for comprehensive long-term care plans shared via the Patient Portal
- **Supplement protocols**: supplements can be grouped into protocols within the Cerbo supplement database, with saved dosing instructions ([Cerbo Alternate Plan Items](https://cerbo.zendesk.com/hc/en-us/articles/38982771748891-Alternate-Plan-Items-Add-Manage-Custom-Recommendations-and-Plans))

**Limitations:**
- No native titration scheduling engine — multi-phase dose escalation is handled by creating separate prescriptions for each phase (or writing a complex SIG)
- No conditional logic (lab-triggered medication additions)
- Protocol sharing across providers is possible within the same practice via Chart Parts

([Cerbo — Functional Medicine EHR Guide by Meelio](https://www.meelio.ai/blog/cerbo-ehr-functional-medicine-ai-integration))

**Assessment:** Best-in-class for functional medicine compounding workflows. Handles compounding Rx, preferred pharmacy routing, and supplement/injection protocols well. Multi-medication protocol templates require manual construction via Chart Parts.

---

### 2.3 Elation EHR

**Category:** Primary care / DPC EHR  
**Primary Users:** Independent physicians

Elation's **Prescription (Rx) Templates** allow providers to save frequently used medication specifications (medication name, sig, quantity, unit, refills, days supply, NDC) as reusable templates. When prescribing, the provider searches for a medication and practice-created templates appear at the top of the dropdown, auto-filling all saved fields. ([Elation Help — Prescription Rx Templates Guide](https://help.elationemr.com/articles/Knowledge/create-and-use-custom-rx-templates))

**Key features:**
- Per-medication Rx templates with pre-saved sig, quantity, refills, and NDC
- Templates appear first in the medication search dropdown
- Managed from the Prescriptions Settings page
- Custom Sigs can be saved for reuse

**Limitations:**
- Rx templates are per-medication, not multi-medication protocol bundles
- No compounding-specific fields or compounding pharmacy routing
- Note templates (for visit documentation) are separate from prescription templates
- No titration scheduling, conditional logic, or auto-fill of multi-drug protocols
- Compounding support is functional but not documented as specialized

([Fullscript — Integrating Compounding Pharmacy](https://fullscript.com/blog/integrating-compounding-pharmacy) mentions Elation as a platform used for EMR integration with compounding pharmacies)

**Assessment:** Adequate for saving individual prescription templates; not built for multi-medication protocol management or complex compounding workflows.

---

### 2.4 CharmHealth EHR

**Category:** Comprehensive EHR, including functional medicine  
**Primary Users:** Multi-specialty practices, integrative medicine

CharmHealth supports multiple template types including prescription templates, supplement templates, and consultation (SOAP) templates. ([CharmHealth — Creating Templates](https://www.charmhealth.com/resources/consultation/creating-templates.html))

**Supplement/protocol template support:**
- Create **Supplement Templates** via Settings > Templates > My Templates
- For supplement type "Compounded": select from a Preparations list with intake details, directions, dispensing information, and a **Weaning schedule** field — the closest analog to a titration schedule in the platform
- Templates can be created from the CharmHealth database, Fullscript, or WholeScripts ([CharmHealth — Creating Supplement Templates](https://www.charmhealth.com/resources/consultation/creating-supplement-template.html))
- Apply a Fullscript supplement template directly from the Patient Dashboard (Medications > Supplements > Add from Templates)
- Multiple supplements can be transmitted to Fullscript simultaneously ([CharmHealth — Fullscript Integration](https://www.charmhealth.com/resources/addons/fullscript.html))

**Prescription template support:**
- General template framework supports prescription templates (SOAP, Diagnosis, Lab Orders, Prescriptions, Vaccination, Referrals)
- Rx templates can be created and reused

**Limitations:**
- No documented multi-drug compounding protocol template
- No conditional logic
- Fullscript integration handles supplement orders, but compounding Rx workflow is less documented
- "Weaning schedule" field in supplement templates suggests some titration note capability, but not a structured engine

**Assessment:** Functional but mid-tier. Fullscript integration is strong. Compounding-specific prescription workflows are less developed than Cerbo.

---

### 2.5 Fullscript

**Category:** Supplement dispensary platform  
**Primary Users:** All healthcare practitioners who recommend supplements

Fullscript is the leading professional supplement dispensary platform, used by over 100,000 healthcare providers serving more than 10 million patients. ([Meelio — Supplement Protocol Management Guide](https://www.meelio.ai/blog/supplement-protocol-management-functional-medicine-guide))

**Protocol template features:**
- **Built-in template library** (made by Fullscript's Medical Advisory team) — evidence-informed templates for common conditions
- **Custom templates** — practitioners can create and save their own supplement protocol templates
- **Template sharing** — practitioners can share custom templates with colleagues in the same practice ([Fullscript Support — Plan Building Tool](https://support.fullscript.com/articles/the-plan-building-tool/))
- Applying a template adds all products to a draft plan, which the provider then customizes per patient before sending
- **Ingredient breakdown tool** calculates real-time ingredient totals as products are added or doses adjusted
- Plans include supplements, lab testing recommendations, resources (handouts, infographics), and a personalized message
- **Auto refill** and **refill reminders** are built in for patient adherence

**Limitations:**
- Supplements only — not a prescription platform; does not handle compounded medications, Rx drugs, or controlled substances
- No titration scheduling
- No conditional logic

([Fullscript — 8 Features to Improve Treatment Adherence](https://fullscript.com/blog/fullscript-adherence-boosting-tools))

**Assessment:** The gold standard for supplement protocol templates. Excellent template library, sharing, and dispensing workflow. Not applicable to compounding Rx prescriptions.

---

### 2.6 Wellevate

**Category:** Supplement dispensary platform (now integrated into Fullscript ecosystem)  
**Primary Users:** Practitioners who recommend professional supplements

Wellevate is an e-prescribing supplement platform that allows practitioners to create patient profiles, send supplement recommendations, and manage orders from a centralized platform. Practitioners can create electronic prescriptions with dosage instructions including quantity, frequency, duration, and daily timing. ([GetApp — Wellevate 2026](https://www.getapp.com/healthcare-pharmaceuticals-software/a/wellevate/))

**Note:** As of 2025–2026, Wellevate has been substantially integrated into the Fullscript ecosystem. Cerbo (and other EHRs) list both Fullscript and Wellevate as supplement dispensary integrations.

**Assessment:** Functionally similar to Fullscript for supplement protocol recommendations; supplement-only platform.

---

### 2.7 Power2Practice

**Category:** EMR for functional, integrative, and anti-aging medicine  
**Primary Users:** Anti-aging, functional medicine, integrative practices  
**Endorsement:** American Academy of Anti-Aging Medicine (A4M)

Power2Practice is purpose-built for functional medicine with:
- Customizable note templates for functional medicine workflows
- Over 30 built-in IV therapy protocols
- Lab integrations with ZRT, Genova, Precision Analytical, Quest, and LabCorp
- Comprehensive e-prescribe system including EPCS (controlled substances) and compounded prescriptions
- Pharmacy integration for real-time prescription routing

([Power2Practice — Features](https://power2practice.com/features/)) ([EHRInPractice — Power2Practice](https://www.ehrinpractice.com/power2practice-emr.html))

**Assessment:** Solid option for anti-aging/functional medicine with built-in compounding Rx. Less documentation available than Cerbo on protocol template depth.

---

### 2.8 Salus EMR

**Category:** Functional medicine-specific EHR  
**Positioning:** "Next-generation functional medicine EHR"

Salus EMR explicitly includes a **Protocol builder for supplements, herbs, peptides, and lifestyle plans**, along with hormone and metabolic protocol support. Supports building custom supplement recommendations, tracking compliance, and updating protocols over time. ([Salus EMR](https://salusemr.com/medicine-ehr-emr-software))

**Assessment:** Purpose-built positioning suggests strong protocol support, though market adoption is smaller than Cerbo or CharmHealth.

---

### 2.9 My Practice Connect ERX Platform

**Category:** Standalone compounding prescription e-prescribing platform (not a full EHR)

My Practice Connect is a centralized eRx platform designed specifically for the functional medicine / compounding pharmacy workflow. Key features: ([My Practice Connect — ERX Platform](https://mypracticeconnect.com/rx-platform/))

- Access multiple FDA-registered 503A and 503B compounding pharmacies through a single portal
- View real-time inventory and pricing across pharmacies
- Secure messaging with pharmacy teams
- Place individual or bulk orders
- Automated refill reminders
- Access to over 20 IV nutrient protocols and wellness protocols (autism, insomnia, low libido, anxiety, fibromyalgia)
- Physician-formulated supplements and compounded medications shipped directly to patients' homes

**Assessment:** Best specialized tool for compounding Rx routing when the provider's EHR lacks deep compounding support. Acts as a middleware layer between EHR and multiple compounding pharmacies.

---

## 3. Titration Phase Handling

### 3.1 Clinical Context of Titration

Titration — the stepwise escalation of medication dose over time — is a core feature of many functional medicine protocols. The primary driver is minimizing adverse effects during dose initiation while reaching therapeutic effect.

**Semaglutide Standard Titration Schedule:**

| Phase | Weeks | Dose | Notes |
|---|---|---|---|
| Initiation | 1–4 | 0.25 mg SQ weekly | Adjustment phase; GI tolerance |
| Escalation 1 | 5–8 | 0.5 mg SQ weekly | Therapeutic effect begins |
| Escalation 2 | 9–12 | 1.0 mg SQ weekly | Appetite suppression significant |
| Escalation 3 | 13–16 | 1.7 mg SQ weekly | (Wegovy protocol) |
| Maintenance | 17+ | 2.4 mg SQ weekly (Wegovy) or 2.0 mg (Ozempic) | |

([TrimRx — Semaglutide Dosage for Weight Loss: Complete Titration Guide](https://trimrx.com/blog/semaglutide-dosage-for-weight-loss-complete-titration-guide/)) ([NIH PMC — The Art and Science of Drug Titration](https://pmc.ncbi.nlm.nih.gov/articles/PMC7967860/))

Compounding pharmacies typically supply semaglutide in single multi-use vials (e.g., 5 mg/2 mL or 10 mg/2 mL) sized to accommodate multiple titration phases from a single prescription, reducing the number of separate Rx orders needed. ([Strive Pharmacy Compounded Semaglutide FAQ via goodhormonehealth.com](https://www.goodhormonehealth.com/pdfs/strive%20pharmacy-compounded%20semaglutiude%20-FAQ.pdf))

**Low-Dose Naltrexone (LDN) Standard Titration:**

| Phase | Dose | Duration |
|---|---|---|
| Start | 0.5 mg nightly | Week 1 |
| Escalation | +0.5 mg every 5–7 days | Weeks 2–9 |
| Target | 4.5 mg nightly | Maintenance |
| Sensitive patients | Slower titration possible | Start at 0.1 mg |

([Bateman Horne Center — Low Dose Naltrexone PDF](https://batemanhornecenter.org/wp-content/uploads/2024/09/Low-Dose-Naltrexone-LDN-20240911.pdf)) ([TC Compound — LDN Titration Kits](https://tccompound.com/blogs/health-hub/titration-kits-low-dose-naltrexone-ldn-ramsey-nj))

### 3.2 How Titration Is Represented in Current Software

**None of the mainstream functional medicine EHRs have a dedicated titration scheduling engine.** The two primary workarounds used in practice are:

**Option A: Complex SIG on a single prescription**
The prescriber writes a narrative sig that encodes the entire escalation schedule:
> *"Inject 0.25 mg SQ weekly for 4 weeks, then 0.5 mg weekly for 4 weeks, then 1.0 mg weekly for 4 weeks. May increase dose as directed by prescriber."*

This is the most common approach. The compounding pharmacy fulfills a single large vial containing enough medication for all phases. ([JohnsRx Prescription Template PDF](https://www.johnsrx.com/wp-content/uploads/2025/12/JohnsRx_WeightLoss_Prescription_Template.pdf))

The sig field in EHRs (including Cerbo, Elation, and CharmHealth) supports free-text entry, so any titration schedule can be encoded in the directions. Elation even supports **custom SIGs** saved as reusable templates. ([Elation Help — Prescription Rx Templates](https://help.elationemr.com/articles/Knowledge/create-and-use-custom-rx-templates))

**Option B: Multiple sequential prescriptions**
Some clinics write separate prescriptions for each titration phase:
- Prescription 1: Semaglutide 0.25 mg weekly × 4 weeks, no refills
- Prescription 2: Semaglutide 0.5 mg weekly × 4 weeks (sent at week 4)
- Prescription 3: Semaglutide 1.0 mg weekly × 4 weeks (sent at week 8)

This approach requires either **manual tracking** of when to send the next phase or use of calendar-based reminders. DrChrono, for example, supports sending multiple eRx orders simultaneously from a patient chart. ([DrChrono Support — How Do I Send Multiple eRx Orders](https://support.drchrono.com/home/360022803432-how-do-i-send-multiple-erx-orders-at-the-same-time-from-the-patient-chart))

**Option C: Titration kits from the compounding pharmacy**
Several compounding pharmacies offer pre-packaged "titration kits" that contain multiple labeled vials (e.g., LDN 0.5 mg, 1.0 mg, 1.5 mg, 2.0 mg, 2.5 mg, 3.0 mg, 3.5 mg, 4.0 mg, 4.5 mg). A single prescription is written for the kit, and the pharmacy fulfills it as a boxed set with instructions. This is common for LDN. ([TC Compound — LDN Titration Kits](https://tccompound.com/blogs/health-hub/titration-kits-low-dose-naltrexone-ldn-ramsey-nj))

### 3.3 Summary: EHR Titration Support

| Platform | Titration Mechanism | Notes |
|---|---|---|
| Cerbo | Complex SIG / multiple Rx | Chart Parts can template the SIG |
| Elation | Complex SIG / custom saved SIGs | Rx templates save per-medication sig |
| CharmHealth | Weaning schedule field in supplement templates | Supplement-only; Rx uses free-text sig |
| Practice Better | Not applicable | Supplement-only platform |
| Fullscript | Not applicable | Supplement-only platform |
| Power2Practice | Complex SIG / multiple Rx | Compounding Rx supported |

---

## 4. Conditional Medications in Protocols

### 4.1 Clinical Use Cases

Functional medicine protocols routinely involve medications that are added conditionally based on lab results:

- **Anastrozole**: Added to male hormone optimization protocols only if estradiol > 30–40 pg/mL (too high estrogen from testosterone aromatization). Typical dose: 0.25–1 mg twice weekly. ([RPC2B — Guide to Writing Compounded HRT Prescriptions](https://rpc2b.com/blog/post/a-guide-to-writing-a-compounded-prescription-for-hormone-replacement-therapy-hrt))
- **B12 Injection**: Added if serum B12 < 400–500 pg/mL
- **Thyroid compound**: Added if TSH, Free T3, or Free T4 outside optimal functional range
- **DHEA**: Added if DHEA-S below functional threshold, with sex-specific dosing
- **HCG**: Added to TRT protocols for testicular preservation, sometimes conditional on testicular atrophy or fertility goals

### 4.2 Current Software Support for Conditional Logic

**No mainstream functional medicine EHR currently offers native lab-triggered conditional medication logic in protocol templates.**

What exists in the broader EHR space:
- **Clinical Decision Support (CDS) tools** in hospital-grade systems (Epic, Cerner) can create rules that fire alerts when lab values meet specific criteria. A systematic review found these tools improve appropriate medication adjustments when lab values are abnormal. ([NIH PMC — Effect of Lab-Based CDS Tools on Medication Dosing](https://pmc.ncbi.nlm.nih.gov/articles/PMC9533234/))
- The **Event-Condition-Action model** ("ON event IF condition THEN action") is a standard CDS architecture, but implementation requires significant engineering effort and is typically only present in enterprise EHRs. ([SNOMED CT CDS Guide](https://docs.snomed.org/snomed-ct-practical-guides/snomed-ct-clinical-decision-support-guide/3-knowledge-base/3.1-rules))

**How functional medicine clinics currently handle this:**
Conditional medication decisions are made at the point of care by the clinician reviewing lab results. The workflow is:

1. Labs return and auto-populate into the EHR
2. Provider reviews lab panel at follow-up visit or via asynchronous chart review
3. Provider manually adds anastrozole (or adjusts dose) to the prescription list based on the estradiol value
4. The updated prescription is sent to the compounding pharmacy

Protocol templates may include a **note or reminder** in the template text (e.g., "If E2 > 35, add Anastrozole 0.5 mg twice weekly") but the trigger is human, not automated.

**Cerbo** has lab integrations with over 60 specialty and conventional labs, and lab results populate the patient chart automatically. However, there is no documented feature for auto-triggering a prescription order based on a lab value threshold. ([Cerbo — Functional Medicine Labs](https://www.cer.bo/post/functional-medicine-labs/))

**Meelio AI** (an AI assistant built on top of Cerbo) is emerging as a way to provide phase-aware documentation and protocol suggestions based on lab values — though this still requires clinician approval rather than automated prescribing. ([Meelio — Cerbo EHR Functional Medicine AI Integration](https://www.meelio.ai/blog/cerbo-ehr-functional-medicine-ai-integration))

---

## 5. Auto-Fill from Protocol Templates

### 5.1 Platform Capabilities

| Feature | Cerbo | CharmHealth | Elation | Practice Better | Fullscript |
|---|---|---|---|---|---|
| Create custom templates | ✓ (Chart Parts) | ✓ | ✓ (note + Rx) | ✓ | ✓ |
| Auto-fill Rx from template | ✓ (Chart Parts) | ✓ (Rx templates) | ✓ (per-drug Rx template) | ✗ (no Rx) | ✗ (no Rx) |
| Auto-fill multi-drug protocol | ✓ (via Chart Parts bundling) | Partial | ✗ | ✗ | ✗ |
| Adjust dose within template | ✓ (edit before finalizing) | ✓ | ✓ | ✓ | ✓ |
| Share across providers | ✓ (practice-wide Chart Parts) | ✓ | ✓ (practice-wide Rx templates) | ✓ | ✓ |
| Lab-based conditional auto-fill | ✗ | ✗ | ✗ | ✗ | ✗ |

### 5.2 Cerbo: Chart Parts — Deepest Multi-Medication Auto-Fill

Cerbo's **Chart Parts** system is the most capable native multi-medication protocol auto-fill currently available in the functional medicine EHR space. A Chart Part can encode:

- Free-text documentation blocks (assessment, plan narrative)
- Multiple diagnosis codes
- Multiple plan items (prescriptions, lab orders, supplement orders, IV therapy orders)
- Billing charges

When a provider types the Chart Part name in an encounter note, the entire bundle is inserted and individual items appear as "suggested actions" to accept or dismiss. This effectively functions as a one-click protocol template that populates multiple prescriptions simultaneously.

The provider can then edit any individual item (dose, sig, quantity) before finalizing — supporting per-patient dose adjustment within the protocol template. ([Cerbo — EHR Features](https://www.cer.bo/features/ehr-features/))

### 5.3 Fullscript: Supplement-Specific Template System

For supplement protocols, Fullscript is the most polished platform:
- **Made by Fullscript** templates in the Knowledge Center are pre-built condition-specific supplement stacks
- **Custom practitioner templates** are saved from the Templates section and shared practice-wide
- Applying a template opens a draft plan with all products pre-populated, including manufacturer-suggested dosing
- Providers can adjust individual doses, add resources, and write patient messaging before sending ([Fullscript Support — Plan Building Tool](https://support.fullscript.com/articles/the-plan-building-tool/))

### 5.4 Practice Better: Reusable Supplement Protocols

Practice Better allows creating protocol templates that are applied per client:
- Click "Create for..." next to any template, select the client, and a draft protocol opens
- Can be customized per client before publishing to the client portal
- Generates a patient-facing supplement chart with dose and frequency summary
- Integrates with Fullscript for direct supplement fulfillment ([Practice Better Help — Working with Protocol Templates](https://help.practicebetter.io/hc/en-us/articles/115004180527-Working-with-Protocol-Templates))

---

## 6. Compounding-Specific Workflow in EHRs

### 6.1 The Compounding Prescription Workflow

Compounded medications differ fundamentally from standard retail pharmacy prescriptions in their workflow:

1. **Prescription creation**: Provider writes the compound spec (active ingredient, strength/concentration, quantity, delivery form, SIG)
2. **Pharmacy routing**: Prescription is routed to a specific compounding pharmacy (503A individual patient or 503B outsourcing facility) — not the patient's local pharmacy
3. **Patient shipping**: The compounding pharmacy ships directly to the patient's home address (not dispensed locally)
4. **Multi-medication bundling**: When a patient is on multiple compounds, the pharmacy may bundle them in one monthly shipment

The required fields on a compounding prescription differ from standard Rx: ([Symphony Pharmacy — Writing a Prescription for a Compounded Medication](https://www.symphonypharmacy.com/pharmacy-compounding-for-providers/writing-a-prescription-for-a-compounded-medication))

- Patient identification (name, DOB, **shipping address**)
- Generic name of ALL active ingredients
- Strength/dose of each ingredient (in mg, %, or g)
- Formulation desired (cream, gel, capsule, injectable, sublingual)
- Quantity and days supply
- Directions for use
- Medical necessity statement (increasingly required)
- Refills

### 6.2 Patient Shipping Address in EHRs

Patient shipping address is a critical but often-overlooked field for compounding prescriptions. Key platform behaviors:

- **Cerbo**: Patient demographic fields include address. Compounding pharmacy prescriptions sent via e-fax include patient information including address. Patient can update preferred pharmacies and associated address information via the Patient Portal. The system pre-populates the patient's preferred compounding pharmacy. ([Cerbo — EHR Features](https://www.cer.bo/features/ehr-features/))
- **Elation**: Patient address is required before sending an eRx. The system stores patient address in demographics and includes it in prescription transmissions. ([DrChrono — Multiple eRx Orders](https://support.drchrono.com/home/360022803432-how-do-i-send-multiple-erx-orders-at-the-same-time-from-the-patient-chart))
- **My Practice Connect**: Explicitly positions compounded medications as "shipped directly to patients' homes," with the platform coordinating the delivery logistics. ([My Practice Connect — ERX Platform](https://mypracticeconnect.com/rx-platform/))
- **Empower Pharmacy**: One of the largest compounding pharmacies in the U.S., ships via UPS ground or overnight with tracking. Patient address is captured at prescription time. ([Empower Pharmacy — Shipping](https://www.empowerpharmacy.com/compounding-pharmacy-shipping-coverage/))

### 6.3 Pharmacy Selection

**Functional medicine clinics typically work with 1–3 preferred compounding pharmacies** with which they have established relationships, pricing agreements, and familiarity with formularies. The major compounding pharmacies used by functional medicine practices include Empower Pharmacy, Strive Pharmacy, Wells Pharmacy Network, Tailor Made Compounding, and Hallandale Health.

**EHR pharmacy selection support:**

- **Cerbo**: Nationwide pharmacy database; provider can set a short-list of preferred pharmacies including compounding pharmacies. The patient's preferred pharmacy (including their compounding pharmacy) is accessible and pre-populated when creating a new Rx. ([Cerbo — EHR Features](https://www.cer.bo/features/ehr-features/))
- **General EHRs with eRx**: Surescripts network (used by most EHRs for eRx) includes some compounding pharmacies that accept electronic prescriptions; others require e-fax. Many compounding pharmacies accept eFax prescriptions as the primary transmission method.
- **My Practice Connect**: Routes prescriptions to multiple 503A and 503B pharmacies from a single portal. Providers can view real-time inventory and pricing across pharmacies before choosing where to route. ([My Practice Connect — ERX Platform](https://mypracticeconnect.com/rx-platform/))

### 6.4 Multi-Medication Bundle Orders

When a patient is on a protocol involving multiple compounded medications (e.g., Testosterone Cypionate + Anastrozole + HCG), there are two shipping models:

**Model 1: Separate prescriptions, same pharmacy, bundled shipment**
The provider writes separate Rx for each compound but routes all to the same compounding pharmacy. The pharmacy consolidates into one monthly shipment. Wells Pharmacy Network's "Wellness Bundles" explicitly supports this model — pairing commonly co-prescribed compounds (e.g., Naltrexone + Sermorelin; Semaglutide/Metformin + Sermorelin) into one consistent monthly shipment. ([Wells Pharmacy Network — Wellness Bundles](https://wellsrx.com/wellness-bundles/))

**Model 2: Multi-ingredient single compound**
The compounding pharmacy formulates multiple active ingredients into a single preparation (e.g., Testosterone + Anastrozole cream, or Semaglutide + B12 + Glycine injectable). This reduces the number of separate Rx orders and simplifies patient administration.

**EHR support for multi-Rx simultaneous ordering:**
- **DrChrono**: Documented support for sending multiple eRx orders simultaneously from a patient chart using a batch workflow. ([DrChrono — Multiple eRx Orders](https://support.drchrono.com/home/360022803432-how-do-i-send-multiple-erx-orders-at-the-same-time-from-the-patient-chart))
- **Cerbo**: Chart Parts can include multiple Rx items that are inserted simultaneously into the encounter note, then processed as a batch.
- **General workflow**: Most EHRs allow multiple prescriptions to be written during a single encounter and transmitted together or sequentially.

---

## 7. Emerging and Adjacent Tools

### 7.1 PioneerRx and Liberty Software

These pharmacy management systems are used by compounding pharmacies themselves (rather than by prescribers) to process and manage compounded orders. Integration between EHRs (Elation, Cerbo) and these systems is cited as a key workflow improvement tool for functional medicine practices. ([Fullscript — Integrating Compounding Pharmacy](https://fullscript.com/blog/integrating-compounding-pharmacy))

### 7.2 AI-Assisted Protocol Documentation

Meelio AI is an AI assistant purpose-built for functional medicine that listens to consultations and automatically generates care plans populated with supplement protocols from custom templates. It can handle phase-aware documentation for multi-stage protocols (e.g., Shoemaker Protocol for CIRS) and surfaces protocol-specific AI recommendations based on lab results — though clinician approval is still required. ([Meelio — Cerbo EHR Functional Medicine AI Integration](https://www.meelio.ai/blog/cerbo-ehr-functional-medicine-ai-integration))

### 7.3 DTP (Direct-to-Patient) Dispensing Platforms

Develop Health and similar platforms are building direct-to-patient dispensing infrastructure that integrates with EHRs to automate the compounding prescription journey: prescribing → coverage check → fulfillment → home delivery. These platforms handle patient shipping addresses automatically and coordinate cold-chain logistics for temperature-sensitive compounds. ([Develop Health — DTP Dispensing](https://www.develophealth.ai/blog/dtp-dispensing))

---

## 8. Key Gaps and Implications for Software Design

Based on this research, the following critical gaps exist in current functional medicine software:

| Gap | Current State | Implication |
|---|---|---|
| **True multi-medication protocol bundles** | Workarounds via Chart Parts (Cerbo) or manual bundling | A "protocol template" that instantiates multiple Rx simultaneously with one click would save 10+ minutes per encounter |
| **Titration scheduling engine** | Complex SIG text or multiple separate Rx | A visual titration timeline that automatically generates scheduled prescriptions per phase would reduce errors |
| **Conditional lab-triggered medications** | Entirely manual; clinician reviews and decides | Even a soft alert ("Estradiol is 52 pg/mL — consider adding Anastrozole per your protocol") would improve workflow |
| **Patient shipping address on Rx** | Captured in demographics but not always surfaced in Rx workflow | Dedicated "ship to patient" toggle with address confirmation would reduce shipping errors |
| **Multi-pharmacy price comparison** | Only My Practice Connect offers this | EHR-native pharmacy price/inventory comparison would simplify pharmacy selection |
| **Protocol variant logic (male/female)** | Manual template selection | Protocol templates with branching (select patient sex → load appropriate variant) would reduce selection errors |
| **Cross-provider protocol sharing** | Available in Cerbo (Chart Parts), Fullscript, Practice Better | Practice-wide protocol libraries with version control are a meaningful workflow improvement |

---

## Sources

1. [Fullscript — Functional Medicine Protocols](https://fullscript.com/blog/functional-medicine-protocols)
2. [King's Pharmacy — Functional Medicine and Compounding: The Perfect Partnership](https://kingspharma.com/functional-medicine-and-compounding-the-perfect-partnership-for-personalized-wellness/)
3. [Practice Better Help — Working with Protocol Templates](https://help.practicebetter.io/hc/en-us/articles/115004180527-Working-with-Protocol-Templates)
4. [Practice Better — Protocols and Recommendations Feature Page](https://practicebetter.io/features/protocols)
5. [Cerbo — Best EHR Software for Patient-Centric Practices (EHR Features)](https://www.cer.bo/features/ehr-features/)
6. [Cerbo — The Functional & Integrative Medicine Industry's Best EHRs](https://www.cer.bo/post/the-functional-integrative-medicine-industrys-best-ehrs/)
7. [Cerbo — Functional Medicine Labs Integration](https://www.cer.bo/post/functional-medicine-labs/)
8. [Cerbo — FAQs](https://www.cer.bo/resources/frequently-asked-questions/)
9. [Cerbo — Alternate Plan Items](https://cerbo.zendesk.com/hc/en-us/articles/38982771748891-Alternate-Plan-Items-Add-Manage-Custom-Recommendations-and-Plans)
10. [Cerbo — E-Prescribing](https://www.cer.bo/post/ehr-e-prescribing/)
11. [Meelio — Cerbo EHR Functional Medicine AI Integration](https://www.meelio.ai/blog/cerbo-ehr-functional-medicine-ai-integration)
12. [Elation Help — Prescription (Rx) Templates Guide](https://help.elationemr.com/articles/Knowledge/create-and-use-custom-rx-templates)
13. [Elation — Note Templates](https://help.elationhealth.com/articles/Elation-Note-Guide-Managing-Templates)
14. [Elation — Innovative EHR Features: Medical Office Visit Note Template](https://www.elationhealth.com/resources/blogs/innovative-ehr-features-medical-office-visit-note-template)
15. [CharmHealth — Creating Templates](https://www.charmhealth.com/resources/consultation/creating-templates.html)
16. [CharmHealth — Creating Supplement Templates](https://www.charmhealth.com/resources/consultation/creating-supplement-template.html)
17. [CharmHealth — Fullscript Integration](https://www.charmhealth.com/resources/addons/fullscript.html)
18. [Fullscript — Best EMR Systems for Functional Medicine Practices](https://fullscript.com/blog/emr-systems-for-functional-medicine)
19. [Fullscript Support — The Plan Building Tool](https://support.fullscript.com/articles/the-plan-building-tool/)
20. [Fullscript — 8 Features to Improve Treatment Adherence](https://fullscript.com/blog/fullscript-adherence-boosting-tools)
21. [Fullscript — Integrating Compounding Pharmacy in Practice](https://fullscript.com/blog/integrating-compounding-pharmacy)
22. [Fullscript — Auto Refill](https://fullscript.com/blog/patient-autoship)
23. [Wellevate — GetApp 2026 Profile](https://www.getapp.com/healthcare-pharmaceuticals-software/a/wellevate/)
24. [Power2Practice — Features](https://power2practice.com/features/)
25. [EHRInPractice — Power2Practice EMR](https://www.ehrinpractice.com/power2practice-emr.html)
26. [SoftwareFinder — Power2Practice](https://softwarefinder.com/emr-software/power2practice)
27. [Salus EMR — Functional Medicine EHR](https://salusemr.com/medicine-ehr-emr-software)
28. [My Practice Connect — ERX Platform](https://mypracticeconnect.com/rx-platform/)
29. [IntegrativePracticeTech — Best EMR for Functional Medicine 2026](https://integrativepracticetech.com/guides/best-emr-functional-medicine-2026)
30. [TrimRx — Semaglutide Dosage for Weight Loss: Complete Titration Guide](https://trimrx.com/blog/semaglutide-dosage-for-weight-loss-complete-titration-guide/)
31. [NIH PMC — The Art and Science of Drug Titration](https://pmc.ncbi.nlm.nih.gov/articles/PMC7967860/)
32. [Bateman Horne Center — Low Dose Naltrexone PDF](https://batemanhornecenter.org/wp-content/uploads/2024/09/Low-Dose-Naltrexone-LDN-20240911.pdf)
33. [TC Compound — LDN Titration Kits](https://tccompound.com/blogs/health-hub/titration-kits-low-dose-naltrexone-ldn-ramsey-nj)
34. [Dr. Oracle — Low-Dose Naltrexone Dosing Protocols](https://www.droracle.ai/articles/719507/what-is-the-recommended-dosing-protocol-for-low-dose)
35. [JohnsRx — Compounded Semaglutide/Tirzepatide Prescription Template PDF](https://www.johnsrx.com/wp-content/uploads/2025/12/JohnsRx_WeightLoss_Prescription_Template.pdf)
36. [DrChrono Support — Send Multiple eRx Orders Simultaneously](https://support.drchrono.com/home/360022803432-how-do-i-send-multiple-erx-orders-at-the-same-time-from-the-patient-chart)
37. [NIH PMC — Effect of Lab-Based CDS Tools on Medication Dosing](https://pmc.ncbi.nlm.nih.gov/articles/PMC9533234/)
38. [Wells Pharmacy Network — Wellness Bundles](https://wellsrx.com/wellness-bundles/)
39. [Symphony Pharmacy — Writing a Prescription for a Compounded Medication](https://www.symphonypharmacy.com/pharmacy-compounding-for-providers/writing-a-prescription-for-a-compounded-medication)
40. [Empower Pharmacy — Compounding Pharmacy Shipping Coverage](https://www.empowerpharmacy.com/compounding-pharmacy-shipping-coverage/)
41. [Develop Health — DTP Dispensing](https://www.develophealth.ai/blog/dtp-dispensing)
42. [Meelio — Supplement Protocol Management Guide](https://www.meelio.ai/blog/supplement-protocol-management-functional-medicine-guide)
43. [RPC2B — Guide to Writing Compounded Prescription for HRT](https://rpc2b.com/blog/post/a-guide-to-writing-a-compounded-prescription-for-hormone-replacement-therapy-hrt)
44. [NIH PMC — Individualization of Custom Compounded Hormone Therapy](https://pmc.ncbi.nlm.nih.gov/articles/PMC6629201/)
45. [Defy Medical — HCG Protocol Update PDF](https://www.defymedical.com/wp-content/uploads/2022/06/An-update-to-the-Crisler-HCG-Protocol.pdf)
46. [Strive Pharmacy Compounded Semaglutide FAQ](https://www.goodhormonehealth.com/pdfs/strive%20pharmacy-compounded%20semaglutiude%20-FAQ.pdf)
