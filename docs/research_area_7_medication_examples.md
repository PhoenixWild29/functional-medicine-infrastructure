# Research Area 7: Real-World Compounding Examples

**Compiled:** April 7, 2026  
**Purpose:** Document the full complexity of compounded medication configurations for prescribing UI design — covering variants, dose ranges, formulations, protocols, and cascading data dependencies.

---

## Table of Contents
1. [Semaglutide (Compounded)](#1-semaglutide-compounded)
2. [Testosterone (Compounded)](#2-testosterone-compounded)
3. [Low-Dose Naltrexone (LDN)](#3-low-dose-naltrexone-ldn)
4. [BPC-157 (Body Protection Compound)](#4-bpc-157-body-protection-compound)
5. [UI Data Field & Cascading Dependency Analysis](#5-ui-data-field--cascading-dependency-analysis)

---

## 1. Semaglutide (Compounded)

### 1.1 Regulatory Context (Critical — Read First)

Compounded semaglutide existed primarily under FDA shortage-based authorizations. The timeline:

- **2022–Feb 2025:** Semaglutide on FDA drug shortage list → 503A pharmacies and 503B outsourcing facilities permitted to compound under shortage exemption.
- **Feb 21, 2025:** [FDA declared semaglutide shortage resolved](https://www.fda.gov/drugs/drug-alerts-and-statements/fda-clarifies-policies-compounders-national-glp-1-supply-begins-stabilize). All doses of injectable semaglutide (Ozempic/Wegovy) removed from shortage list.
- **April 22, 2025:** Enforcement discretion period ended for 503A compounding pharmacies ("essentially a copy" products). [Source: Burr & Forman LLP](https://www.burr.com/newsroom/articles/the-fda-removes-semaglutide-from-the-drug-shortage-list)
- **May 22, 2025:** Enforcement discretion period ended for 503B outsourcing facilities. [Source: Alston & Bird](https://www.alston.com/en/insights/publications/2025/03/fda-resolves-semaglutide-shortage)
- **As of early 2026:** [Legal status is in flux](https://healnourishgrow.com/compounded-glp-1/). Enforcement against mass-marketed compounded products has escalated. Warning letters, DOJ referrals, and enforcement actions have accelerated.
- **Important exception:** Compounders may still compound semaglutide that is **not essentially a copy** of an approved drug — for example, products meeting documented individual patient needs (different dose, different inactive ingredients due to allergic reaction, or documented medical necessity). Source: [Burr & Forman LLP](https://www.burr.com/newsroom/articles/the-fda-removes-semaglutide-from-the-drug-shortage-list)
- **Salt form controversy:** FDA has explicitly warned that [semaglutide sodium and semaglutide acetate are unapproved](https://www.uspharmacist.com/article/fda-warns-about-counterfeit-improperly-compounded-semaglutide-products) salt forms different from the base semaglutide in approved drugs. Many pharmacies were using these salts; FDA stated it is "not aware of any basis" for compounding with salt forms.

---

### 1.2 Available Formulations (Injection)

The predominant compounded form is **subcutaneous injectable** in multi-dose vials.

| Form | Notes |
|------|-------|
| Subcutaneous injectable (primary) | Multi-dose vials, most common |
| Sublingual drops/ODT | Some pharmacies; absorption data limited |
| Oral capsule | Available; bioavailability lower than injection |
| Nasal spray | Offered by some providers |
| Lyophilized powder (reconstitutable) | Less common; requires bacteriostatic water |

Sources: [GoodRx](https://www.goodrx.com/classes/glp-1-agonists/compounded-semaglutide), [Eden Health](https://www.tryeden.com/post/semaglutide-dosage-in-units-chart)

---

### 1.3 Concentrations and Vial Sizes

**Common concentrations (single-agent semaglutide base):**

| Concentration | Typical Vial Sizes | Notes |
|--------------|-------------------|-------|
| 2.5 mg/mL | 1 mL, 2 mL, 2.5 mL, 3 mL | Most common; 3 mL vial = 7.5 mg total |
| 5 mg/mL | 1 mL, 2.5 mL, 4.5 mL | Higher concentration; fewer units per dose |
| 1 mg/mL | 1 mL, 2.5 mL | Lower concentration for microdosing protocols |

Sources: [Flow Wellness](https://theflowwellness.com/understanding-medication-dosage-concentration-quantity-and-units-injected/), [Rivas Medical Weight Loss](https://www.rivasweightloss.com/glp1-dose-calculator/), [Strive Pharmacy FAQ](https://www.goodhormonehealth.com/pdfs/strive%20pharmacy-compounded%20semaglutiude%20-FAQ.pdf)

**Dose-to-unit conversion (U-100 insulin syringe):**

| Dose (mg) | At 2.5 mg/mL | At 5 mg/mL |
|-----------|-------------|-----------|
| 0.25 mg | 10 units | 5 units |
| 0.5 mg | 20 units | 10 units |
| 1.0 mg | 40 units | 20 units |
| 1.7 mg | 68 units | 34 units |
| 2.4 mg | 96 units | 48 units |

Source: [Eden Health dose chart](https://www.tryeden.com/post/semaglutide-dosage-in-units-chart)

**Critical UI note:** A "units" value is meaningless without the concentration. Selecting concentration must cascade into auto-calculated unit display.

---

### 1.4 Combination Formulations

**Semaglutide + Cyanocobalamin (Vitamin B12):**
- Most common combination; Empower Pharmacy is a major compounder
- Concentrations: 1/0.5 mg/mL or 5/0.5 mg/mL (sema/B12)
- Vial sizes: 1 mL, 2.5 mL
- B12 fixed at 0.5 mg/mL across all strengths
- Rationale: B12 for energy support and potential nausea mitigation during GLP-1 therapy
- Source: [Empower Pharmacy — Semaglutide/Cyanocobalamin](https://www.empowerpharmacy.com/compounding-pharmacy/semaglutide-cyanocobalamin-injection/)

**Semaglutide + L-Carnitine:**
- Combination for metabolic/fat-burning support
- Available as injectable and oral formulations
- Sources: [Seattle Plastic Surgery](https://www.seattleplasticsurgery.com/semaglutide-b12-weight-loss-seattle-tacoma/), [Good Day Pharmacy](https://www.gooddaypharmacy.com/injectable-and-oral-compounds)

**Semaglutide + B12 + L-Carnitine (triple combination):**
- Oral and injectable forms available
- Source: [Fridays oral formulation](https://www.joinfridays.com/products/semaglutide-b12-l-carnitine-oral)

**Semaglutide + Glycine + B12:**
- Glycine added for nausea/GI management and muscle preservation
- Source: [Strive Pharmacy](https://www.strivepharmacy.com/medications/semaglutide-glycine-b12)

**Semaglutide + NAD+:**
- Available from select pharmacies for broader metabolic/longevity support
- Source: [Mochi Health — GLP-1 Additives](https://joinmochi.com/blogs/which-additive-is-best-for-you-glp-1-additives-explained-b12-l-carnitine-nad-and-more)

**Other additive options reported:**
- Methylcobalamin (active B12 form)
- Vitamin B6 (anti-nausea)
- Glycine alone

---

### 1.5 Standard Titration Protocols

**Standard Ozempic-style titration (diabetes/weight loss):**

| Phase | Dose | Duration |
|-------|------|----------|
| Initiation | 0.25 mg/week | Weeks 1–4 |
| Dose 2 | 0.5 mg/week | Weeks 5–8 |
| Dose 3 | 1.0 mg/week | Weeks 9–12 |
| Dose 4 (Wegovy weight loss) | 1.7 mg/week | Weeks 13–16 |
| Maintenance | 2.4 mg/week | Week 17+ |

Source: [Eden Health](https://www.tryeden.com/post/semaglutide-dosage-in-units-chart), [Mountcastle Medical Spa](https://www.mountcastlemedicalspa.com/blog/a-comprehensive-guide-to-semaglutide-dosing-and-microdosing/)

**Microdosing / ultra-slow titration protocol:**

| Phase | Dose | Duration |
|-------|------|----------|
| Start | 0.05 mg/week | Weeks 1–4 |
| Step 2 | 0.1 mg/week | Weeks 5–8 |
| Step 3 | 0.2 mg/week | Weeks 9–12 |
| Continue | +0.1 mg every 4 weeks | Until effective dose |

Source: [Mountcastle Medical Spa](https://www.mountcastlemedicalspa.com/blog/a-comprehensive-guide-to-semaglutide-dosing-and-microdosing/)

**Month-by-month syringe kit protocol (pharmacy-packaged):**

| Month | Dose | Injections |
|-------|------|-----------|
| Month 1 | 0.25 mg | 4× weekly |
| Month 2 | 0.5 mg | 4× weekly |
| Month 3 | 1.0 mg | 4× weekly |
| Month 4 | 1.75 mg | 4× weekly |
| Month 5+ | 2.4–2.5 mg (maintenance) | 4× weekly |

Source: [VITAstir Clinic kit](https://www.vitastir.com/product/semaglutide-injection/), [Rock Ridge Pharmacy](https://www.rockridgepharmacy.com/compounded-semaglutide)

---

### 1.6 How Pharmacies Package Titration Kits

Two primary approaches observed in the market:

**Approach A — Single large vial with provider-directed dose escalation:**
- Patient receives one multi-dose vial (e.g., 10 mg or 20 mg total)
- Provider gives written instructions on how to increase dose week-by-week
- Patient uses same vial throughout the protocol until empty
- Strive Pharmacy 5–20 mg vials described as "typically lasting 3 months"
- Source: [Strive Pharmacy FAQ](https://www.goodhormonehealth.com/pdfs/strive%20pharmacy-compounded%20semaglutiude%20-FAQ.pdf)

**Approach B — Monthly sequential vials/kits at different concentrations:**
- Patient receives a new vial each month pre-filled at the month's target dose
- VITAstir Clinic packages "Month 1" through "Month 5+" home kits separately
- Some pharmacies offer prefilled syringes (rather than vials) per dose-increment
- Source: [VITAstir Clinic](https://www.vitastir.com/product/semaglutide-injection/), [Rock Ridge Pharmacy](https://www.rockridgepharmacy.com/compounded-semaglutide)

**Approach C — Lyophilized powder vials (reconstitution required):**
- Patient reconstitutes with bacteriostatic water before first use
- Requires separate mixing syringe (3–5 mL, 18-gauge) plus insulin syringe for injection
- Source: [FormBlends Starter Kit](https://formblends.com/articles/experience-hub/semaglutide-starter-kit-everything-you-need)

---

### 1.7 UI Data Fields — Semaglutide Cascade Dependencies

```
Drug: Semaglutide
  └─ Formulation type
      ├─ Injectable (primary)
      │   ├─ Single-agent vs. Combination
      │   │   ├─ [If combination] → Select additive(s): B12/Cyanocobalamin, Methylcobalamin, 
      │   │   │                      L-Carnitine, Glycine, NAD+, B6
      │   │   └─ [If combination] → Additive concentration (e.g., B12 0.5 mg/mL fixed)
      │   ├─ Semaglutide concentration → [1 mg/mL | 2.5 mg/mL | 5 mg/mL]
      │   ├─ Vial size → [1 mL | 2 mL | 2.5 mL | 3 mL | 4.5 mL | 5 mL]
      │   │   (Available sizes cascade from concentration selection)
      │   ├─ Starting dose (mg) → auto-calculates units based on concentration
      │   ├─ Titration protocol → [Standard 4-week steps | Microdose | Custom]
      │   │   └─ If standard → dose escalation schedule displayed/confirmed
      │   └─ Reconstitution required? [Y/N] → [Y] triggers BAC water fields
      ├─ Sublingual
      ├─ Oral capsule
      └─ Nasal spray

  Required prescription context fields:
    - Salt form confirmation: Must be semaglutide BASE (not sodium, not acetate)
    - Clinical justification for compounding (post-shortage): 
        [Different dose | Allergy to ingredient | Other documented need]
    - 503A vs 503B pharmacy designation
```

---

## 2. Testosterone (Compounded)

### 2.1 Salt Forms / Esters

| Ester/Form | Half-Life | Primary Use | Notes |
|-----------|-----------|------------|-------|
| Testosterone Cypionate | ~8 days | Injectable TRT (men) | Most common for TRT in US; IM or SubQ |
| Testosterone Enanthate | ~5–7 days | Injectable TRT (men) | Slightly shorter than cypionate; IM or SubQ |
| Testosterone Propionate | ~1–2 days | Injectable (frequent dosing) | Fast-acting; requires q2–3 day injections |
| Testosterone Undecanoate | ~21 days | Long-acting injectable | Not commercially compounded in US typically |
| Testosterone Free Base | N/A (topical) | Cream, gel | No ester; used for topical/transdermal absorption |

Sources: [ExcelMale TRT Forum](https://www.excelmale.com/threads/testosterone-carrier-oils-what-men-on-trt-actually-need-to-know.33849/), [MediVera Compounding](https://mediverarx.com/testosterone-cypionate-testosterone-propionate/)

---

### 2.2 Dosage Forms

| Form | Concentrations Available | Route | Notes |
|------|------------------------|-------|-------|
| Injectable solution | 20–200 mg/mL | IM or SubQ | Oil-based; multi-dose vials |
| Cream (transdermal) | 1–250 mg/mL (1 mg/mL increments up to 20, then 30/40/50/100/150/200/250) | Topical | Pump dispenser; penetration enhancers |
| Gel | 1–20 mg/mL | Topical | Similar to cream; various bases |
| Troche/Lozenge | 2.5 mg, 5 mg, 10 mg, 100 mg, 200 mg | Sublingual/buccal | Dissolve in mouth |
| Pellet/Implant | 75 mg/pellet (Testopel) | SubQ implant | q3–6 months; 2–6+ pellets at a time |
| Capsule (oral) | 1 mg slow-release (women); variable | Oral | Lower bioavailability |
| Vaginal cream | 20 mg/mL (30 mL dispenser) | Intravaginal | Women; 0.25–0.5 mL per use |
| Suppository | 0.5 mg vaginal (with estriol) | Vaginal | Women only |

Sources: [Empower Pharmacy Cream](https://www.empowerpharmacy.com/compounding-pharmacy/testosterone-cream/), [Empower Pharmacy Troche](https://www.empowerpharmacy.com/compounding-pharmacy/testosterone-troche/), [Empower Pharmacy Vaginal Cream](https://www.empowerpharmacy.com/compounding-pharmacy/testosterone-vaginal-cream/), [NCBI/NIH Compounded BHT Table](https://www.ncbi.nlm.nih.gov/books/NBK562866/), [Bayview Pharmacy Women](https://www.bayviewrx.com/post/testosterone-replacement-therapy-for-women-what-you-need-to-know)

---

### 2.3 Injectable: Concentration Ranges and Vial Sizes

**Testosterone Cypionate (single agent, Empower Pharmacy):**

| Concentration | Vial Sizes Available |
|--------------|---------------------|
| 20 mg/mL | 5 mL |
| 50 mg/mL | 5 mL |
| 100 mg/mL | 5 mL |
| 200 mg/mL | 1 mL, 2.5 mL, 5 mL, 10 mL, 30 mL |

Source: [Empower Pharmacy — TC Injection](https://www.empowerpharmacy.com/compounding-pharmacy/testosterone-cypionate-injection/)

**Testosterone Cypionate / Propionate blend:**
- 160/40 mg/mL (200 mg/mL total) in grapeseed oil
- Vial sizes: 5 mL, 10 mL
- Source: [Empower Pharmacy — TC/TP](https://www.empowerpharmacy.com/compounding-pharmacy/testosterone-cypionate-testosterone-propionate-injection/)

---

### 2.4 Dose Ranges: Men vs. Women

**Men (TRT — hypogonadism):**

| Route | Starting Dose | Typical Maintenance | Frequency |
|-------|-------------|--------------------|---------:|
| Injectable (IM) — cypionate | 100–200 mg | 50–200 mg | q1–2 weeks |
| Injectable (SubQ) — cypionate | 50–100 mg | 75 mg | Weekly |
| Injectable (IM) — propionate | 25–50 mg | 25–50 mg | q2–3 days |
| Transdermal cream | 100–200 mg | 100–200 mg | Daily (scrotal or other) |
| Troche/sublingual | 100–200 mg | 100–200 mg | Daily |
| Pellet | 150–450 mg (2–6 pellets) | 150–450 mg | q3–6 months |

Sources: [Balance My Hormones](https://balancemyhormones.co.uk/trt-uk/trt-dosages/), [MediVera](https://mediverarx.com/testosterone-cypionate-testosterone-propionate/), [Testopel DailyMed](https://dailymed.nlm.nih.gov/dailymed/fda/fdaDrugXsl.cfm?setid=03b9c0b1-5884-11e4-8ed6-0800200c9a66)

**Women (HSDD / hormone therapy):**

| Route | Typical Starting Dose | Typical Maintenance | Frequency |
|-------|----------------------|--------------------|---------:|
| Transdermal cream (1% = 10 mg/g) | 1–5 mg | 1–10 mg max | Daily |
| Transdermal cream (20% = 200 mg/g) | 5 mg (0.25 g) | 5–10 mg max | Daily |
| Vaginal cream (20 mg/mL) | 5 mg (0.25 mL) | 5–10 mg | Daily |
| Sublingual troche | 0.5–5 mg | 1–10 mg | Daily |
| Slow-release capsule | 1 mg | 1–5 mg | Daily |
| Vaginal suppository (with estriol) | 0.5 mg | 0.5–1 mg | Daily |

Sources: [DUTCH Test](https://dutchtest.com/articles/testosterone-prescribing-postmenopausal-women), [Empower Vaginal Cream](https://www.empowerpharmacy.com/compounding-pharmacy/testosterone-vaginal-cream/), [Dr. Oracle 1% Cream](https://www.droracle.ai/articles/826564/what-is-the-recommended-starting-dose-and-titration-schedule), [Bayview Pharmacy](https://www.bayviewrx.com/post/testosterone-replacement-therapy-for-women-what-you-need-to-know)

---

### 2.5 Combination Formulations

**Testosterone + Anastrozole (injectable or separate):**
- Commonly prescribed when aromatization (conversion to estrogen) is a concern in men
- Available as [testosterone/anastrozole pellets](https://wellsrx.com/product/testosterone-anastrozole-pellets/) (Wells Pharmacy)
- Also as oral anastrozole prescribed separately alongside injectable testosterone
- Rationale: Anastrozole (aromatase inhibitor) blocks testosterone→estrogen conversion

**Testosterone + Nandrolone Decanoate:**
- Nandrolone Decanoate / Testosterone Cypionate / Testosterone Enanthate injection
- 60/70/70 mg/mL in grapeseed oil, 5 mL vial
- Indications: hypogonadism + catabolic state, anemia, muscle wasting
- Source: [Empower Pharmacy — Nandrolone/TC/TE](https://www.empowerpharmacy.com/compounding-pharmacy/nandrolone-decanoate-testosterone-cypionate-testosterone-enanthate-injection/)

**Testosterone + Progesterone (cream, women):**
- Common in BHRT for perimenopausal/postmenopausal women
- Combined topical cream with custom ratios
- Source: [NCBI/NIH BHT Table](https://www.ncbi.nlm.nih.gov/books/NBK562866/)

**Testosterone + DHEA (cream):**
- Available as combined topical for women
- Source: [Bayview Pharmacy Women's Formulations](https://www.bayviewrx.com/post/testosterone-replacement-therapy-for-women-what-you-need-to-know)

**Testosterone + Clomiphene/Anastrozole/DHEA/Progesterone (oral capsule combo — men):**
- "Test Booster" — Clomiphene + DHEA + 7-Keto-DHEA + Progesterone + Anastrozole capsule
- Stimulates endogenous testosterone production rather than replacing externally
- Source: [Strive Pharmacy Test Booster](https://www.strivepharmacy.com/medications/test-booster-clomiphene-dhea-7-keto-anastrozole-progesterone)

---

### 2.6 Oil Base Options for Injectables

| Oil Base | Viscosity | Inflammatory Potential | Notes |
|---------|-----------|----------------------|-------|
| Cottonseed Oil | Medium-high | Low-moderate | FDA-approved brand (Depo-Testosterone/Pfizer) uses this |
| Sesame Oil | Medium | Low-moderate | FDA-approved brand (Delatestryl/enanthate) uses this; allergy risk |
| Grapeseed Oil | Low | Very low | Most common in compounded TRT; less viscous, easier to inject |
| MCT Oil (Miglyol 812N) | Very low | Very low | Pharmaceutical-grade; oxidatively stable; increasingly preferred by compounders |
| Ethyl Oleate | Very low | Low | Sometimes used in blends to lower viscosity |
| Castor Oil | Very high | Low | Used for very long-acting esters (undecanoate); slow release |

Sources: [ExcelMale TRT Forum](https://www.excelmale.com/threads/testosterone-carrier-oils-what-men-on-trt-actually-need-to-know.33849/), [Marek Health MCT vs Seed Oil](https://marekhealth.com/blog/lifestyle-wellness/holistic-health/mct-oil-injectable-testosterone), [Carie Boyd Pharmaceuticals](https://www.carieboyd.com/hormone-injections/testosterone-cypionate-200mg-propionate-10mg/)

**Why oil choice matters clinically:**
- Viscosity affects injection comfort (MCT/grapeseed easiest)
- Some patients have sesame or cottonseed oil allergies
- Oil type affects release rate and site reactions
- Compounding pharmacies can accommodate any preferred oil with a prescription note

---

### 2.7 Preservatives in Injectable Testosterone

**FDA-approved brand (Depo-Testosterone — Pfizer):**
- Benzyl alcohol: **9.45 mg/mL** (same for both 100 mg/mL and 200 mg/mL formulations)
- Benzyl benzoate: 0.1 mL/mL (100 mg/mL) or 0.2 mL/mL (200 mg/mL)
- Cottonseed oil base
- Source: [Pfizer Depo-Testosterone label](https://www.pfizermedical.com/testosterone/description)

**Compounded formulations:**
- Benzyl alcohol (0.9% = ~9 mg/mL) standard preservative for multi-dose vials
- Some compounders offer benzyl alcohol-free single-dose vials for sensitive patients
- Benzyl benzoate sometimes included as solubilizer/co-solvent (not preservative)
- **Contraindication:** Benzyl alcohol associated with "gasping syndrome" in neonates/premature infants; patients with benzyl alcohol hypersensitivity need preservative-free formulations
- Source: [Pfizer label](https://labeling.pfizer.com/ShowLabeling.aspx?id=4015), [ExcelMale Forum](https://www.excelmale.com/threads/testosterone-carrier-oils-what-men-on-trt-actually-need-to-know.33849/)

---

### 2.8 UI Data Fields — Testosterone Cascade Dependencies

```
Drug: Testosterone
  └─ Dosage Form
      ├─ Injectable
      │   ├─ Ester(s): [Cypionate | Enanthate | Propionate | Cypionate+Propionate blend]
      │   ├─ Concentration: [20 | 50 | 100 | 200 mg/mL] (cascade from ester + compound)
      │   ├─ Vial size: [1 mL | 2.5 mL | 5 mL | 10 mL | 30 mL] (cascade from conc.)
      │   ├─ Oil base: [Grapeseed | Sesame | MCT | Cottonseed | Ethyl Oleate]
      │   ├─ Preservative: [Benzyl alcohol 0.9% | Benzyl alcohol-free]
      │   ├─ Route: [IM | SubQ]
      │   ├─ Combination: [None | + Anastrozole | + Nandrolone | + Enanthate blend]
      │   └─ Dosing: dose (mg) + frequency
      │
      ├─ Cream / Gel (Topical)
      │   ├─ Patient sex: [Male | Female] → changes available concentration ranges
      │   │   ├─ Female: 1–20 mg/mL typically (free base in cream base)
      │   │   └─ Male: 100–250 mg/mL typically (scrotal or body application)
      │   ├─ Concentration: [1–250 mg/mL] in 1 mg/mL increments (30 mL dispenser)
      │   ├─ Base vehicle: [Standard cream | Lipoderm | Anhydrous | PLO gel]
      │   ├─ Application site: [Arm | Thigh | Abdomen | Scrotal | Vaginal]
      │   ├─ Combination: [None | + Progesterone | + DHEA | + Estriol]
      │   └─ Dosing: dose (mg) + frequency + volume per application
      │
      ├─ Troche / Sublingual
      │   ├─ Strength: [2.5 | 5 | 10 | 100 | 200 mg per troche]
      │   └─ Patient: male vs. female drives strength selection
      │
      ├─ Pellet / Implant
      │   ├─ Individual pellet = 75 mg testosterone (fixed)
      │   ├─ Number of pellets: [2–12+] depending on patient weight and T level
      │   ├─ Total dose = number × 75 mg
      │   ├─ Combination: [None | + Anastrozole pellet]
      │   └─ Frequency: q3–6 months
      │
      └─ Capsule / Suppository
          ├─ Strength and release: [immediate | slow-release]
          └─ Patient: female use primarily

  Patient sex is a top-level cascade driver:
    Male → enables higher cream concentrations, larger injectable doses, pellet counts
    Female → restricts cream to ≤10–20 mg/mL max, injectable rarely used, 
              troche/capsule/vaginal cream emphasized
```

---

## 3. Low-Dose Naltrexone (LDN)

### 3.1 Dose Classification System

| Category | Dose Range | Mechanism | Clinical Uses |
|----------|-----------|-----------|--------------|
| Ultra-Low-Dose (ULDN) | 0.001 mg – < 0.5 mg (often 0.001–0.1 mg) | Binds filamin-A; attenuates μ-opioid Gs-coupling | Opioid adjunct; reduce tolerance; pain amplification |
| Very Low-Dose (VLDN) | 0.001–1 mg | Possible immune/opioid modulation | Experimental; methadone detox adjunct (0.125–0.25 mg) |
| Low-Dose (LDN) | 1–5 mg (classic 0.5–4.5 mg) | TLR4 antagonism + transient opioid blockade → endorphin rebound | Fibromyalgia, MS, Crohn's, cancer, autoimmune |
| Moderate Dose | < 25 mg | Mixed antagonism | Less common |
| Standard Dose | 50 mg | Full opioid receptor blockade | Alcohol/opioid use disorder |

Sources: [PMC — LDN Review 2018](https://pmc.ncbi.nlm.nih.gov/articles/PMC6313374/), [Fusion Specialty Pharmacy ULDN](https://www.fusionspecialtypharmacy.com/product/ultra-low-dose-naltrexone-uldn/), [Accurate Clinic ULDN Handout](https://accurateclinic.com/wp-content/uploads/2025/10/Handout-patient-OIH-Naltrexone.pdf)

---

### 3.2 Available Compounded Forms

| Form | Notes |
|------|-------|
| Capsule | Most common; immediate-release preferred; Avicel or similar filler |
| Oral liquid (suspension) | 1 mg/mL typical; enables 0.1 mg increments with syringe |
| Sublingual drops | 1 dropper bottle; each drop = 0.5 mg (UK standard) |
| Troche/lozenge | Dissolve under tongue; allows splitting (e.g., 4 mg troche → 1/2/3/4 mg doses) |
| Transdermal cream | ~0.5 mg/mL; very low bioavailability (~1.1%); rarely used |
| Suppository | Available from some pharmacies |
| Eye drops | Niche use reported |

Sources: [McMahan Pharmacy](https://mcmahanpharmacy.com/news/low-dose-naltrexone/), [Restorative Compounding](https://www.restorativecompounding.com/ldn-low-dose-naltrexone-compounding), [Bare Compounding](https://barecompounding.com/blogs/news/low-dose-naltrexone), [MayaScript Pharmacy](https://mayascript.com/ldn-low-dose-naltrexone/), [LDN Research Trust — Liquid/Sublingual](https://ldnresearchtrust.org/what-dosages-are-liquid-and-sublingual-low-dose-naltrexone-ldn-available-and-how-do-i-accurately)

---

### 3.3 Liquid Concentrations and Dosing Precision

| Concentration | Volume per dose | Precision | Notes |
|--------------|----------------|-----------|-------|
| 1 mg/mL | Variable (0.1 mL increments = 0.1 mg increments) | High | Most common in UK; baby oral syringe |
| 2 mg/mL | Variable | Medium | Less common |

Sources: [LDN Research Trust Fact Sheet](https://ldnresearchtrust.org/sites/default/files/Doctors-info-pack-US.pdf), [LDN Research Trust — Liquid Dosing](https://ldnresearchtrust.org/what-dosages-are-liquid-and-sublingual-low-dose-naltrexone-ldn-available-and-how-do-i-accurately)

---

### 3.4 Common Capsule Strengths

Standard capsule strengths available from compounding pharmacies:

`0.5 mg | 1.0 mg | 1.5 mg | 2.0 mg | 2.5 mg | 3.0 mg | 4.5 mg`

Also available as custom strengths (e.g., 0.25 mg, 6 mg) upon prescription.

Sources: [McMahan Pharmacy](https://mcmahanpharmacy.com/news/low-dose-naltrexone/), [LDN Research Trust Fact Sheet](https://ldnresearchtrust.org/sites/default/files/Doctors-info-pack-US.pdf), [WellPharma Pharmacy](https://www.wellpharmapharmacy.com/blog/low-dose-naltrexone-ldn-marylands-compounding-pharmacy-guide.html)

---

### 3.5 Standard Titration Protocols

**Protocol A — Classic 3-step (most common in practice):**

| Step | Dose | Duration |
|------|------|----------|
| 1 | 1.5 mg | 2 weeks |
| 2 | 3.0 mg | 2 weeks |
| 3 | 4.5 mg | Ongoing maintenance |

Source: [WellPharma Maryland](https://www.wellpharmapharmacy.com/blog/low-dose-naltrexone-ldn-marylands-compounding-pharmacy-guide.html), [Rock Ridge Pharmacy](https://www.rockridgepharmacy.com/low-dose-naltrexone-ldn-titration-kit-using-oral-capsules)

**Protocol B — Very slow 0.5 mg increment titration (LDN Research Trust/Dr. Goldstein):**

| Step | Dose | Duration |
|------|------|----------|
| 1 | 0.5 mg | Week 1 |
| 2 | 1.0 mg | Week 2 |
| 3 | 1.5 mg | Week 3 |
| 4 | 2.0 mg | Week 4 |
| ... | +0.5 mg/week | Until optimal dose found |
| Target | 3.0–4.5 mg | Ongoing |

Note: Some patients find their optimal dose between 1.5–3.0 mg and do not need to reach 4.5 mg. Patient must be allowed to stop escalating at their "sweet spot." Sources: [LDN Research Trust — Titration](https://ldnresearchtrust.org/low-dose-naltrexone-ldn-titration), [Town & Country Compounding](https://tccompound.com/blogs/health-hub/low-dose-naltrexone-ldn-how-it-works-and-how-it-is-used-in-a-medical-practice)

**ULDN Protocol (opioid adjunct):**
- Start at 0.001 mg (1 mcg) twice daily
- Titrate as tolerated

Source: [Accurate Clinic ULDN Handout](https://accurateclinic.com/wp-content/uploads/2025/10/Handout-patient-OIH-Naltrexone.pdf)

---

### 3.6 Titration Kit Packaging

Pharmacies have developed specific titration kit formats:

**Town & Country Compounding Kit (example):**
- Color-coded bottles: green = 0.5 mg, orange = 1.5 mg
- Kit 1 (lower dose): starts at 0.5 mg; Kit 2 (standard): starts at 1.5 mg
- Each dose in clearly labeled separate container
- Source: [Town & Country Compounding Kit Video](https://www.youtube.com/watch?v=zJJbNqjE2W8)

**Rock Ridge Pharmacy Capsule Kit:**
- Capsules in individually labeled packets per dose level (0.5 mg to 4.5 mg)
- Step labeled on each packet (Step 1, Step 2, etc.)
- Source: [Rock Ridge Pharmacy LDN Kit](https://www.rockridgepharmacy.com/ldn-titration-kit-using-oral-capsules)

**Liquid titration approach:**
- Single 1 mg/mL bottle + oral syringe
- Patient measures different volumes for each dose level
- Source: [LDN Research Trust Fact Sheet](https://ldnresearchtrust.org/sites/default/files/Doctors-info-pack-US.pdf)

---

### 3.7 Filler/Excipient Considerations (Critical)

Excipient selection has a documented impact on LDN absorption and efficacy:

| Excipient | Recommendation | Reason |
|-----------|---------------|--------|
| **Avicel (microcrystalline cellulose)** | ✅ Preferred | Inert, rapid dissolution, no allergens, doesn't form sticky mass with water |
| Lactose | ⚠️ Acceptable if no intolerance | Traditional filler; some sensitivity in chronic illness patients |
| Sucrose | ✅ Acceptable | Fast-release; inert |
| **Calcium carbonate** | ❌ Avoid | Interferes with naltrexone absorption; can form insoluble mass in gut |
| **Methylcellulose / HPMC derivatives** | ❌ Avoid for standard LDN | Causes slow-release effect; blunts the acute blood spike required for LDN mechanism |
| DiluCap PSD | ✅ Alternative | Overcomes naltrexone's hydrophobic/poor solubility; better dissolution |
| DiluCap SR | ⚠️ Slow-release ONLY | Use when slow-release is specifically prescribed (different indication) |

**Critical note on slow-release:** Standard LDN requires a **rapid blood spike** (transient receptor blockade) to work. Slow-release formulations fundamentally alter the mechanism and may reduce or eliminate efficacy. Some patients with severe side effects benefit from slow-release, but it should be explicitly prescribed as an intentional variant, not a default.

Sources: [The Compounder Pharmacy — LDN Fillers](https://thecompounder.com/ldn-fillers/), [LDN Research Trust Fact Sheet](https://ldnresearchtrust.org/sites/default/files/Doctors-info-pack-US.pdf), [Fagron DiluCap Article](https://fagron.com/news-media/post/choosing-the-right-excipient-for-optimal-dosage-form-performance-in-immunocompromised-patients/)

---

### 3.8 UI Data Fields — LDN Cascade Dependencies

```
Drug: Naltrexone (Low-Dose / Ultra-Low-Dose)
  └─ Dose category
      ├─ ULDN (< 0.5 mg) → drives liquid/capsule form options
      ├─ LDN (0.5–4.5 mg) → most common; all forms available
      └─ LDN extended (4.5–12 mg) → capsule or liquid
  
  └─ Dosage Form
      ├─ Capsule (most common)
      │   ├─ Strength: [0.5 | 1.0 | 1.5 | 2.0 | 2.5 | 3.0 | 4.5 mg | custom]
      │   ├─ Filler/Excipient: [Avicel (recommended) | Lactose | Sucrose | DiluCap]
      │   ├─ Release type: [Immediate-release (standard) | Slow-release (explicit)]
      │   └─ Titration kit: [Yes / No]
      │       └─ [If Yes] → Kit format: [Step progression | Monthly escalation]
      │       └─ [If Yes] → Starting strength + target strength + increment size
      │
      ├─ Oral Liquid
      │   ├─ Concentration: [1 mg/mL | 2 mg/mL]
      │   ├─ Volume: [30 mL | 60 mL | 120 mL]
      │   └─ Starting dose (mg) → auto-calculates volume per dose
      │
      ├─ Sublingual Drops
      │   ├─ Drops per dose (each drop = 0.5 mg standard)
      │   └─ Bottle size
      │
      ├─ Troche/Lozenge
      │   ├─ Total strength per troche (e.g., 4 mg)
      │   └─ Prescribed fraction (1/4, 1/2, whole = 1, 2, 4 mg)
      │
      └─ Transdermal Cream
          └─ Concentration + volume (low bioavailability caveat)

  Prescriber alert fields:
    - Is patient currently on opioids? [Y/N] → [Y] triggers ULDN pathway + contraindication warning
    - Confirm immediate-release intended (not slow-release) unless explicitly marked SR
```

---

## 4. BPC-157 (Body Protection Compound)

### 4.1 Regulatory Status (Critical)

BPC-157 occupies a complex and legally ambiguous position as of April 2026:

- **Late 2023:** [FDA added BPC-157 to Category 2 bulk drug substances list](https://www.statnews.com/2026/02/03/bpc-157-peptide-science-safety-regulatory-questions/) — meaning "do not compound" under 503A regulations. Other peptides on same list: TB-500, CJC-1295, Ipamorelin, Thymosin Alpha-1, GHK-Cu (injectable), Melanotan II, KPV, GHRP-2, GHRP-6, Selank, Semax, Kisspeptin-10, Epitalon, DSIP, and others (19 total Category 2 peptides).
- **2024:** Legal challenges from compounders → September 2024 settlement required FDA to submit key peptides for formal Pharmacy Compounding Advisory Committee (PCAC) review before finalizing ban. [Source: Safe Harbor Group](https://www.safehg.com/fdas-overreach-on-compounded-peptides-legal-battles-and-how-clinics-can-push-back/)
- **As of early 2026:** [BPC-157 remains Category 2 — under review](https://peptidelaws.com/news/fda-peptide-regulations-2026). **"Likely not legal"** for US compounding pharmacies to provide BPC-157 (per health care attorney David Holt). Some pharmacies continue to supply it despite prohibition.
- **Enforcement reality:** FDA has sent few warning letters to pharmacies supplying BPC-157 despite the prohibition. Gray market thrives via "research chemical" loophole (not for human consumption). RFK Jr. has signaled potential loosening of peptide restrictions.
- **No approved drug exists:** Unlike semaglutide, there is no FDA-approved BPC-157 product. Status is "unapproved drug," not "compounded version of approved drug."

Source: [STAT News — BPC-157](https://www.statnews.com/2026/02/03/bpc-157-peptide-science-safety-regulatory-questions/), [Elite NP — Peptide Reclassification 2026](https://elitenp.com/fda-peptide-reclassification-2026-what-it-means-for-providers-and-patients/)

---

### 4.2 Formulations and Concentrations

**Injectable (Lyophilized Powder — Reconstitutable):**

| Vial Size | Common Reconstitution | Resulting Concentration | Notes |
|-----------|----------------------|------------------------|-------|
| 5 mg | 0.5–3.0 mL BAC water | 1.67–10 mg/mL | 10 mg/mL = 100 mcg per 10 units on U-100 syringe |
| 10 mg | 1.0–6.0 mL BAC water | 1.67–10 mg/mL | Most common clinic vial |
| 2 mg | 1–2 mL BAC water | 1–2 mg/mL | Starter vials |

Reconstitution standard (Happy Hormones MD protocol):
- 5 mg vial: inject **0.5 mL** BAC water → 10 mg/mL (10 units = 100 mcg per dose)
- 10 mg vial: inject **1.0 mL** BAC water → 10 mg/mL

Sources: [Happy Hormones MD Protocol](https://happyhormonesmd.com/wp-content/uploads/2024/12/BPC-157-Patient-Information.docx.pdf), [PeptideDosages.com BPC-157 5mg](https://peptidedosages.com/single-peptide-dosages/bpc-157-5-mg-vial-dosage-protocol/)

**Storage:**
- Lyophilized form: Stable up to 3 years frozen (−20°C), 2 years refrigerated; protect from light
- Reconstituted: Refrigerate at 2–8°C; stable ~6 weeks; avoid freeze–thaw cycles

**Oral Capsules:**
- Typical dose per capsule: 250–500 mcg (0.25–0.5 mg)
- Administered 1–3 times daily
- Best absorbed on empty stomach
- Lower systemic bioavailability than injection; preferred route for GI indications
- Source: [Peptides.org BPC-157 Dosage](https://www.peptides.org/bpc-157-dosage/)

**Nasal Spray:**
- Concentration example: 10 mg per 10 mL bottle = 1 mg/mL = 100 mcg per 0.1 mL spray
- Each actuation delivers ~100 mcg
- ~100 sprays per 10 mL bottle
- Sold by wellness clinics (e.g., Gary Brecka nasal spray blend for $375/bottle)
- Source: [VPeptide BPC-157 Nasal Spray](https://vpeptide.com/product/bpc-157-nasal-spray-canada/), [STAT News](https://www.statnews.com/2026/02/03/bpc-157-peptide-science-safety-regulatory-questions/)

---

### 4.3 Dose Ranges and Protocols

**Standard dose range:** 200–1,000 mcg/day (body-weight-based: ~2.5–3.75 mcg/kg twice daily)

| Body Weight | Conservative | Standard | Higher (supervised) |
|-------------|-------------|----------|--------------------:|
| 125 lb (57 kg) | 200 mcg | 400 mcg | 600 mcg |
| 150 lb (68 kg) | 250 mcg | 500 mcg | 750 mcg |
| 180 lb (82 kg) | 300 mcg | 600 mcg | 900 mcg |
| 200 lb (91 kg) | 350 mcg | 700 mcg | 1,000 mcg |

Source: [Dr. Rogers-Centers](https://drrogerscenters.com/blogs/news/bpc-157-dosage-a-complete-guide), [Nulevel Wellness Medspa](https://nulevelwellnessmedspa.com/bpc-157-dosage/)

**Protocol by route and indication:**

| Route | Typical Daily Range | Frequency | Duration | Best For |
|-------|-------------------:|-----------|----------|---------|
| SubQ Injection | 250–500 mcg | 1–2× daily | 4–6 weeks | Muscle, tendon, joint recovery |
| IM Injection | 250–500 mcg | 1× daily | 4–6 weeks | Localized deep injury |
| Oral/Sublingual | 200–500 mcg | 1–2× daily | 6–8 weeks | GI healing, ulcer, leaky gut |
| Nasal Spray | ~100–300 mcg | 1–3 sprays | Variable | Systemic; brain/neuro support |

Source: [Yunique Medical](https://yuniquemedical.com/bpc-157-dosage/), [Dr. Rogers-Centers](https://drrogerscenters.com/blogs/news/bpc-157-dosage-a-complete-guide)

**Indications and tailored protocols:**

| Indication | Dose | Route | Cycle |
|-----------|------|-------|-------|
| Tendon/ligament repair | 250–500 mcg/day | SubQ near injury | 4–6 weeks, then off 2–4 weeks |
| Post-surgical healing | 500–750 mcg/day | SubQ or IM | 4–6 weeks minimum |
| Gut repair (IBD/ulcers) | 500–1,000 mcg/day | Oral (empty stomach) | 4–6 weeks; extend PRN |
| Neuroprotection | 200–500 mcg/day | SubQ systemic | 4–8+ weeks |
| Joint pain / arthritis | 250–750 mcg/day | SubQ near joint | 4–6 weeks, reassess |
| Maintenance | 250 mcg | SubQ or oral | Ongoing pulse (2 weeks on, 2 off) |

Source: [Yunique Medical](https://yuniquemedical.com/bpc-157-dosage/), [Tucson Wellness MD](https://tucsonwellnessmd.com/bpc-157-dosage-guide/)

---

### 4.4 Reconstitution Instructions

Standard protocol for lyophilized BPC-157:

1. Allow vial to reach room temperature (reduces condensation)
2. Draw desired volume of bacteriostatic water (BAC water) into syringe
3. Clean vial stopper with alcohol swab
4. Inject BAC water slowly **down the inside wall** of the vial (not directly onto peptide powder)
5. **Do not shake** — gently swirl or roll until fully dissolved
6. Label vial with date of reconstitution
7. Refrigerate at 2–8°C; protected from light

**Bacteriostatic water (0.9% benzyl alcohol) is required** for multi-dose vials; sterile water can be used for single-dose vials but offers no antimicrobial preservation.

Sources: [PeptideDosages.com](https://peptidedosages.com/single-peptide-dosages/bpc-157-5-mg-vial-dosage-protocol/), [Happy Hormones MD](https://happyhormonesmd.com/wp-content/uploads/2024/12/BPC-157-Patient-Information.docx.pdf), [Prime Peptides](https://primepeptides.co/how-much-bacteriostatic-water-to-add-to-peptides/)

---

### 4.5 Common Combinations

**BPC-157 + TB-500 (Thymosin Beta-4 fragment):**
- Most common BPC-157 combination
- Available as blend vials: 5/5 mg or 10/10 mg
- Also as liposomal oral formulation (BPC-157 + TB-500)
- Some protocols recommend separate injections (different sites), not mixing in same vial, due to pH difference
- TB-500 dose: 2–5 mg weekly (divided into 2–3 doses); BPC-157 dose continues per standard protocol
- Sources: [Simon's Compounding](https://simonsrx.com/shop/bpc-157-tb-500/), [Core Peptides Blend](https://www.corepeptides.com/peptides/bpc-157-tb-500-10mg-blend/), [Freedom Pharmacy Oral](https://shop.freedompharmacyms.com/products/liposomal-bpc-157-tb-500-oral-peptide), [Saving Face Austin](https://www.savingfaceaustin.com/blog/bpc-157-tb500-the-peptide-duo-for-next-level-healing/)

**BPC-157 + TB-500 + KPV + GHK-Cu:**
- Advanced multi-peptide healing blend (quad formula)
- 5/5/10/5 mg per vial; subcutaneous injection 2–3× weekly
- Source: [Beverly Hills Rejuvenation Center](https://www.bhrcenter.com/peptides/tb-500-5mg-bpc-157-5mg-kpv-10mg-ghk-cu-5mg/)

---

### 4.6 UI Data Fields — BPC-157 Cascade Dependencies

```
Drug: BPC-157
  ├─ REGULATORY WARNING field: "BPC-157 is currently Category 2 on FDA's bulk drug 
  │    substances list (as of 2026). Compounding under 503A is legally restricted. 
  │    Prescriber must confirm jurisdiction compliance and clinical justification."
  │
  └─ Formulation
      ├─ Injectable (lyophilized powder)
      │   ├─ Vial size: [2 mg | 5 mg | 10 mg]
      │   ├─ Combination: [Single | + TB-500 | + TB-500 + KPV + GHK-Cu]
      │   │   └─ [If combo] → Specify mg of each component
      │   ├─ Reconstitution volume (mL of BAC water) → auto-calculates mg/mL concentration
      │   ├─ Dose per injection (mcg) → auto-calculates units (based on mg/mL + U-100 syringe)
      │   ├─ Injection route: [SubQ | IM]
      │   ├─ Injection site: [Near injury | Abdomen/systemic | Other]
      │   ├─ Frequency: [Once daily | Twice daily | 2–3×/week (maintenance)]
      │   └─ Cycle: [Number of weeks on] + [Weeks off / break period]
      │
      ├─ Oral Capsule
      │   ├─ Dose per capsule: [250 mcg | 500 mcg | custom]
      │   ├─ Frequency: [Once daily | Twice daily | Three times daily]
      │   ├─ Timing: [Empty stomach (recommended)]
      │   └─ Indication focus: GI/gut healing vs. systemic
      │
      └─ Nasal Spray
          ├─ Concentration: [1 mg/mL standard → 100 mcg/spray]
          ├─ Dose per use: [# sprays]
          └─ Frequency: [1–3× daily]

  Body weight field (kg or lbs) → enables weight-based dose calculator
  Indication selection → suggests dose range, route, and cycle duration
```

---

## 5. UI Data Field & Cascading Dependency Analysis

### 5.1 Universal Pattern: The Cascade Tree

Every compounded medication prescription requires a **hierarchical cascade** where each selection constrains the valid options for downstream fields:

```
LEVEL 1: Drug selection
    ↓
LEVEL 2: Dosage form (injectable / cream / capsule / etc.)
    ↓
LEVEL 3: Salt form / ester / variant (cypionate vs. enanthate; base vs. sodium salt)
    ↓
LEVEL 4: Concentration (mg/mL)
    ↓
LEVEL 5: Vial / dispenser size (constrains total mg available per fill)
    ↓
LEVEL 6: Combination (additive selection → its own concentration field)
    ↓
LEVEL 7: Vehicle/base (oil type, cream base, excipient)
    ↓
LEVEL 8: Preservative / special packaging (benzyl alcohol Y/N; color-coded kits)
    ↓
LEVEL 9: Dose + frequency + route → auto-calculates units/volume per administration
    ↓
LEVEL 10: Titration protocol → generates week-by-week schedule from above fields
```

### 5.2 Key Cascading Dependency Pairs

| Field Selected | Constrains / Changes |
|---------------|---------------------|
| Drug = Semaglutide | Triggers regulatory status warning (post-shortage); must document medical necessity |
| Salt form = base vs. acetate | Semaglutide base only; block acetate/sodium salt selection with warning |
| Concentration selected | Changes dose-to-volume/unit calculation; changes compatible vial sizes |
| Formulation = injectable + lyophilized | Adds BAC water volume field, reconstitution instructions panel |
| Patient sex = Female (testosterone) | Restricts injectable dose range; restricts cream concentrations to ≤20 mg/mL; removes high-dose pellet options |
| Combination = +B12/cyanocobalamin | Adds B12 concentration field (typically 0.5 mg/mL fixed); changes label requirements |
| LDN form = capsule | Adds excipient selector; adds release-type selector (IR vs. SR) with warning |
| LDN titration kit = Yes | Opens multi-step dose schedule builder |
| BPC-157 selected | Triggers Category 2 legal status warning; adds reconstitution calculator |
| BPC-157 vial size + BAC water volume | Auto-calculates mg/mL → drives unit-per-dose calculation |
| Oil base = sesame | Adds allergy screening flag for sesame sensitivity |
| Preservative = benzyl alcohol-free | Changes packaging to single-dose vials only (no multi-dose) |

### 5.3 Calculated Fields (Auto-Computed from Inputs)

| Calculated Field | Formula | Requires |
|-----------------|---------|---------|
| Volume per dose (mL) | Dose (mg) ÷ Concentration (mg/mL) | Dose + Concentration |
| Units per dose (U-100 syringe) | Volume (mL) × 100 | Volume per dose |
| Total mg per vial | Concentration (mg/mL) × Vial size (mL) | Concentration + Vial size |
| Expected days supply | Total mg ÷ Dose per administration ÷ Frequency | Total mg + Dose + Frequency |
| BPC-157 concentration post-reconstitution | Peptide mg ÷ BAC water volume (mL) | Vial size + Water volume |
| LDN liquid volume per dose | Dose (mg) ÷ Concentration (mg/mL) | Dose + Liquid concentration |
| Testosterone cream dose (mg) from pump | Pump volume (mL) × Concentration (mg/mL) | Concentration + Dispenser calibration |
| Pellet count (testosterone) | Total dose (mg) ÷ 75 mg/pellet | Target total dose |

### 5.4 Regulatory / Safety Alert Fields

Each medication requires specific non-dismissible alert conditions:

| Drug | Alert Condition | Alert Content |
|------|----------------|--------------|
| Semaglutide | Post-shortage compounding | Requires documented medical necessity (different dose, inactive ingredient allergy, or documented clinical need); salt form must be base not sodium/acetate |
| Semaglutide | Salt form = sodium or acetate | "FDA has stated this salt form is not an approved active ingredient. Do not prescribe." |
| Testosterone | Patient = pediatric | Benzyl alcohol contraindication warning |
| Testosterone (women) | Dose > 10 mg/day | Exceeds maximum recommended female dose; confirm clinical justification |
| LDN | Concurrent opioid use | Opioid antagonism will precipitate withdrawal; use ULDN protocol only |
| LDN | Release type = slow | "Slow-release formulation alters LDN mechanism. Standard LDN requires rapid blood spike for TLR4 modulation. Confirm slow-release is intentional." |
| LDN | Filler = calcium carbonate | "This filler interferes with naltrexone absorption. Select Avicel, lactose, or sucrose." |
| BPC-157 | Any selection | "BPC-157 is Category 2 on FDA bulk substances list (2023). Compounding under 503A is legally restricted as of 2026. Prescriber assumes full regulatory compliance responsibility." |
| BPC-157 | Patient = cancer diagnosis | "BPC-157 has theoretical angiogenic effects that may promote tumor vascularity. Exercise extreme caution in oncology patients." |

---

## Appendix: Source Reference Summary

| Topic | Primary Source |
|-------|--------------|
| Semaglutide FDA shortage resolution | [FDA.gov](https://www.fda.gov/drugs/drug-alerts-and-statements/fda-clarifies-policies-compounders-national-glp-1-supply-begins-stabilize) |
| Semaglutide enforcement dates | [Burr & Forman LLP](https://www.burr.com/newsroom/articles/the-fda-removes-semaglutide-from-the-drug-shortage-list), [Alston & Bird](https://www.alston.com/en/insights/publications/2025/03/fda-resolves-semaglutide-shortage) |
| Semaglutide 2026 enforcement status | [Heal Nourish Grow](https://healnourishgrow.com/compounded-glp-1/) |
| Semaglutide salt form warning | [US Pharmacist](https://www.uspharmacist.com/article/fda-warns-about-counterfeit-improperly-compounded-semaglutide-products), [Diatribe](https://diatribe.org/diabetes-medications/fda-warns-against-compounded-semaglutide-diabetes-weight-loss) |
| Semaglutide concentrations and dosing | [Flow Wellness](https://theflowwellness.com/understanding-medication-dosage-concentration-quantity-and-units-injected/), [Rivas Medical](https://www.rivasweightloss.com/glp1-dose-calculator/) |
| Semaglutide + B12 formulation | [Empower Pharmacy](https://www.empowerpharmacy.com/compounding-pharmacy/semaglutide-cyanocobalamin-injection/), [Belmar Pharma](https://www.belmarpharmasolutions.com/package-inserts/cyanocobalamin-semaglutide-compound/) |
| Semaglutide additives guide | [Mochi Health](https://joinmochi.com/blogs/which-additive-is-best-for-you-glp-1-additives-explained-b12-l-carnitine-nad-and-more) |
| Semaglutide titration schedule | [Beauty With Bubbly dosing form](https://beautywithbubbly.com/wp-content/uploads/2023/03/Semaglutide-Treatment-Dosage-Form.pdf), [Rock Ridge Pharmacy](https://www.rockridgepharmacy.com/compounded-semaglutide) |
| Testosterone cypionate concentrations/vials | [Empower Pharmacy](https://www.empowerpharmacy.com/compounding-pharmacy/testosterone-cypionate-injection/) |
| Testosterone oil base comparison | [ExcelMale Forum](https://www.excelmale.com/threads/testosterone-carrier-oils-what-men-on-trt-actually-need-to-know.33849/), [Marek Health](https://marekhealth.com/blog/lifestyle-wellness/holistic-health/mct-oil-injectable-testosterone) |
| Testosterone cypionate preservative | [Pfizer Depo-Testosterone label](https://www.pfizermedical.com/testosterone/description) |
| Testosterone cream concentrations | [Empower Pharmacy Cream](https://www.empowerpharmacy.com/compounding-pharmacy/testosterone-cream/) |
| Testosterone troches | [Empower Pharmacy Troche](https://www.empowerpharmacy.com/compounding-pharmacy/testosterone-troche/) |
| Testosterone pellets | [Testopel.com](https://www.testopel.com/dosing), [DailyMed](https://dailymed.nlm.nih.gov/dailymed/fda/fdaDrugXsl.cfm?setid=03b9c0b1-5884-11e4-8ed6-0800200c9a66) |
| Testosterone for women | [DUTCH Test](https://dutchtest.com/articles/testosterone-prescribing-postmenopausal-women), [Dr. Oracle](https://www.droracle.ai/articles/826564/what-is-the-recommended-starting-dose-and-titration-schedule) |
| Testosterone + nandrolone combination | [Empower Pharmacy Nandrolone/TC/TE](https://www.empowerpharmacy.com/compounding-pharmacy/nandrolone-decanoate-testosterone-cypionate-testosterone-enanthate-injection/) |
| Testosterone + anastrozole pellet | [Wells Pharmacy](https://wellsrx.com/product/testosterone-anastrozole-pellets/) |
| Compounded BHT dosage forms table | [NIH/NCBI National Academies](https://www.ncbi.nlm.nih.gov/books/NBK562866/) |
| LDN dose classification | [PMC — LDN Review](https://pmc.ncbi.nlm.nih.gov/articles/PMC6313374/) |
| LDN formulations | [McMahan Pharmacy](https://mcmahanpharmacy.com/news/low-dose-naltrexone/), [MayaScript](https://mayascript.com/ldn-low-dose-naltrexone/), [Bare Compounding](https://barecompounding.com/blogs/news/low-dose-naltrexone) |
| LDN titration protocols | [WellPharma](https://www.wellpharmapharmacy.com/blog/low-dose-naltrexone-ldn-marylands-compounding-pharmacy-guide.html), [LDN Research Trust](https://ldnresearchtrust.org/low-dose-naltrexone-ldn-titration), [Town & Country](https://tccompound.com/blogs/health-hub/low-dose-naltrexone-ldn-how-it-works-and-how-it-is-used-in-a-medical-practice) |
| LDN titration kit packaging | [Rock Ridge Pharmacy](https://www.rockridgepharmacy.com/ldn-titration-kit-using-oral-capsules), [Town & Country Kit Video](https://www.youtube.com/watch?v=zJJbNqjE2W8) |
| LDN filler/excipient guidance | [The Compounder Pharmacy](https://thecompounder.com/ldn-fillers/), [LDN Research Trust Fact Sheet](https://ldnresearchtrust.org/sites/default/files/Doctors-info-pack-US.pdf), [Fagron DiluCap](https://fagron.com/news-media/post/choosing-the-right-excipient-for-optimal-dosage-form-performance-in-immunocompromised-patients/) |
| LDN ULDN distinction | [Fusion Specialty Pharmacy](https://www.fusionspecialtypharmacy.com/product/ultra-low-dose-naltrexone-uldn/), [Accurate Clinic](https://accurateclinic.com/wp-content/uploads/2025/10/Handout-patient-OIH-Naltrexone.pdf) |
| BPC-157 regulatory status | [STAT News 2026](https://www.statnews.com/2026/02/03/bpc-157-peptide-science-safety-regulatory-questions/), [PeptideLaws.com](https://peptidelaws.com/news/fda-peptide-regulations-2026), [Elite NP](https://elitenp.com/fda-peptide-reclassification-2026-what-it-means-for-providers-and-patients/) |
| BPC-157 legal challenge / settlement | [Safe Harbor Group](https://www.safehg.com/fdas-overreach-on-compounded-peptides-legal-battles-and-how-clinics-can-push-back/) |
| BPC-157 dose protocols | [Yunique Medical](https://yuniquemedical.com/bpc-157-dosage/), [Dr. Rogers-Centers](https://drrogerscenters.com/blogs/news/bpc-157-dosage-a-complete-guide), [Tucson Wellness MD](https://tucsonwellnessmd.com/bpc-157-dosage-guide/) |
| BPC-157 reconstitution | [PeptideDosages.com](https://peptidedosages.com/single-peptide-dosages/bpc-157-5-mg-vial-dosage-protocol/), [Happy Hormones MD](https://happyhormonesmd.com/wp-content/uploads/2024/12/BPC-157-Patient-Information.docx.pdf) |
| BPC-157 + TB-500 combination | [Simon's Compounding](https://simonsrx.com/shop/bpc-157-tb-500/), [Beverly Hills Rejuvenation](https://www.bhrcenter.com/peptides/tb-500-5mg-bpc-157-5mg-kpv-10mg-ghk-cu-5mg/) |
| BPC-157 nasal spray specs | [VPeptide](https://vpeptide.com/product/bpc-157-nasal-spray-canada/) |

---

*End of Research Area 7*
