# Real Patient Protocol Data — Lauren Perkins

**Date Collected:** April 7-8, 2026
**Purpose:** Real-world protocol examples to validate and test the cascading dropdown prescription builder design
**Patient Context:** Mold/MCAS (Mast Cell Activation Syndrome) treatment protocol

---

## Protocol 1: Baseline Medication List (From Prescription Labels)

Collected April 7, 2026 from actual prescription labels (ITC Compounding, Olympia Pharmacy, Lee Silsby):

| # | Medication | Dose | Form | Frequency | Pharmacy | Rx # |
|---|-----------|------|------|-----------|----------|------|
| 1 | Ketotifen 1mg | 1 capsule | Capsule | 4x daily (QID) | ITC Compounding (Castle Rock, CO) | 572006 |
| 2 | NAD+ 200mg/mL | 25 units | Injectable | M-F, weekends off | Lee Silsby Pharmacy | — |
| 3 | NAD+/MOTS-c/5-Amino-1MQ 100/10/10mg | 30 units | Injectable (combo) | 2-3x/week | Unknown | — |
| 4 | BPC-157/TB-500/GHK-Cu 10/10/50mg | Per cycle | Injectable (combo) | Per cycling schedule | Unknown | — |
| 5 | Lipo-Mino Mix C 30mL | 100 units (1mL) | Injectable (multi-dose vial) | Every other day | Olympia Pharmacy (Orlando, FL) | 2109545-00 |
| 6 | Ketamine HCL 150mg RDT | 1 tablet | Rapid dissolve tablet (sublingual) | Daily or QOD | ITC Compounding | 583150 |
| 7 | LDN (Naltrexone HCL) 1mg/mL | 0.1mL → titrate to 0.5mL | Oral solution | Nightly at bedtime | ITC Compounding | 577127 |

### Prescription Label Details

**ITC Compounding & Natural Wellness Pharmacy**
- Address: 651 Topeka Way, Suite 600, Castle Rock, CO 80109
- Phone: 303-663-4224 / 1-888-349-5453
- NABP: B1427-5776

**Rx #577127 — Naltrexone HCL 1mg/mL Solution**
- Qty: 60 mL, Lot: 03312026@80
- Sig: "Take 0.1mL by mouth every night at bedtime. Titrate up by 0.1mL every 3-4 days as tolerated up to 0.5mL (0.5mg)"
- Prescriber: Denise Kruszynski FNP, Refills: 2
- Beyond-Use Date: 6/29/2026, Filled: 3/31/2026
- Price: $79.95 (Ingredients: $30.44, Compounding fee: $49.51)

**Rx #583150 — Ketamine HCL 150mg RDT**
- Qty: 90 tablets, Lot: 03192026@53
- Sig: "Dissolve 1 tablet in mouth once daily"
- Prescriber: Gina Rooks NP, Refills: 1
- Beyond-Use Date: 9/15/2026, Filled: 3/19/2026
- Labels: "FOR SUBLINGUAL USE", "KEEP OUT OF REACH OF CHILDREN"

**Rx #572006 — Ketotifen 1mg Capsule**
- Qty: 360 capsules, Lot: 05052025@9
- Sig: "Take 1 capsule by mouth four times a day"
- Prescriber: Dean C Mitchell, Refills: 1
- Beyond-Use Date: 10/4/2025, Filled: 6/14/2025
- Label: "MAY CAUSE DROWSINESS"

**Olympia Pharmacy**
- Address: 4600 L B McLeod Rd, Orlando, FL 32811
- Phone: 407-420-8222 / Toll Free: 888-323-7788

**Rx #2109545-00 — Lipo-Mino C 30mL Vial**
- Qty: 1 vial (30mL), Lot: 122A03-25
- Sig: "Inject 1mL intramuscularly or subcutaneously on the arm, leg, or glute every other day as directed by prescriber"
- Prescriber: Eduardo Elizalde-Santos (Miami, FL), Refills: 0
- Written: 11/5/2025, Filled: 11/5/2025, Discard by: 3/22/2026

### Universal Claim Form Data (Naltrexone)

| Field | Value |
|-------|-------|
| Medication | NALTREXONE HCL 1MG/ML SUSPENSION |
| Dosage Form | SUSPENSION |
| Strength | 1MG/ML |
| Days Supply | 30 |
| Qty Dispensed | 60 ML |
| Date Filled | 3/31/2026 |
| Rx # | 577127 |
| Price | $79.95 |
| Compounding Fee | $49.51 |
| Ingredient: Naltrexone Hydrochloride | 0.060 GM — $18.74 (NDC: 62991-3125-03) |
| Ingredient: Glycerin USP (Natural) | 60.000 ML — $11.70 (NDC: 38779-0613-01) |
| Total Ingredient Cost | $30.44 |
| DAW | 0 - No DAW |
| Prescriber | Denise Kruszynski |
| Pharmacist Signature | J, A (License #14670, NPI: 1255403036) |

---

## Protocol 2: Full Daily Schedule — Mold/MCAS Treatment (April 2026)

This is the complete daily protocol including timing, supplements, and cycling notes. This represents the FULL complexity a provider manages for one patient.

### MORNING (Upon Waking — Empty Stomach, ~9:00 AM)

**Compounded Medications:**
- Ketotifen (1 of 4 daily doses)
- Claritin (loratadine) — OTC antihistamine
- Peptides per cycling schedule

**Supplements (spaced ~10-15 min apart):**
- Liposomal Glutathione
- NMN (liquid)
- Vitamin C (liposomal)

### PEPTIDES / METABOLIC SUPPORT (~2:00-4:00 PM, flex window)

**Daily (M-F only):**
- NAD+ 200mg/mL — 25 units SubQ

**2-3x Per Week (ALT week):**
- NAD+/MOTS-c/5-Amino-1MQ 100/10/10mg — 30 units SubQ

**Per Cycling Schedule:**
- BPC-157/TB-500/GHK-Cu 10/10/50mg

**Every Other Day:**
- Lipo-Mino C — 1 mL (100 units) IM or SubQ

### MIDDAY / PRE-LUNCH (~12:30 PM, 30 min before lunch)

- Quercetin (Neuroprotek LP) — mast cell stabilizer supplement
- Ketotifen (2 of 4 daily doses)

### MID-AFTERNOON / GUT SUPPORT (~4:00 PM)

- Chlorella (current binder for mold detox)
- Butyric acid — to test (not yet started)

### DINNER BLOCK (~6:00 PM, 30 min before dinner)

- Quercetin (3rd dose)
- Ketotifen (3 of 4 daily doses)

### EVENING / PAIN + NEURO SUPPORT (~7:30-8:30 PM)

- Ketamine HCL 150mg RDT — dissolve 1 tablet sublingually
- Frequency: daily or every other day based on symptoms

### NIGHT / BASELINE IMMUNE + MCAS SUPPORT (~8:30-9:00 PM)

- Ketotifen (4 of 4 daily doses)
- Claritin (loratadine) — 2nd dose
- Quercetin (if not already taken — 4th dose)

### LDN TITRATION (~9:00-10:00 PM) — CURRENTLY INITIATING

- Low Dose Naltrexone (LDN) 1mg/mL oral solution
- **Titration protocol:**
  - Start: 0.1mg nightly
  - Increase: 0.1mg every 3-4 days as tolerated
  - Initial target: 0.25-0.5mg
  - Goal: Titrate "low and slow" to avoid flare or herx response

### PRE-BED (~30 min before sleep)

- Magnesium complex (supplement)

### AS NEEDED (FLARE SUPPORT)

- DAO enzyme and/or All Qlear (mast cell support)
- Additional antihistamine support if needed

---

## Cycling & Weekly Notes

| Medication | Schedule | Notes |
|-----------|----------|-------|
| NAD+ | M-F only, weekends off | 25 units daily |
| ALT injection (NAD+/MOTS-c/5-Amino-1MQ) | 2-3x per week | 30 units per injection |
| Lipo-Mino C | Every other day | 100 units (1mL) |
| Peptides (BPC-157/TB-500/GHK-Cu) | Active baseline, no current testing | Per cycling schedule |
| Ketamine RDT | Daily or every other day | Depending on pain/tolerance |
| Ketotifen | 4x daily (QID) | Every ~6 hours with meals + bedtime |

---

## Planned Next Steps (Not Yet Started)

1. **LDN** → Active titration (just started April 2026)
2. **Scorpion Venom** → Introduce AFTER LDN is fully titrated to target dose AND stable for minimum 3-5 days
3. **Butyric Acid** → To test (gut support for mold protocol)

---

## System Design Implications

### This Protocol Demonstrates:

1. **17+ items per day** — 7 compounded meds + 10+ supplements, all with specific timing
2. **4 different dosing frequencies** for the SAME medication (Ketotifen QID at specific meal-aligned times)
3. **Flexible/conditional frequencies** — "daily or every other day based on symptoms"
4. **Active titration** — LDN with specific start, increment, interval, and target
5. **Phased medication introduction** — LDN must stabilize before Scorpion Venom starts
6. **Cycling schedules** — Peptides rotate on/off cycles, NAD+ is weekdays only
7. **Multiple prescribers** — 3+ different prescribers (FNP, NP, MD) at different pharmacies
8. **Multiple pharmacies** — ITC (CO), Olympia (FL), Lee Silsby, plus supplement sources
9. **Mix of Rx + OTC + supplements** — The protocol is a unified plan but the system only handles the compounded Rx portion
10. **Mast cell condition requires precise timing** — Medications must be taken at specific intervals relative to meals and each other
11. **"As directed by prescriber"** flexibility — Some sigs are intentionally open-ended
12. **Compounding fee visibility** — The Universal Claim Form shows ingredient cost + compounding fee breakdown

### Test Cases for the Dropdown System

| Test | What It Validates |
|------|------------------|
| Ketotifen QID (4 doses at specific times) | Frequency dropdown handles "4 times daily" with meal-aligned timing |
| NAD+ M-F weekends off | Custom day-pattern frequency beyond standard codes |
| 3-ingredient combo injectable (NAD+/MOTS-c/5-Amino-1MQ) | Multi-ingredient formulation support in medication selection |
| LDN titration 0.1mL → 0.5mL over weeks | Titration builder with start/increment/interval/target |
| Ketamine "daily or QOD based on symptoms" | Flexible/conditional frequency with provider discretion |
| Lipo-Mino from Olympia while others from ITC | Multi-pharmacy per patient session |
| Scorpion Venom "after LDN stable 3-5 days" | Conditional/phased medication introduction |
| BPC-157/TB-500/GHK-Cu "per cycling schedule" | Cycling protocol support (on/off periods) |

---

---

## Protocol 3: 2025 Master Detox + Performance Protocol (6 Phases, 10+ Weeks)

**Start Date:** Week of July 1, 2025
**Use Case:** Mold detox, MCAS modulation, mitochondrial + cognitive repair
**Note:** Phases 1-4 were planned but non-response validated in labs — did not proceed to Phases 5-6, now recalibrating.

This protocol represents the MAXIMUM complexity a functional medicine practice would manage. It has 6 phases spanning 10+ weeks, with peptide cycling, hormone optimization, biohacks, and conditional phase advancement based on lab results.

### PHASE 1: Immune Reboot + Barrier Repair + Cognitive Activation (Weeks 1-3)

**Peptides:**

| Medication | Concentration | Dose | Route | Cycle | Duration | Purpose |
|-----------|--------------|------|-------|-------|----------|---------|
| Thymosin Alpha-1 | 3 mg/mL | 1.0 mg (0.33 mL) | SubQ | 5 days on / 2 off | Weeks 1-7 (6 weeks), then reassess | Immune modulation, mast cell calming, barrier integrity |
| BPC-157 | 5 mg/mL | Start 250-500 mcg → titrate to 1.0 mg (0.2 mL) | SubQ | Daily (5 days/week) once tolerated | Weeks 2-7 (6 weeks), then reassess or rotate to blend | Gut/vascular repair, mast cell stabilization |

**Cognitive + Redox Support (optional, rotate in as needed):**

| Item | Dose | Frequency | Notes |
|------|------|-----------|-------|
| Methylene Blue | 45 mg/day oral | 3-5x/week | Do not cycle unless overstimulated |
| NAD+ | 25 units | M-F, weekends off | Do not cycle unless overstimulated |
| Red Light Therapy (w/ vibration plate) | — | Daily or 3-5x/week | Do not cycle unless overstimulated |

**Binders & Detox Support:**

| Item | Starting Dose | Target Dose | Frequency | Notes |
|------|-------------|------------|-----------|-------|
| Liposomal Glutathione | 250 mg/day | 500 mg/day | Daily | Continuous |
| Chlorella | 500 mg (start Day 5-7) | Titrate to 1500 mg/day | Daily with food | Take 2-3 days off every 2-3 weeks |

**Biohacks:**
- Balancer Pro: 2-3x/week
- NeuroVIZR: Daily
- Vibration Plate (with Red Light): 5-7x/week
- Rebounder: Optional daily AM

### PHASE 2: Free Testosterone / Tesamorelin Optimization (Weeks 3-4+)

**Hormones:**

| Medication | Dose | Frequency | Duration |
|-----------|------|-----------|----------|
| Lifestyle Med's Free Testosterone | Daily application | Daily | 60 days |

**Growth Hormone:**

| Medication | Cycle | Duration |
|-----------|-------|----------|
| Tesamorelin | 5 days on / 2 days off | 12-week protocol |

**Biohacks:**
- Balancer Pro: Maintain 2x/week
- NeuroVIZR: Daily

### PHASE 3: Neural + Vascular Repair (Weeks 5-7)

**Peptides:**

| Medication | Dose | Route | Cycle | Duration | Pause | Purpose |
|-----------|------|-------|-------|----------|-------|---------|
| GHK-Cu (injectable) | 2 mg | SubQ | 2-3x/week | 4-6 weeks | 2-4 weeks off | Skin/vascular repair, copper transport |
| GHK-Cu (topical) | AM/PM | Topical | As tolerated | With injectable cycle | — | Skin repair |
| DSIP (Delta Sleep-Inducing Peptide) | 250 mcg (0.05 mL) | SubQ | 3-5x/week before bed | 6-8 weeks | 2-4 weeks before next cycle | Sleep optimization |

**Detox:** Continue glutathione + chlorella

**Biohacks:**
- HOCATT: 1x/week
- NeuroVIZR: Continue daily
- Balancer Pro: Continue post-HOCATT

### PHASE 4: NAD+ Injectables + 5-Amino-1MQ

| Medication | Dose | Route | Cycle | Notes |
|-----------|------|-------|-------|-------|
| NAD+ Injectable | 50-100 mg | SubQ | 2-3x/week, pulse 4-6 weeks → rest 2-3 weeks | Higher dose than maintenance |
| 5-Amino-1MQ | TBD | TBD | TBD based on effect | Reserved until SS-31 and MOTS-c are stable |

### PHASE 5: Advanced Mitochondrial Repair (Weeks 8-10) — NOT YET STARTED

| Medication | Dose | Route | Cycle | Duration | Pause | Notes |
|-----------|------|-------|-------|----------|-------|-------|
| SS-31 | 5-10 mg (TBD) | SubQ | 2x/week | 4-6 weeks, then evaluate | 2-4 weeks | Mitochondrial repair |
| MOTS-c | 5-10 mg (TBD) | SubQ | 2x/week (alternate days from SS-31) | 4-6 weeks | 2-4 weeks | **Do not inject SS-31 and MOTS-c on same day** |

**Biohacks:**
- Red Light + MB/NAD+: 3x/week
- Contrast Showers: 3x/week
- Balancer Pro + Sauna: 2-3x/week alternating
- Gentle Cardio (Post-Lymph): 2x/week
- Sauna: 1-2x/week

### PHASE 6: Senolytics + Cerebrolysin — NOT YET STARTED

| Medication | Dose | Route | Cycle | Duration | Notes |
|-----------|------|-------|-------|----------|-------|
| Senocell (senolytic) | Start with ½ dose | TBD | TBD | TBD | Support: Glutathione, chlorella, hydration, rest |
| Cerebrolysin | 1-5 mL | IM (test IV) | Daily x 10 days (single pulse) | 10-day pulse, repeat every 2-3 months | Neuroplasticity, trauma recovery, focus |

**Biohacks:**
- HOCATT: 1x/week
- Balancer Pro: Weekly baseline
- Rest Days: Post-pulse recovery

---

## Protocol 3 — System Design Implications

This 6-phase protocol reveals additional complexity beyond Protocol 2:

1. **Phase-gated advancement** — Phases 5-6 were NOT started because lab results from Phases 1-4 showed non-response. The system needs to support conditional phase advancement based on clinical assessment.

2. **Peptide cycling with specific on/off schedules** — "5 days on / 2 off", "4-6 weeks then 2-4 weeks off", "pulse 4-6 weeks → rest 2-3 weeks". These aren't simple frequencies — they're cycling protocols.

3. **Drug interaction constraints** — "Do not inject SS-31 and MOTS-c on same day." The system should flag incompatible same-day injections.

4. **Dose titration within phases** — BPC-157 starts at 250-500 mcg and titrates to 1.0 mg within Phase 1.

5. **Biohack integration** — The protocol includes non-Rx items (Red Light, HOCATT, Vibration Plate) that are part of the clinical plan but not prescriptions. Future consideration: should the system track these alongside Rx?

6. **12+ unique compounded medications** across all phases — Thymosin Alpha-1, BPC-157, Methylene Blue, NAD+ (two different dose levels), GHK-Cu (injectable + topical), DSIP, 5-Amino-1MQ, SS-31, MOTS-c, Senocell, Cerebrolysin, plus Testosterone and Tesamorelin.

7. **"Reassess" and "TBD" fields** — Not everything is pre-determined. The provider adjusts based on response. The system needs to support open-ended/placeholder doses.

8. **Multiple delivery routes for same medication** — GHK-Cu is both injectable (SubQ) AND topical (cream AM/PM).

### Additional Test Cases for Dropdown System

| Test | What It Validates |
|------|------------------|
| Thymosin Alpha-1 "5 days on / 2 off" for 6 weeks | Cycling schedule with defined on/off pattern + total duration |
| BPC-157 titration from 250mcg → 1.0mg | Intra-phase dose titration (different from LDN's simple linear titration) |
| SS-31 and MOTS-c "do not inject on same day" | Drug interaction / scheduling constraint |
| Phase 5 "NOT YET STARTED" based on labs | Conditional phase advancement |
| GHK-Cu injectable 2-3x/week + topical AM/PM | Same medication, two routes, two frequencies |
| NAD+ at 25 units (Phase 1) vs 50-100mg (Phase 4) | Same medication, different doses in different phases |
| Cerebrolysin "daily x 10 days, repeat every 2-3 months" | Pulse dosing protocol with multi-month cycle |
| "Start with ½ dose" for Senocell | Exploratory dosing with no pre-defined target |

---

*This document preserves all real patient protocol data collected during the CompoundIQ design research phase. It serves as the primary test case library for the cascading dropdown prescription builder feature.*
