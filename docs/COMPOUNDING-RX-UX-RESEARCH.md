# Compounding Pharmacy e-Prescribing UX Research

**Source:** Gemini Deep Research Report — April 7, 2026
**Full PDF:** See `Compounding Pharmacy UX Research.pdf`
**Purpose:** Informs the cascading dropdown prescription builder feature for CompoundIQ

---

## Key Findings Summary

### 1. How Leading Platforms Handle Prescription Configuration

| Platform | UI Pattern | Formulary | Key Feature |
|----------|-----------|-----------|-------------|
| **DrScript (Olympia)** | Cascading Dropdowns | Highly Customizable | Component-by-component: API → Form → Dose. Prevents incompatible combinations. |
| **WellsPx3 (Wells)** | Predictive Search | Hybrid | Auto-populates demographics from EHR. Progressive disclosure for injection supplies. DEA 1311 EPCS certified. |
| **LifeFile/ePowerRx** | Tabbed Interface | Practice-Customized | Heavy use of "Favorites" and pre-built clinic-specific catalogs. Mandates "Clinical Difference" statement. |
| **Empower** | E-Commerce Style | Catalog-Based (Fixed SKUs) | Strict 503A vs 503B portal separation. Pre-validated master formulations only. |
| **ReviveRX (DRx)** | Dashboard UI | Hybrid | Free text for non-controlled; forced structured lookup for controlled substances (PDMP). |
| **Belmar** | Direct-to-Processing | Hybrid | Distinct flows for patient-pay vs clinic-pay. 503A/503B order routing. |

### 2. The Cascading Dropdown Sequence (from research)

The optimal sequence identified across all platforms:

1. **Category Selection** — Broad therapeutic area (Men's Health, Peptides, Weight Loss)
2. **API Selection** — Active ingredient (e.g., Testosterone)
3. **Form & Base Reveal** — Progressive disclosure: selecting "Injectable" shows only oil bases; selecting "Cream" shows only emulsifier bases
4. **Titration/Sig Engine** — "Standard Dose" toggle vs "Titration Schedule" toggle. Titration reveals week-by-week builder.
5. **Pharmacy Notes** — Free-text override for niche clinical instructions

### 3. Data Model Architecture (6-tier hierarchy)

1. **Parent API** — The foundational molecule (e.g., Naltrexone)
2. **Chemical Salt Form** — Specific synthesized variant (e.g., Naltrexone Hydrochloride)
3. **Excipient/Delivery Base** — Vehicle carrying the API (e.g., Grapeseed Oil, VersaBase, Lipoderm)
4. **Concentration/Strength** — Quantitative measure per unit (e.g., 1.5mg/capsule, 50mg/mL)
5. **Dosage Form** — Physical form (Capsule, Sublingual Suspension, Transdermal Gel)
6. **Route of Administration** — Entry point (Oral, Subcutaneous, Intramuscular)

Central `Master_Formulation` table connected to satellite tables. This replaces our flat catalog model.

### 4. NCPDP Structured Sig Format

- Standard frequency codes: QD, BID, TID, QID, QHS, QW, PRN
- SigText allows up to 1,000 characters (SCRIPT v2017071)
- Complex titrations use repeating Sig segments linked by "AND" or "THEN"
- Frequency prepends "per", Interval prepends "every", Duration prepends "for"

### 5. EPCS Requirements for Controlled Substances (DEA 21 CFR 1311)

**Critical for Testosterone (Schedule III) and Ketamine:**
- Two-Factor Authentication (2FA) required at the point of signing
- Must demand 2 of 3: something you know (password), something you have (hard token on SEPARATE device), something you are (biometric)
- Hard token device must be SEPARATE from the computer running the app
- Must meet FIPS 140-2 Security Level 1 or higher
- Immutable audit trail of every UI event (creation, alteration, signing, transmission)
- Only DEA-registered practitioner can execute digital signature (agents can prepare but not sign)

### 6. Protocol Templates (from Practice Better, Cerbo, Elation)

- **Practice Better:** Protocol templates bundle dietary + medication orders. Import from Fullscript. Apply template → customize → publish.
- **Cerbo:** "Chart Parts" for rapid insertion. Adaptive medication shortlist learns provider habits. Default/secondary dosing profiles.
- **Elation:** Handles "clinic-administered medications" with Sign & Close (no pharmacy transmission).
- **Conditional prescribing:** EHR evaluates lab results, triggers CDS rule, prompts clinician to authorize addition.

### 7. Real-World Medication Complexity

**Semaglutide titration table:**

| Phase | Dose | Concentration | Volume | Syringe Units | Frequency |
|-------|------|--------------|--------|---------------|-----------|
| Weeks 1-4 | 0.25mg | 5mg/mL | 0.05mL | 5 Units | Weekly |
| Weeks 5-8 | 0.50mg | 5mg/mL | 0.10mL | 10 Units | Weekly |
| Weeks 9-12 | 1.00mg | 5mg/mL | 0.20mL | 20 Units | Weekly |
| Weeks 13-16 | 1.70mg | 5mg/mL | 0.34mL | 34 Units | Weekly |
| Maintenance | 2.40mg | 5mg/mL | 0.48mL | 48 Units | Weekly |

**Key UI requirement:** Auto-convert between mg, mL, and syringe units based on concentration.

**BPC-157 regulatory alert:** FDA categorized BPC-157 as Category 2 (safety risk) in late 2023. UI must trigger CDS warning when prescriber selects it.

### 8. 503A vs 503B Implications

- **503A (patient-specific):** Infinite combinatorial flexibility. Prescriber can alter concentrations, swap excipients. Our UI must support this.
- **503B (batch/outsourcing):** Fixed SKUs like retail pharmacy. Zero customization. Our UI presents these as catalog items.
- We need to support BOTH models since our pharmacy network includes both types.

---

## Implications for CompoundIQ

### Data Model Redesign Required
Our flat `catalog` table (medication_name, form, dose, strength, wholesale_price) cannot represent the 6-tier hierarchy. We need:
- `ingredients` table (parent API + salt forms)
- `formulations` table (ingredient + base + concentration + form)
- `pharmacy_formulations` table (which pharmacy offers which formulation at what price)
- `combination_formulations` table (multi-ingredient compounds like NAD+/MOTS-c/5-Amino-1MQ)

### Sig Builder Required
Our current free-text `sig_text` field needs to be supplemented with a structured sig builder:
- Dose amount + unit dropdown
- Route dropdown
- Frequency dropdown (standard codes + custom patterns)
- Duration dropdown
- Titration mode (start dose, increment, interval, target)
- Auto-generated sig text from structured selections
- Free-text override always available

### EPCS 2FA Required
For controlled substances (Testosterone, Ketamine), we MUST implement:
- Two-factor authentication at signing
- Hard token or biometric as second factor
- Audit trail of every prescription event
- This is not optional — it's federal law (21 CFR 1311)

### Favorites/Templates Required
Every successful platform in this space supports:
- Saved favorites per provider
- Protocol templates (multi-medication bundles)
- Adaptive shortlists that learn from prescribing patterns

---

*This research directly informs the Cascading Dropdown Prescription Builder work order. See also: project_clinician_feedback_protocols.md in memory for real patient protocol data.*
