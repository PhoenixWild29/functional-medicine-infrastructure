# CompoundIQ — Cascading Dropdown Prescription Builder Design Brief

**Date:** April 7, 2026
**Status:** Research complete, awaiting final clinician feedback before work order creation
**Sources:** Clinician feedback (2026-04-07), real prescription labels (ITC Compounding, Olympia Pharmacy), Lauren Perkins protocol data, Gemini Deep Research Report (22 pages, 82 citations), Perplexity Deep Research Report (137 pages, 7 research areas)

---

## 1. Why This Feature Is Critical

### The Problem with Our Current Approach

Our current prescription flow uses a **card-based pharmacy selection** where each catalog entry is a flat record:

```
medication_name: "Semaglutide"
form: "Injectable"
dose: "0.5mg/0.5mL"
wholesale_price: 150.00
```

This works for 5 seed medications with 1 configuration each. It **will not scale** because:

- A single medication like Semaglutide has **100-200+ valid configurations** (dose tiers × concentrations × vial sizes × with/without B12 × supply durations)
- Testosterone has **500-1000+ configurations** across all salt forms, dosage forms, gender-specific dosing, oil bases, and combinations
- A real functional medicine practice prescribes **dozens of compounded medications** with complex titration protocols, combination formulations, and non-standard frequencies
- Scrolling through hundreds of cards to find the right configuration is slower and more error-prone than cascading dropdowns

### The Clinician's Direct Feedback (2026-04-07)

> "We need drop-down menus for the patient once the patient is selected to ensure all the appropriate doses, frequencies, delivery methods are all able to be selected per the medicine. Being able to select all of this from drop-down menus instead of creating cards would be more feasible when we have hundreds of medications along with tons of differences in a patient's protocol."

### Research Validation

The Gemini Deep Research Report (22 pages, 82 citations) confirms:
- **DrScript (Olympia Pharmacy)** already uses cascading dropdowns: API → Form → Dose
- **WellsPx3** uses predictive search with progressive disclosure
- **LifeFile** supports practice-customized formularies with favorites
- **Every successful platform** in this space uses some form of progressive disclosure, not flat card selection
- The research calls the shift from card-based to dropdown-based "a fundamental shift in health informatics"

---

## 2. Real Patient Protocol Data

### Lauren Perkins' Baseline Protocol (7 medications, 3+ pharmacies)

This is a real patient protocol from a functional medicine practice — the exact complexity our system needs to handle.

| # | Medication | Dose | Form | Frequency | Pharmacy |
|---|-----------|------|------|-----------|----------|
| 1 | Ketotifen 1mg | 1 capsule | Capsule | 4x daily (QID) | ITC Compounding |
| 2 | NAD+ 200mg/mL | 25 units | Injectable | M-F, weekends off | Lee Silsby Pharmacy |
| 3 | NAD+/MOTS-c/5-Amino-1MQ 100/10/10mg | 30 units | Injectable (combo) | 2-3x per week | Unknown |
| 4 | BPC-157/TB-500/GHK-Cu 10/10/50mg | TBD | Injectable (combo) | TBD | Unknown |
| 5 | Lipo-Mino Mix C 30mL | 100 units | Injectable (multi-dose vial) | Every other day | Olympia Pharmacy |
| 6 | Ketamine HCL 150mg RDT | 1 tablet | Rapid dissolve tablet (sublingual) | Daily or QOD | ITC Compounding |
| 7 | LDN (Naltrexone) 1mg/mL | 0.1mL → titrate to 0.5mL | Oral solution | Nightly (titration) | ITC Compounding |

### What This Protocol Reveals for System Design

1. **Combination formulations are common** — 3 of 7 medications have multiple active ingredients in one vial (NAD+/MOTS-c/5-Amino-1MQ, BPC-157/TB-500/GHK-Cu, Lipo-Mino)
2. **Multiple pharmacies per protocol** — At least 3 different pharmacies (ITC, Lee Silsby, Olympia)
3. **Non-standard frequencies** — "M-F weekends off" (5-on/2-off), "2-3x per week" (flexible), "every other day", "daily OR every other day" (provider discretion), "4x daily"
4. **Titration protocols** — LDN starts at 0.1mL and titrates up by 0.1mL every 3-4 days to 0.5mL
5. **Injectable doses in units** — 25 units, 30 units, 100 units (insulin syringe measurement, not milligrams directly)
6. **"As directed by prescriber"** — Sometimes the sig is intentionally vague for provider flexibility

---

## 3. Prescription Label Analysis (From Real Medications)

### ITC Compounding & Natural Wellness Pharmacy (Castle Rock, CO)

**Rx #577127 — Naltrexone HCL 1mg/mL Solution**
- Form: Solution (liquid oral), 60mL
- Sig: "Take 0.1mL by mouth every night at bedtime. Titrate up by 0.1mL every 3-4 days as tolerated up to 0.5mL (0.5mg)"
- Prescriber: Denise Kruszynski FNP
- Refills: 2, Beyond-Use Date: 6/29/2026
- Price: $79.95 (ingredient cost $30.44, compounding fee $49.51)

**Rx #583150 — Ketamine HCL 150mg RDT**
- Form: Rapid Dissolve Tablet (sublingual), 90 tablets
- Sig: "Dissolve 1 tablet in mouth once daily"
- Prescriber: Gina Rooks NP
- Refills: 1, For sublingual use

**Rx #572006 — Ketotifen 1mg Capsule**
- Form: Capsule, 360 count
- Sig: "Take 1 capsule by mouth four times a day"
- Prescriber: Dean C Mitchell MD
- Refills: 1

### Olympia Pharmacy (Orlando, FL)

**Rx #2109545-00 — Lipo-Mino C 30mL Vial**
- Form: Injectable (multi-dose vial)
- Sig: "Inject 1mL intramuscularly or subcutaneously on the arm, leg, or glute every other day as directed by prescriber"
- Prescriber: Eduardo Elizalde-Santos
- Refills: 0

### Universal Claim Form Data Points

The claim form shows the full pricing breakdown:
- **Medication:** NALTREXONE HCL 1MG/ML SUSPENSION
- **Ingredients:**
  - Naltrexone Hydrochloride: 0.060 GM — $18.74
  - Glycerin USP (Natural): 60.000 ML — $11.70
  - **Total ingredient cost:** $30.44
- **Compounding fee:** $49.51
- **Retail price:** $79.95
- **Prescription #:** 577127, Days Supply: 30, Qty: 60 ML
- **DAW:** 0 - No DAW

### Key Observations from Labels

1. **Multiple prescribers** for the same patient (FNP, NP, MD) — system must handle multiple providers
2. **Pricing breakdown visible** — ingredient cost + compounding fee = retail. Our margin builder could show this
3. **Form-specific warnings** auto-populate: "SHAKE WELL", "FOR SUBLINGUAL USE", "MAY CAUSE DROWSINESS", "PROTECT FROM LIGHT"
4. **Beyond-Use Date varies** by formulation — 3 months (solution), 6 months (RDT), 5 months (capsule)
5. **Lot numbers and discard dates** on every label — pharmacy-determined, not prescriber-selected

---

## 4. Recommended Data Model (from Gemini Research)

### Current Model (Flat — Won't Scale)

```
catalog
  ├── medication_name (text)
  ├── form (text)
  ├── dose (text)
  ├── strength (text)
  ├── wholesale_price (numeric)
  └── pharmacy_id (FK)
```

### Required Model (6-Tier Hierarchical)

Based on the research report's analysis of pharmaceutical data standards, PCCA formulation databases, and how leading platforms structure their catalogs:

```
Tier 1: ingredients (Parent API)
  ├── ingredient_id (PK)
  ├── common_name ("Testosterone", "Semaglutide", "Naltrexone")
  ├── therapeutic_category ("Men's Health", "Weight Loss", "Autoimmune")
  └── dea_schedule (null, 2, 3, 4, 5)

Tier 2: salt_forms
  ├── salt_form_id (PK)
  ├── ingredient_id (FK → ingredients)
  ├── salt_name ("Testosterone Cypionate", "Naltrexone Hydrochloride")
  └── molecular_weight_ratio (for base/salt conversions)

Tier 3: formulations (Master Formulation — the central table)
  ├── formulation_id (PK)
  ├── salt_form_id (FK → salt_forms) — or multiple via junction table for combos
  ├── dosage_form ("Injectable Solution", "Capsule", "RDT", "Topical Cream", "Oral Solution")
  ├── route_of_administration ("Subcutaneous", "Intramuscular", "Oral", "Sublingual", "Topical")
  ├── concentration ("200mg/mL", "1mg/mL", "5mg/mL")
  ├── excipient_base ("Grapeseed Oil", "MCT Oil", "VersaBase", "Glycerin USP")
  ├── is_sterile (boolean — injectable must be sterile)
  └── is_combination (boolean — multi-ingredient compound)

Tier 3a: formulation_ingredients (for combination formulations)
  ├── formulation_id (FK → formulations)
  ├── ingredient_id (FK → ingredients)
  ├── concentration_per_unit ("100mg", "10mg", "50mg")
  └── role ("primary", "adjuvant", "enhancer")

Tier 4: pharmacy_formulations (which pharmacy offers what at what price)
  ├── pharmacy_formulation_id (PK)
  ├── pharmacy_id (FK → pharmacies)
  ├── formulation_id (FK → formulations)
  ├── wholesale_price (numeric — pharmacy's price to the clinic)
  ├── available_quantities (JSONB — ["5mL vial", "10mL vial", "30 capsules", "90 tablets"])
  ├── available_supply_durations (JSONB — ["30-day", "60-day", "90-day"])
  ├── is_available (boolean)
  ├── estimated_turnaround_days (integer)
  └── last_synced_at (timestamptz)

Tier 5: sig_templates (structured directions)
  ├── sig_template_id (PK)
  ├── formulation_id (FK → formulations) — optional, can be generic
  ├── dose_amount ("0.1mL", "1 tablet", "25 units")
  ├── dose_unit ("mL", "tablet", "units", "capsule", "click")
  ├── route ("by mouth", "subcutaneously", "intramuscularly", "topically", "sublingually")
  ├── frequency_code ("QD", "BID", "TID", "QID", "QHS", "QW", "Q2W", "QOD", "PRN")
  ├── frequency_display ("once daily", "twice daily", "every other day", "M-F weekends off")
  ├── timing ("at bedtime", "with breakfast", "in the morning")
  ├── duration ("for 14 days", "for 30 days", "ongoing")
  ├── is_titration (boolean)
  ├── titration_start_dose ("0.1mL")
  ├── titration_increment ("0.1mL")
  ├── titration_interval ("every 3-4 days")
  ├── titration_target ("0.5mL")
  └── generated_sig_text (auto-generated from structured fields)

Tier 6: protocol_templates (multi-medication bundles)
  ├── protocol_id (PK)
  ├── clinic_id (FK → clinics) — clinic-specific protocols
  ├── name ("Weight Loss Protocol", "Male TRT Protocol", "Female HRT Protocol")
  ├── therapeutic_category ("Weight Loss", "Hormone Replacement", "Peptide Therapy")
  ├── total_duration_weeks (integer)
  └── is_active (boolean)

  protocol_items (individual medications within a protocol)
  ├── protocol_item_id (PK)
  ├── protocol_id (FK → protocol_templates)
  ├── formulation_id (FK → formulations)
  ├── sig_template_id (FK → sig_templates)
  ├── phase_name ("Phase 1 - Initiation", "Phase 2 - Titration", "Maintenance")
  ├── phase_start_week (integer)
  ├── phase_end_week (integer)
  ├── is_conditional (boolean — "add only if lab result X > threshold Y")
  ├── condition_description (text)
  └── sort_order (integer)

Tier 7: provider_favorites (saved prescriptions per provider)
  ├── favorite_id (PK)
  ├── provider_id (FK → providers)
  ├── formulation_id (FK → formulations)
  ├── sig_template_id (FK → sig_templates)
  ├── default_quantity (text)
  ├── default_refills (integer)
  ├── label ("Dr. Chen's standard TRT", "Semaglutide 0.5mg weekly")
  ├── use_count (integer — for adaptive shortlist ordering)
  └── last_used_at (timestamptz)
```

---

## 5. Cascading Dropdown UI Design

### The Flow

Based on the research and clinician feedback, here's how the prescription builder should work:

```
Step 1: CATEGORY (optional fast-filter)
  [Weight Loss ▼]  [Men's Health ▼]  [Women's Health ▼]  [Peptides ▼]  [All ▼]

Step 2: MEDICATION (autocomplete search)
  [Search: "Sema..."  →  Semaglutide | Semaglutide + B12 | Semaglutide + L-Carnitine]

Step 3: DOSAGE FORM (filtered by medication)
  [Injectable Solution ▼]  — only shows forms available for this medication

Step 4: CONCENTRATION (filtered by medication + form)
  [5mg/mL ▼]  — only shows concentrations available in this form

Step 5: DOSE PER ADMINISTRATION
  [Standard Dose ▼]  or  [Titration Schedule ▼]

  Standard: [0.5mg ▼] = [0.1mL ▼] = [10 units ▼]
  (auto-converts between mg, mL, and syringe units based on concentration)

  Titration: reveals builder:
    Start:     [0.25mg] = [5 units]
    Increase:  [0.25mg every 4 weeks]
    Target:    [2.5mg] = [48 units]
    Duration:  [16 weeks]

Step 6: FREQUENCY
  [Once weekly ▼]
  Options: QD, BID, TID, QID, QHS, QW, Q2W, QOD, PRN
  Custom: [M-F weekends off], [2-3x per week], [every other day]

Step 7: QUANTITY & SUPPLY
  [1 vial (5mL) ▼]  — auto-calculated: "~10 weeks at 0.5mg/week"
  Refills: [2 ▼]

Step 8: EXCIPIENT BASE (if applicable — shows only for injectables/topicals)
  [Grapeseed Oil ▼]  — filtered by form + pharmacy availability
  (Critical for patients with seed allergies)

Step 9: PHARMACY SELECTION (filtered by everything above)
  [Strive Pharmacy - $150.00 - Fax · ~30min ▼]
  [Empower Pharmacy - $165.00 - API · Instant ▼]
  (Only shows pharmacies that compound this specific formulation in the patient's state)

Step 10: AUTO-GENERATED SIG (editable)
  "Inject 10 units (0.1mL / 0.5mg) subcutaneously once weekly"
  [Edit ✏️]  — free-text override always available

Step 11: PHARMACY NOTES (optional free text)
  "Patient allergic to sesame — use grapeseed oil base only"
```

### Speed Optimizations

To maintain the sub-30-second per-prescription target:

1. **Favorites button** — "⭐ Dr. Chen's Favorites" shows the provider's most-used formulations. One click fills everything.
2. **Protocol templates** — "📋 Apply Protocol" shows clinic-defined templates. One click adds all medications in the protocol to the session.
3. **Recent orders** — "🔄 Recent" shows the last 10 prescriptions written by this provider. One click re-orders.
4. **Smart defaults** — System learns from prescribing patterns. If Dr. Chen always prescribes Semaglutide 0.5mg weekly in a 5mL vial from Empower, those become the defaults.
5. **Auto-advance** — After selecting medication, if there's only one form available, auto-advance to the next dropdown. Reduces clicks.

### Progressive Disclosure Rules

- **Base/Excipient dropdown** — Only shows if form is Injectable or Topical (not for capsules/tablets)
- **Injection supplies checkbox** — Only shows if form is Injectable. If checked, reveals gauge + needle length modal (WellsPx3 pattern)
- **Titration builder** — Only shows if "Titration Schedule" is selected instead of "Standard Dose"
- **DEA warning** — Only shows if medication has dea_schedule >= 2 (BPC-157 shows FDA Category 2 alert)
- **Oil base selection** — Only shows for injectable forms where multiple bases are available

---

## 6. Regulatory Requirements Affecting the UI

### EPCS Two-Factor Authentication (DEA 21 CFR 1311)

**Applies to:** Testosterone (Schedule III), Ketamine (Schedule III), any DEA-scheduled compound

**Requirements:**
- 2FA at the exact point of signing — not at login, at signing
- Must demand 2 of 3 factors:
  1. Something you know (password/PIN)
  2. Something you have (hard token on SEPARATE device, FIPS 140-2 Level 1+)
  3. Something you are (biometric)
- Hard token device MUST be separate from the computer running the app
- Only DEA-registered practitioner can sign (MA can prepare but not sign)
- Immutable audit trail of every event: creation, alteration, signing, transmission failure

**Impact on our UI:**
- Current signature canvas is fine for non-controlled substances
- For Schedule III+, we need to add 2FA step AFTER signature, BEFORE transmission
- Options: TOTP authenticator app (Google Authenticator, Authy), hardware token, or biometric
- This is a legal requirement — not implementing it makes the software illegal for controlled substance prescribing

### State-Specific Rules

- Some states forbid electronic transfer of Schedule II prescriptions between pharmacies for initial fill
- UI must block forwarding/rerouting of Schedule II compounds once initial pharmacy receives it
- Label requirements vary by state — platform must generate state-compliant labels
- Compounding records must be retained in sortable format for minimum 2 years for board inspections

### Clinical Difference Statement (LifeFile Pattern)

When compounding a medication that has a commercially available FDA-approved equivalent, some states/platforms require the prescriber to document WHY the compounded version is needed. Our UI should include an optional "Clinical Difference" field that triggers when the system detects a commercially available equivalent.

---

## 7. Relationship to Existing Work Orders

| Existing WO | How It Relates |
|-------------|---------------|
| **WO-79 (Catalog Data)** | The new hierarchical data model replaces the flat catalog. Pharmacy catalog CSVs will need to map to the new structure. |
| **WO-80 (Multi-Script Sessions)** | The dropdown builder slots into the existing multi-prescription session flow. Patient + provider selected first, then the dropdown builder replaces the current search → card → margin flow. |
| **WO-77 (Provider Signatures)** | EPCS 2FA adds a step after the signature for controlled substances. |
| **WO-76 (HSA/FSA)** | Unaffected — payment method is independent of prescription configuration. |
| **WO-81 (LegitScript)** | LegitScript's Product API could validate formulations during the dropdown selection — CDS alerts for flagged substances. |

---

## 8. Phased Build Approach

### Phase A — Data Model Migration
- Design and implement the hierarchical schema (ingredients → salt_forms → formulations → pharmacy_formulations)
- Migrate existing flat catalog data to the new structure
- Update the catalog CSV upload to support the new fields
- Update the API endpoints to query the hierarchical model

### Phase B — Cascading Dropdown UI
- Replace card-based pharmacy search with the dropdown builder
- Implement progressive disclosure (form → concentration → dose → frequency)
- Build the structured sig builder with auto-generation
- Implement the unit↔mg↔mL auto-conversion for injectables
- Add the excipient base selector for injectables/topicals

### Phase C — Favorites & Protocol Templates
- Provider favorites (save, load, one-click ordering)
- Clinic protocol templates (multi-medication bundles with phases)
- Adaptive shortlist (learn from prescribing patterns)
- "Recent orders" quick-reorder

### Phase D — Regulatory Compliance
- EPCS 2FA for controlled substances (DEA 21 CFR 1311)
- Clinical Difference statement field
- BPC-157 / FDA Category 2 CDS alerts
- State-specific prescription routing rules
- PDMP reporting integration for controlled substances

### Phase E — Titration Engine
- Titration schedule builder (start dose, increment, interval, target)
- Multi-phase protocol support (Phase 1: weeks 1-4, Phase 2: weeks 5-8, etc.)
- Auto-generated titration sig with week-by-week dosing
- Titration kit ordering (multi-vial/multi-strength as single prescription entity)

---

## 9. Test Cases (From Real Protocol Data)

These are the configurations the dropdown system must handle correctly, based on Lauren's actual protocol:

### Test Case 1: Simple Fixed Dose
- Ketotifen 1mg Capsule, 1 capsule, QID (4x daily), 360 count, 1 refill
- Expected: Straightforward dropdown selection, no titration, no special base

### Test Case 2: Weekday Schedule
- NAD+ 200mg/mL Injectable, 25 units, M-F weekends off
- Expected: Frequency dropdown shows "M-F weekends off" option, unit→mg auto-conversion (25 units × 200mg/mL concentration → actual mg per dose)

### Test Case 3: Multi-Ingredient Combination
- NAD+/MOTS-c/5-Amino-1MQ 100/10/10mg Injectable, 30 units, 2-3x/week
- Expected: Medication search shows this as a pre-defined combination formulation, not 3 separate ingredients. Frequency shows flexible "2-3x per week" option.

### Test Case 4: Titration Protocol
- LDN (Naltrexone HCL) 1mg/mL Oral Solution, start 0.1mL nightly, titrate up by 0.1mL every 3-4 days to 0.5mL
- Expected: Titration toggle reveals builder with start/increment/interval/target fields. Auto-generates sig: "Take 0.1mL by mouth every night at bedtime. Titrate up by 0.1mL every 3-4 days as tolerated up to 0.5mL (0.5mg)"

### Test Case 5: Flexible Frequency
- Ketamine HCL 150mg RDT, 1 tablet, daily OR every other day
- Expected: Frequency dropdown allows "daily or every other day" or free-text override

### Test Case 6: Injectable with Base Selection
- Testosterone Cypionate 200mg/mL in Grapeseed Oil, 0.35mL SubQ twice weekly
- Expected: After selecting Injectable form, excipient base dropdown reveals (Grapeseed, Sesame, MCT, Cottonseed). Allergy alert if patient has sesame allergy on file.

### Test Case 7: Protocol Template Application
- "Male TRT Protocol" = Testosterone Cypionate + Anastrozole + DHEA
- Expected: One click adds all 3 medications to the session with pre-filled doses, frequencies, and quantities. Provider reviews and adjusts as needed.

---

---

## 10. Perplexity Deep Research Findings (137-Page Report)

**Full PDF:** `docs/compoundiq_rx_ordering_ux_research.pdf` (137 pages, 7 research areas)

### Three Competitive Gaps — No Existing Platform Fills These

These represent CompoundIQ's biggest opportunities for differentiation:

**Gap 1: No portal has a titration schedule builder.**
Semaglutide dose escalation, LDN titration, and testosterone adjustment protocols are ALL handled via free-text sig fields or sequential manual prescriptions across every platform studied. CompoundIQ building a structured, multi-phase titration system would be **a first in the market**.

**Gap 2: No portal supports protocol templates as order bundles.**
Clinics running "Weight Loss Protocol" (Semaglutide + BPC-157 + Lipo-Mino) have to manually create 3 separate prescriptions on every platform. Cerbo's "Chart Parts" is the closest — but it's a text insertion tool, not a structured order generator. CompoundIQ can be **the first platform where one click generates a complete multi-medication protocol**.

**Gap 3: No portal uses progressive disclosure.**
LifeFile (the dominant platform used by Empower, Belmar, Strive, and others) dumps all fields at once. Pharmacy trainers explicitly warn providers it is "finicky." Research from Epic/Cerner implementations shows cascading progressive disclosure **reduces order friction 50-80%**. CompoundIQ would be the first compounding platform to implement this pattern.

### The 10-Level Cascade Tree (Data Model + UX Model)

Perplexity's Section 8 synthesizes a cascade validated against all 4 reference medications:

```
Level 1:  Medication Category (Weight Loss, Men's Health, Peptides, etc.)
Level 2:  Drug / Active Ingredient (Semaglutide, Testosterone, Naltrexone)
Level 3:  Salt / Ester Form (Cypionate, Enanthate, Hydrochloride)
Level 4:  Dosage Form (Injectable, Capsule, Cream, RDT, Solution)
Level 5:  Route of Administration (SubQ, IM, Oral, Sublingual, Topical)
Level 6:  Concentration (5mg/mL, 200mg/mL, 1mg/mL)
Level 7:  Volume / Quantity (5mL vial, 60mL bottle, 90 tablets)
Level 8:  Dose per Administration (0.1mL, 1 tablet, 25 units)
Level 9:  Frequency (QD, BID, QW, QOD, M-F, 2-3x/week)
Level 10: Titration Schedule (start, increment, interval, target, duration)
```

**Each selection constrains the options at every subsequent level.** This is both the database query pattern AND the UI interaction pattern.

### Key Architectural Insights from Perplexity

1. **Data model must be ingredient-centric.** Compounded meds have no NDC codes, no RxCUI. The entity is a recipe (Master Formulation Record) with a junction table of ingredients, not a fixed SKU.

2. **Sig building: structured internally, free text externally.** NCPDP structured sig can represent 95% of directions, but only 10-32% of prescriptions currently use it. CompoundIQ should generate structured data for its database while outputting clean narrative text for pharmacy transmission. This gives us the best of both worlds — structured data for analytics/compliance AND human-readable text for pharmacists.

3. **503A vs 503B have fundamentally different catalog structures:**
   - **503A** = Formula library (configurable recipes) — the prescriber can modify concentrations, swap bases, adjust quantities
   - **503B** = Product catalog (fixed SKUs with NDC numbers) — the prescriber selects from pre-manufactured items
   - CompoundIQ MUST handle both since our pharmacy network includes both types (Olympia is 503B, Wells is 503A, Empower has both)

4. **DEA pre-signing review screen is mandatory.** 21 CFR 1311 requires that the system explicitly present ALL critical data to the prescriber for review BEFORE allowing the digital signature. This means our review page isn't just a UX nicety — it's a legal requirement for controlled substances.

5. **Post-signing immutability + 2-year audit trails.** For controlled substances, once signed, the prescription record must be immutable and the complete audit trail must be retained for minimum 2 years in a sortable, searchable format. Our existing `order_status_history` table and snapshot immutability pattern (prevent_snapshot_mutation trigger) already satisfy this for the order record, but we may need additional audit fields for the prescription-specific data.

6. **Epic SmartSets reduce ordering time by ~1 minute per encounter.** When hospital systems standardize order sets and embed clinical decision support, utilization jumps dramatically. This validates the protocol template approach — pre-built order bundles save significant time.

7. **Poor UX causes real medication errors.** The APOTTI study (Epic-based EHR in Helsinki) found that UI flaws and ambiguous order names contributed to 92 severe medication errors. This is why progressive disclosure matters — it's not just about speed, it's about patient safety.

---

## 11. Combined Research Summary — What This Means for CompoundIQ

### The Moat

By implementing these three features that NO competitor has:

1. **Structured titration schedule builder** — First in market
2. **Protocol templates as order bundles** — First in market  
3. **Progressive disclosure cascading dropdowns** — First in compounding pharmacy space

CompoundIQ doesn't just become "faster" — it becomes **the only platform that can handle the actual complexity of functional medicine prescribing** without forcing providers to work around the system.

### The Competitive Positioning

> "Every other platform forces providers to manually re-enter complex protocols medication by medication, fight through non-cascading form fields that pharmacy trainers call 'finicky,' and copy-paste titration schedules into free-text fields that the receiving pharmacy may misinterpret. CompoundIQ is the first platform where a provider selects a protocol template, the system auto-generates structured prescriptions with validated titration schedules, and progressive disclosure ensures they only see the fields relevant to their selections — all in under 30 seconds per prescription."

### The Build Priority

Based on both research reports + clinician feedback + real protocol data:

1. **Hierarchical data model** (prerequisite for everything — can't cascade without the hierarchy)
2. **Cascading dropdown UI** (the core prescriber experience — replaces cards)
3. **Structured sig builder** (generates compliant directions from dropdown selections)
4. **Favorites** (immediate productivity gain — one-click reordering)
5. **Protocol templates** (competitive differentiator — one-click multi-medication protocols)
6. **Titration engine** (competitive differentiator — no competitor has this)
7. **EPCS 2FA** (legal requirement for controlled substances)

---

*This document captures all research (Gemini + Perplexity), clinician feedback, label analysis, and design thinking for the cascading dropdown prescription builder. It should be the starting point for the work order when ready to build.*
