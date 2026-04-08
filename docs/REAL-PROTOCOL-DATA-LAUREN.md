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

*This document preserves all real patient protocol data collected during the CompoundIQ design research phase. It serves as the primary test case library for the cascading dropdown prescription builder feature.*
