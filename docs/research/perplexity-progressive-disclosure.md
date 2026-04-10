# Research Area 5: Progressive Disclosure UX in Healthcare
## Medication Ordering Interface Design — Best Practices for CompoundIQ

*Research compiled April 2026*

---

## Table of Contents

1. [EHR Medication Ordering UX — Major Systems Analysis](#1-ehr-medication-ordering-ux)
2. [Progressive Disclosure Pattern](#2-progressive-disclosure-pattern)
3. [Speed Optimization](#3-speed-optimization)
4. [Auto-Complete, Smart Defaults, and Favorites](#4-auto-complete-smart-defaults-and-favorites)
5. [Structured Data vs. Free Text](#5-structured-data-vs-free-text)
6. [Case Studies](#6-case-studies)
7. [Synthesis: Implications for CompoundIQ](#7-synthesis-implications-for-compoundiq)

---

## 1. EHR Medication Ordering UX

### 1.1 Epic CPOE and the "Order Composer"

Epic's Computerized Provider Order Entry system is the most widely deployed EHR platform in the U.S. hospital market. Its medication ordering workflow is anchored around several core UX patterns:

**The Order Composer** is the term Epic uses for the modal interface where a clinician finalizes a medication order's details — dose, route, frequency, duration, priority, and special instructions. When a user selects a medication from search results or a preference list, the Order Composer opens to allow confirmation or modification of each field. Epic's order friction analytics track the number of field changes made within the Order Composer before signing, generating a "Friction per Order" (FPO) score. This score measures how much effort each order requires. According to [research published in the AMIA Annual Symposium Proceedings](https://pmc.ncbi.nlm.nih.gov/articles/PMC10785931/), Epic's vendor-recommended benchmark FPO is **5 for preference list medication orders** and **1 for order set orders**, reflecting the expectation that orders from pre-built sets require almost no modification at all.

**SmartSets (Order Sets)** are Epic's pre-built bundles of related orders for specific clinical scenarios (e.g., "Acute Pain Management," "Admission Orders — Cardiology"). In one academic medical center analysis of 5.8 million inpatient orders, 46.6% of orders came from order sets, and order set orders had an average FPO of 0.41, compared to 2.11 for preference list medication orders — a **5x reduction in ordering friction** ([AMIA 2024](https://pmc.ncbi.nlm.nih.gov/articles/PMC10785931/)). SmartSets can be customized by individual users, departments, or specialties, and can include pre-checked defaults that pre-populate the Order Composer.

**Preference Lists / Favorites** are the "frequently used" medication configurations that clinicians save for quick access. Epic's University of Iowa documentation describes how [preference lists and user panels reduce ordering time](https://epicsupport.sites.uiowa.edu/epic-resources/efficiencies-orders) by surfacing a clinician's most-used orders at the top of search results without requiring full-text search.

**Order Sentences** are pre-written complete medication orders (e.g., "Acetaminophen 1000mg PO Q6H PRN pain"). Rather than configuring each field, a clinician can select the matching sentence and sign with minimal changes. However, as analyzed by EHR UX researcher Gregory Schmidt, [order sentences have significant UX problems](https://www.gregoryschmidt.com/articles/order-entry-ux-eg-order-entry-and-order-sentences): for commonly ordered drugs with many permutations (e.g., insulin, warfarin), the list of available sentences becomes overwhelming and visually similar items become dangerous to confuse. Schmidt recommends showing only the medication name in initial search results, then revealing sentences only after the user selects a specific drug.

**Epic-specific speed features include:**
- Ctrl+O keyboard shortcut to jump directly to the order field
- Voice commands via Dragon Medical One integration to queue orders without mouse navigation
- User Panels: clinician-created groups of their most common orders, accessible in one click
- Copy Previous Orders: reuse a prior order's settings as a starting point
- Real-Time Prescription Benefits (RTPB): shows cost and formulary status as the order is built, integrated within the ordering workflow ([Epic open.epic interface documentation](https://open.epic.com/Interface/Other))

**UX Pain Point:** The AMA-commissioned multi-center study ["62 clicks to order Tylenol"](https://www.ama-assn.org/practice-management/digital-health/62-clicks-order-tylenol-what-happens-when-ehr-tweaks-go-bad) found a **9x difference in task completion time** and an **8x difference in click count** for identical tasks across Epic and Cerner implementations at different hospitals. Error rates for ordering oral prednisone taper reached 50% at one institution versus 16.7% at the best-performing site. This demonstrates that while Epic's underlying architecture supports efficient ordering, local configuration dramatically affects real-world usability.

### 1.2 Cerner/Oracle Health PowerChart

Cerner Millennium's PowerChart is the clinician-facing EHR interface for ordering in Oracle Health environments. Its medication ordering UX uses several analogous but distinctly named patterns:

**PowerPlans** are Cerner's equivalent of Epic's SmartSets — pre-built order sets for specific clinical scenarios. A [2024 JMIR Formative Research study of PowerPlan usage](https://formative.jmir.org/2024/1/e54022) found that the 5 most utilized order sets across a health system were Acute Pain Management (325,664 uses), Acute Behavioural Disturbance (63,354), VTE Prophylaxis (51,023), Healthy Newborn Protocols (26,229), and Postoperative Nausea and Vomiting (25,458). A systematic review found 36 published studies on PowerPlans (Cerner) and SmartSets (Epic), with 30 of 36 reporting favorable outcomes, though only half measured clinical variation impact.

**Order Sentences in PowerChart** work similarly to Epic's: when a user searches for a medication, they are presented with a list of pre-built order sentences. In the [Cerner PowerChart intro to ordering tutorial](https://www.youtube.com/watch?v=mjX9gFKpk18), the interface presents "pre-built sentences" for commonly ordered medications (e.g., "Acetaminophen 1000mg Q6H") and falls back to blank field-by-field entry when no sentence matches. The "Missing Required Details" button in Cerner's order entry form counts how many required fields are unfilled and navigates the user sequentially through each one — a form of progressive disclosure by necessity rather than design.

**UX icons and contextual indicators** in Cerner are extensive — the [CST Cerner Help documentation](https://cstcernerhelp.healthcarebc.ca/Patient_Chart/Orders/Meds/Medication_Order_Buttons_and_Icons.htm) lists dozens of distinct icons for: allergy conflicts, drug interactions, formulary status, non-formulary flags, soft/hard stop indicators, prescription vs. ambulatory vs. inpatient order type, and PowerPlan membership. This density of visual information provides contextual awareness but can contribute to cognitive load for less experienced users.

**New Order Entry (NOE)** is Cerner's primary search interface. It provides a unified search across medications, labs, imaging, and other orders, with type-ahead suggestions. Quick Orders provide a favorites-style shortcut panel for the most common orders by department.

### 1.3 Athenahealth (athenaOne)

Athenahealth's athenaOne system focuses primarily on ambulatory/outpatient practice workflows. Its medication ordering UX emphasizes role-based differentiation and exception-based surfacing of information:

**Role-specific views** mean that physicians see different interfaces than medical assistants, billers, or care managers. The [athenaOne efficiency blog](https://www.athenahealth.com/resources/blog/athenaone-efficient-practice-management-workflows) highlights that "workflows surface tasks that require attention, rather than having users sift through all available data" — a form of progressive disclosure at the workflow level rather than the field level.

**Formulary check inline**: The [athenahealth athenaPractice roadmap documentation](https://akamai-opus-nc-public.digitellcdn.com/uploads/nachc/redactor/35871f58de2d9aeddde0ee0f65aea94f3b099750f6e042e7711bf056ddf97fdd.pdf) shows that before selecting a medication to prescribe, providers can see the number and types of contraindications at a glance and drill down for details — a tiered disclosure from summary indicators to detail views.

**e-prescribing integration**: athenaOne connects to Surescripts for pharmacy-direct prescribing. The [athenaOne Base Service description](https://www.athenahealth.com/sites/default/files/media_docs/athenaOne-Service-Description.pdf) notes that Order-specific questions are maintained globally and prompt additional information for specific orders — only showing supplemental fields when the order type requires them.

**API-based order creation** is documented at [docs.athenahealth.com](https://docs.athenahealth.com/api/workflows/order-creation): orders are created via API for open encounters and reviewed and signed by providers in the athenaOne UI. This enables pre-population of order details from external systems.

### 1.4 Key Lessons for CompoundIQ

| Pattern | EHR Implementation | CompoundIQ Application |
|---|---|---|
| Order sentences / pre-built orders | Show common compound configurations upfront | "Favorites" library of full compound configurations by prescriber |
| Progressive field revelation | Missing Required Details button; dynamic fields | Show base fields first, reveal advanced fields (diluent, BUD, special packaging) conditionally |
| Friction measurement | Epic's FPO score; track field changes | Track how often prescribers modify defaults; use data to tune smart defaults |
| Order sets | Disease-specific or patient-type bundles | Compound-type order sets (e.g., "Pain Management Compounding Set") |
| Role-based views | Athena's role differentiation | Prescriber view vs. pharmacist review vs. technician preparation view |
| Inline contextual warnings | Formulary check, allergy alerts inline | Ingredient interaction warnings, BUD warnings, and route-dosage consistency checks |

---

## 2. Progressive Disclosure Pattern

### 2.1 Definition and Core Principles

Progressive disclosure is a UX design technique that defers advanced features and information to secondary interface components, presenting users with only the content essential for their immediate task. As defined by the [Interaction Design Foundation](https://ixdf.org/literature/topics/progressive-disclosure), it is a method to "defer advanced features and information to secondary UI components... to improve usability for novice and experienced users."

The pattern was formally articulated by Tidwell in *Designing Interfaces* (2005) and popularized through Jakob Nielsen's research in 2006. It rests on Sweller's Cognitive Load Theory (1988), which established that human working memory can only process a limited number of information elements simultaneously. By revealing complexity in stages, progressive disclosure ensures that the working memory available is directed at the clinical decision being made, not at navigating the interface.

**Core principles:**

1. **Prioritize information hierarchy** — Identify which fields are essential for every order vs. which are only needed conditionally. Show only essential fields initially.
2. **Contextual revelation** — Reveal additional fields based on prior selections (e.g., if Route = "IV", reveal IV-specific fields like infusion rate, diluent). If Route = "topical", hide IV fields entirely.
3. **Preference persistence** — Remember a user's chosen complexity level across sessions (e.g., a clinician who always configures duration should have that field pre-expanded).
4. **Graduated complexity** — Match the disclosed information to the user's expertise and the order's complexity; an order sentence for a common drug should require zero additional configuration.
5. **Smooth transitions** — Expanding sections should animate naturally; collapsing them should not lose data.
6. **Reversibility** — Users must be able to expand to full detail and collapse back to simplified view at any time.

**Measured impact:**

- Interfaces applying progressive disclosure achieve **30–50% faster initial task completion** while maintaining **70–90% feature discoverability** for advanced capabilities ([UX/UI Principles research synthesis](https://uxuiprinciples.com/en/principles/progressive-disclosure))
- Progressive interfaces improve completion rates **25–40%**, reduce abandonment **30–50%**, and increase feature adoption **40–60%** ([UX Collective](https://uxdesign.cc/progressive-disclosure-91ea681eab70))

### 2.2 How to Reveal Fields Only When Prior Selections Make Them Relevant

This is the core mechanic for medication ordering UX. The principle is **conditional field display**: a field only appears when its parent condition is met.

**In medication ordering, the decision tree looks like:**

```
1. Drug selection (required, always visible)
   ↓
2. Dose + units (required, appears after drug selection)
   → If drug is pediatric-indicated: show weight-based dosing calculator
   → If drug requires renal adjustment: show kidney function flag
   ↓
3. Route (required, filtered to valid routes for selected drug)
   → If Route = "IV": reveal Infusion Rate, Diluent, Concentration fields
   → If Route = "topical": reveal Application Site, Coverage Area
   → If Route = "oral": hide all IV fields
   ↓
4. Frequency (required)
   → If Frequency = "PRN": reveal PRN Indication field ("give only for...")
   → If Frequency = "custom": reveal Days/Times selector
   ↓
5. Duration (contextual — show for outpatient, optional for inpatient continuous)
   → If Duration = "as needed": reveal Stop Criteria
   ↓
6. [Advanced section — collapsed by default]
   → Specific patient instructions
   → Prescriber-to-pharmacist notes
   → Priority / STAT flag
   → Brand substitution preference
```

**Examples of this pattern in healthcare applications:**

- The [Czech pilot mHealth study on UX for older adults (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC11200957/) found that replacing an open text field for medication selection with a multi-select list plus an "other — please specify" option significantly improved usability for the medication ordering task
- The [Hannah Dym UX prototype at Brigham and Women's / Partners HealthCare](https://www.hannahux.com/mobile-app-iot-device-prototype) organized the prescribing interface around the **patient's medical problem (indication)** rather than the drug name as the primary navigation axis — a progressive disclosure pattern that starts with "why" before "what", and was found to statistically reduce clicks and errors
- Athenahealth's pre-prescribing contraindication summary shows indicator counts (not full lists) until the prescriber clicks — a collapsed/expanded disclosure pattern

### 2.3 Cognitive Load Reduction in Medical Ordering

The [Betsy Lehman Center for Patient Safety](https://betsylehmancenterma.gov/best-practices/improving-safety-in-emergency-care/cognitive-overload) documents that medication prescribing is one of the "critical times" where interruption must be minimized and cognitive load carefully managed. Recommendations include dedicated interruption-free zones, cognitive job aids (like pre-filled order sets), and well-designed CDS tools that do not interrupt for low-priority alerts.

The AMA study on EHR usability found that physicians in emergency departments dedicate **43% of their time to data input** vs. only 28% to direct patient care ([Journal of Emergency Medicine, 2013 — documented in ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0735675713004051)), accumulating nearly **4,000 mouse clicks during a busy 10-hour shift**. Reducing cognitive load through progressive disclosure directly reduces this burden.

At a large academic medical center, hospitalists spent **47 minutes of every shift (20.2% of their EHR time) placing orders** — a target for systematic optimization ([AMIA 2024](https://pmc.ncbi.nlm.nih.gov/articles/PMC10785931/)).

---

## 3. Speed Optimization

### 3.1 Click Count Optimization Studies

**The "62 clicks" benchmark**: The AMA-commissioned study published in [JAMIA (2018)](https://www.ama-assn.org/practice-management/digital-health/62-clicks-order-tylenol-what-happens-when-ehr-tweaks-go-bad) measured EHR tasks at four hospitals using Cerner and Epic. It found:
- **9x difference in task completion time** for common tasks across implementations of the same vendor
- **8x difference in click count** for the same tasks
- Up to **62 clicks to order Tylenol** at the highest-friction site
- **Error rates up to 50%** for prednisone taper orders — meaning that click-heavy workflows don't just slow users down, they cause dangerous mistakes

The study explicitly attributed these differences to local configuration decisions, not vendor platform limitations, demonstrating that interface design choices are the primary driver of efficiency.

**Order Friction (FPO) benchmarks from Epic log data** ([AMIA 2024](https://pmc.ncbi.nlm.nih.gov/articles/PMC10785931/)):
- **Target for medication orders from order sets**: FPO ≤ 1 (approximately 1 field change before signing)
- **Target for medication orders from preference lists**: FPO ≤ 5
- **Actual median for preference list medication orders**: FPO = 2.11
- **Intervention result**: Changing blank default frequency fields to "Once" for 22 lab order types reduced average CPO from 1.82 to 0.15 — a **92% reduction in order changes** per order

**Interpretation for CompoundIQ**: Every blank required field that forces a prescriber to make a selection is one "click" of friction. Setting evidence-based smart defaults for the most common compound configurations can reduce the interaction cost of routine orders by an order of magnitude.

**"10 clicks per order" as historical benchmark**: An early CPOE reference from a hospital implementation that required an average of 10 mouse clicks per order, or 1–2 minutes per order, was cited as a baseline. For sub-30-second workflows, this must be reduced by at least 60–80%.

### 3.2 Keyboard-First Navigation Patterns

Experienced clinical users strongly prefer keyboard navigation for speed. Key patterns:

- **Tab-advance through fields**: Enterprise Health's prescribing documentation ([Enterprise Health docs](https://docs.enterprisehealth.com/features/medication-management-and-e-prescribing/prescribing-adding-medications/)) describes using the Tab key to advance from medication name to form, sig, duration, and quantity — cursor advances automatically, eliminating mouse movement between fields
- **Auto-trigger on selection**: When the medication is selected from autocomplete, the form should immediately focus the first empty required field (dose) without any additional click
- **Smart phrases / text expansion**: Epic's SmartText, Dragon Medical One commands, and similar systems allow typing abbreviations that expand to full medication orders (e.g., ".metop25" → "Metoprolol 25mg PO BID")
- **Keyboard shortcuts for common actions**: Ctrl+K for universal search (used in Healthie), Ctrl+O to open order field in Epic. In complex medication ordering, shortcuts to "Accept default and advance", "Mark STAT", and "Add to favorites" should all be keyboard-accessible
- **Tab navigation optimization**: Fields that are contextually hidden (not relevant given prior selections) should be skipped entirely in the Tab order — a user should never have to Tab through a field they cannot interact with

### 3.3 "Happy Path" Optimization

The happy path is the most common ordering sequence — the 80% case that must be fastest.

**Evidence-based approach to identifying the happy path:**
1. Analyze order log data: What are the 20 drugs accounting for 80% of orders for a given prescriber type or specialty?
2. For each high-volume drug, what is the most common dose/route/frequency combination?
3. Set those combinations as the pre-populated defaults in preference list order sentences
4. Measure FPO after change to validate default accuracy

**Illustrative example from compounding practice** ([SAT133 Diabetes Discharge Order Set case study, Journal of the Endocrine Society PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC10554761/)): A teaching hospital found that 55% of insulin-prescribed discharge patients were missing insulin supplies. They redesigned the order set from 20 fragmented items to 2 top-level choices ("Patient uses insulin pen" vs. "Patient uses vial and syringe"). Selecting "insulin pen" automatically pre-selected the pen, pen needle, glucometer, testing strips, lancets, and alcohol swabs — collapsing a multi-step process into a single binary selection plus review. This is the pure "happy path" pattern: one meaningful choice produces a complete, validated order.

**For CompoundIQ, happy path means:**
- Compound Drug selected → system auto-populates the most common base, vehicle, strength, and quantity for that compound type
- Prescriber sees pre-filled form, reviews, may modify specific fields, and signs
- Average order time for routine compounds should approach **15–20 seconds** (similar to an Epic order set order)
- Custom/novel compounds should still be achievable in **< 90 seconds** with full field revelation

### 3.4 Time-to-Complete Benchmarks

| Workflow Type | Benchmark Time | Source |
|---|---|---|
| Pen/paper prescription | ~15–30 sec (gold standard for speed) | [Gregory Schmidt analysis](http://www.gregoryschmidt.ca/writing/order-entry-ux-general-requirements-meds) |
| Epic order set order (well-optimized) | ~30–60 sec with review | AMIA FPO benchmark data |
| Epic preference list order (average) | ~60–120 sec | FPO = 2.11, ~2 field changes |
| Epic standalone search + configure | ~2–5 min | Up to 62 clicks in worst case |
| CPOE order-to-pharmacy verification (pre-CPOE) | 115 min | [Am J Health Syst Pharm 2009](https://pubmed.ncbi.nlm.nih.gov/19635778/) |
| CPOE order-to-pharmacy verification (post-CPOE) | 3 min | Same study — 97% reduction |
| Medication documentation (CPOE vs. paper, simulation) | 14:40 vs 12:12 min for 6–11 drugs | [Methods Inf Med 2023](https://pubmed.ncbi.nlm.nih.gov/37019150/) — 20% longer with CPOE but 100% quality score vs 66.7% |

**Key takeaway**: CPOE adds time at the point of documentation but compresses total cycle time dramatically (order → pharmacy → administration). The documentation time can be compressed back toward pen-and-paper speeds through smart defaults and order sets without sacrificing completeness or safety.

---

## 4. Auto-Complete, Smart Defaults, and Favorites

### 4.1 Type-Ahead Search for Medications

Type-ahead (autocomplete) search is the universal standard for medication name entry across all EHRs. Best practices:

- **Frequency-ranked results**: The Enterprise Health prescribing module explicitly notes that [autocomplete results are ranked by frequency of use, not alphabetically](https://docs.enterprisehealth.com/features/medication-management-and-e-prescribing/prescribing-adding-medications/), so the most-commonly ordered drugs for a given partial string appear first
- **Two-stage result display**: Show drug name first (compressed list with more unique results), then reveal order sentences or variants after drug selection — Schmidt's recommended approach to prevent overwhelming users
- **Fuzzy/phonetic matching**: Critical for handling misspellings, since [17.4% of free-text medication entries contain misspellings](https://pmc.ncbi.nlm.nih.gov/articles/PMC3540584/) including common drugs like "Glimepiride," "Glipizide," and "Humalog"
- **FHIR ValueSet/$expand** for standardized terminology: The [Stack Overflow EHR medication autocomplete solution](https://stackoverflow.com/questions/42491150/how-do-i-add-medication-names-autocompletion-functionality-to-my-ehr-using-medl) references FHIR's ValueSet/$expand operation, already deployed in production for real-time autocomplete against a live drug database as the user types
- **Brand/generic equivalence**: Systems should match both brand names and generics as equivalent, since prescribers may know either
- **First DataBank (FDB) integration**: FDB's MedKnowledge database is the industry standard drug library ([FDB CPOE page](https://www.fdbhealth.com/applications/computerized-provider-order-entry-cpoe)), used by Enterprise Health, athenahealth, and other systems. It provides not just drug names but contextual dose/frequency recommendations based on patient demographics

### 4.2 Pre-Populating Dose, Frequency, and Quantity

When a medication is selected, the system should immediately propose appropriate defaults for downstream fields:

- **Context-aware defaults**: FDB's patient-centric medication ordering uses **patient context** (weight, age, renal function, indication) to generate smart medication order strings. For a pediatric patient, the suggested dose differs from an adult default without any prescriber calculation required ([FDB CPOE description](https://www.fdbhealth.com/applications/computerized-provider-order-entry-cpoe))
- **Duration → Quantity auto-calculation**: Enterprise Health automatically calculates total quantity from duration + sig fields ([Enterprise Health docs](https://docs.enterprisehealth.com/features/medication-management-and-e-prescribing/prescribing-adding-medications/)), eliminating manual math and a frequent source of dispensing errors
- **Indication-driven defaults**: The [Brigham/JAMA prototype study](https://digitalcommons.wustl.edu/cgi/viewcontent.cgi?article=9923&context=open_access_pubs) showed that organizing prescribing around indication (the medical problem) rather than drug name — with the system suggesting drug regimens from problem context — reduced error rates from 29.7% (vendor systems) to 5.5%, a **5x improvement**, while also being faster and preferred by clinicians
- **Renal/hepatic dose adjustment flags**: FDB provides built-in adjustments that surface contextually only when patient labs indicate the need

### 4.3 Favorites / QuickList Patterns

"Favorites" are personally curated lists of frequently used medication configurations. They represent the ultimate "happy path" for experienced prescribers.

**Epic Preference Lists and User Panels**: Clinicians can save any combination of orders as a named panel for one-click retrieval. [Epic efficiency documentation from the University of Iowa](https://epicsupport.sites.uiowa.edu/epic-resources/efficiencies-orders) describes creating preference lists, adding SmartSets to favorites, and building user order panels from any set of orders in the manage orders view.

**"Remembered Prescriptions" (Enterprise Health)**: The [Remembered Prescriptions feature](https://docs.enterprisehealth.com/features/medication-management-and-e-prescribing/remembered-prescriptions-and-meds-library/) allows prescribers to type a custom name (e.g., "BOB" or "Heart Disease") to save a complete prescription configuration. On future encounters, typing the drug name surfaces both "new" and named remembered versions in the autocomplete. Selecting the remembered version populates all fields instantly. This is the "favorites" pattern made maximally efficient.

**Cerner Favorites**: PowerChart's Quick Orders provide a favorites panel. The [Cerner ordering intro video](https://www.youtube.com/watch?v=mjX9gFKpk18) shows a dedicated "favorites" tab adjacent to the order search window, providing immediate access to saved configurations.

**What makes a good favorites implementation:**
- Favorites should appear in autocomplete results alongside standard drug matches, visually distinguished
- Favorites should be editable: selecting a favorite should load its settings but allow modification before signing
- Favorite usage should be tracked: items used frequently auto-surface, items unused for months should quietly de-prioritize or offer to archive
- Favorites should be shareable or templatable: a senior pharmacist or physician should be able to create a "clinic favorites" set that new prescribers inherit

### 4.4 Order Sets — Pre-Built Bundles

Order sets represent the highest level of automation in medication ordering. Rather than composing one prescription at a time, a prescriber selects a clinical scenario and reviews/approves a pre-configured bundle.

**Published data on order set impact:**

- CPOE with pre-printed order sets reduced chemotherapy problem-order rates from **30.6% (handwritten) to 12.6% (preprinted) to 2.2% (CPOE with order sets)** — a 14x error rate improvement ([PubMed 2013](https://pubmed.ncbi.nlm.nih.gov/24003174/))
- AHRQ recommendation: Order sets should "minimize the amount of order details a user must complete, utilize default values where appropriate, and standardize placement of similar elements" ([CapMinds CPOE design guide](https://www.capminds.com/blog/how-to-design-cpoe-for-maximizing-physician-adoption-what-works/))
- NIH StatPearls notes that order sets require investment to build but pay off in adoption, with specialty-specific sets generating highest use rates ([NCBI Bookshelf CPOE article](https://www.ncbi.nlm.nih.gov/books/NBK470273/))
- A systemic review of 36 studies on Epic SmartSets and Cerner PowerPlans found the majority (30/36) reported favorable outcomes for clinical efficiency and safety ([JMIR Formative Research 2024](https://formative.jmir.org/2024/1/e54022))

**For CompoundIQ**, equivalent structures might include:
- "Pain Management Compound Set" (common topical NSAID compounds)
- "Hormone Therapy Set" (standard HRT compound combinations)
- "Pediatric Compound Set" (common flavored oral compounds for children)
- "Wound Care Compound Set" (common topical antibiotics + antifungals)

Each set would pre-select compounds, strengths, vehicles, BUD ranges, and packaging — requiring only patient-specific confirmation before ordering.

---

## 5. Structured Data vs. Free Text

### 5.1 The Core Tension

Structured data fields (dropdowns, radio buttons, numeric inputs with units) enable clinical decision support, drug interaction checking, dose validation, automated dispensing, and analytics. Free text is faster to enter for experienced users but bypasses all safety checks.

The tension is real: when the structured interface is poorly designed, prescribers work around it with free text — but free text creates safety gaps that may not be visible until a patient event occurs.

### 5.2 Error Rates: Structured vs. Free Text

**Research data on free-text medication order rates and errors:**

- **9.3% of hypoglycemic medications** were entered as free-text in a large ambulatory EHR, despite 75% of those entries having exact matches in the structured drug dictionary ([AMIA 2012, Zhou et al.](https://pmc.ncbi.nlm.nih.gov/articles/PMC3540584/))
- **17.4% of free-text entries contained misspellings** (up to 22.8% for nurses, 13.5% for physicians)
- Free-text entries were **missing dose data 45% of the time**, frequency 43%, and duration 79%
- **92 drug-drug interaction alerts were not triggered** for 84 patients due to free-text entries bypassing the CDS engine
- **196 patients had duplicate medications** (identical drug entered as both free-text and coded) — with potential for dangerous dose stacking

**Free-text CPOE orders as workarounds** ([Applied Clinical Informatics 2021](https://pmc.ncbi.nlm.nih.gov/articles/PMC8172259/)):
- Clinicians described **8 reasons for using free-text orders**: poor usability of structured entry, limited functionality (can't express "hold for dialysis" in structured fields), complex navigation, structured order systems being too slow to update or modify, lack of visible confirmation that orders were seen, need to communicate urgency, insufficient context in structured fields, and alert fatigue from CDS in structured workflows
- **5 risks they identified**: missed orders, increased nursing workload, outdated orders cluttering the chart, conflicting information between free-text and structured fields, and bypassed safety checks
- **Clinicians' unanimous recommendation**: Improve structured order entry to eliminate the need for workarounds, rather than trying to eliminate free text by policy

### 5.3 When to Force Structured Selection vs. Allow Free Text Override

| Scenario | Recommended Approach | Rationale |
|---|---|---|
| Drug name | Structured (autocomplete) | Enables DDI checking, allergy alerts, dose range validation |
| Dose + units | Structured with numeric input + unit dropdown | Enables dose range checking; free text bypasses CDS |
| Route | Structured (dropdown filtered by drug) | Wrong route errors are serious; limits to valid options |
| Frequency | Structured (validated list) | Enables scheduling logic, missed-dose tracking |
| Duration | Structured with free-text fallback | Commonly missing in free text; structured enables auto-refill, stop dates |
| Patient instructions / sig details | Hybrid: structured options + "custom" free text | Broad variation; structured covers 90%, free text covers edge cases |
| Special dispensing notes to pharmacist | Free text in dedicated field | Communication intent; cannot be fully structured |
| Prescriber clinical rationale | Optional free text | Context and audit, not operational; should not be required |

### 5.4 Hybrid Patterns — Structured Fields with Custom Override

The best-practice design is a **layered input model**:

1. Offer the most common structured options first (e.g., dose radio buttons: "250mg / 500mg / 1000mg / Custom")
2. If user selects "Custom," reveal a free-text/numeric entry field with inline validation
3. Validate free-text input on blur: does the entry match a valid dose range? Flag if not, but don't hard-block
4. Track which selections require "Custom" most often — use frequency data to add those values to the structured list

This is the pattern used by Enterprise Health's prescribing module: free-text entry is allowed but clearly labeled as "uncoded," with an explicit warning that "drug/allergy interaction warnings cannot work since it is an unrecognized medication."

### 5.5 Handling Edge Cases That Don't Fit Dropdown Options

**Practical strategies:**

1. **"Other — please specify" option**: Always include this at the bottom of any dropdown for valid but uncommon options. Flag these orders for pharmacist review.
2. **"Suggest this option"**: When a prescriber types a value that doesn't match any structured option, offer to submit it to the formulary team for consideration.
3. **Fuzzy match before free text**: Before accepting free text, run a fuzzy match against the structured list and prompt "Did you mean [X]?" to catch near-misses
4. **Free-text surveillance**: Track free-text usage patterns. If 20% of orders for a specific compound include a free-text note saying "do not use preservatives," that note should become a structured toggle field
5. **Inline validation messages** ([Applied Clinical Informatics 2016](https://pmc.ncbi.nlm.nih.gov/articles/PMC4941862/)): Adding inline validation for missing fields (e.g., "Provider information required" before allowing order submission) reduced error rates from 20.27% to 12.96% in one outpatient CPOE study — a **36% error reduction** simply from prompting for completeness
6. **Hard stops for safety-critical fields**: For high-risk parameters (e.g., concentration of a controlled substance compound), use hard stops that require resolution before submission. For administrative fields, use soft stops (warning, but allow override with documented reason).

---

## 6. Case Studies

### 6.1 Brigham and Women's Hospital — CPOE Pioneering Case

**Brigham and Women's Hospital (BWH)** deployed one of the first CPOE systems in the U.S. in 1993 and has published extensively on its outcomes.

**Published results** ([PubMed, Bates et al. 1999](https://pubmed.ncbi.nlm.nih.gov/10428004/)):
- Non-missed-dose medication errors fell **81%** — from 142 per 1,000 patient-days to 26.6 per 1,000 patient-days
- Non-intercepted serious medication errors (those with potential for patient injury) fell **86%**
- Improvements were seen across all error categories: dose errors, frequency errors, route errors, substitution errors, and allergy errors

**CPOE at BWH included** ([PubMed, Bates et al. 2001](https://pubmed.ncbi.nlm.nih.gov/11593885/)): required fields, pick lists (structured dropdowns), order sets, standard scales (e.g., insulin sliding scale), drug-drug and drug-allergy interaction alerts, and adjunct features (pharmacy system integration, online reference access). Physicians entered **85% of orders** electronically.

**Key UX lesson**: The combination of structural features (required fields + pick lists) with enhanced workflow features (order sets + scales) and automated safety checks produced outcomes no single feature could achieve alone.

### 6.2 Indications-Based Prescribing Prototype — JAMA Study

The [Brigham/JAMA indications-based CPOE prototype study](https://digitalcommons.wustl.edu/cgi/viewcontent.cgi?article=9923&context=open_access_pubs) compared a newly designed prescribing interface against two leading commercial EHR vendors in a usability study with 32 physicians, residents, and physician assistants across 8 clinical scenarios.

**Results:**
- **Error rate**: 5.5% (prototype) vs. 29.7% (vendor system) — a **5.4x error reduction**
- Efficiency and satisfaction both significantly outperformed vendor systems (p < 0.001)
- With only **2 minutes of training** on the prototype, all clinicians quickly adopted the new workflow and overwhelmingly preferred it
- Orders included indication **100% of the time** in the prototype vs. rarely in vendor systems
- The prototype automatically filtered drug suggestions based on patient-specific allergies and contraindications

**Key design innovation**: The interface was organized around the **clinical indication** (why you're prescribing) rather than the drug name (what you're prescribing). Selecting an indication from the problem list surfaced a ranked list of drugs of choice with evidence-based defaults, pre-filtered for the patient's contraindications. This is progressive disclosure from clinical context to drug configuration.

### 6.3 Chemotherapy Order Set Study

[PubMed study (2013)](https://pubmed.ncbi.nlm.nih.gov/24003174/) comparing three sequential methods for oncology ordering:

| Method | Problem Order Rate | Harm-Capable Error Rate |
|---|---|---|
| Handwritten | 30.6% | 4.2% |
| Preprinted order sets | 12.6% | 1.5% |
| CPOE with embedded order sets | 2.2% | 0.1% |

Order sets reduced problem orders by **14x** compared to handwritten. CPOE did not eliminate all errors and introduced new error types (novel to electronic systems), requiring continued vigilance.

### 6.4 CPOE Optimization with Order Friction Data — Columbia University

[AMIA 2024 study](https://pmc.ncbi.nlm.nih.gov/articles/PMC10785931/) at a large academic medical center using Epic's Order Friction data:

**Intervention**: Changed default frequency from blank to "Once" for 22 high-volume lab orders (urine, stool, nasal swabs — 15,104 orders/month)

**Result**: Average changes per order reduced from **1.82 to 0.15** — a **92% reduction in ordering friction** (all 22 orders significant at p<0.01)

**Lesson**: A single configuration change (setting a smart default) eliminated ~25,000 manual field entries per month across the health system. The friction data methodology provides a replicable approach to identifying and fixing high-impact defaults.

### 6.5 CPOE Errors from Free Text — FDA Study

The [FDA's CPOE Medication Safety (CPOEMS) study](https://www.fda.gov/files/drugs/published/Computerized-Prescriber-Order-Entry-Medication-Safety.pdf) analyzed CPOE safety across multiple sites and found:

- **Substantial variability** in CPOE displays, functionality, and workflow — between sites, within sites, and even between two different drugs in the same system
- **Drug search problems**: Difficulty finding medications, wrong item selection from similar-looking results, excessive results including non-medications
- **Autocomplete risks**: Despite convenience, autocomplete introduces vulnerability including selecting the wrong drug and overlooking the correct drug
- **Display problems**: Items not visible in dropdown lists without scrolling; inconsistent numerical ordering of doses; brand/generic inconsistency
- **Adjacency errors**: Similar-sounding drugs listed next to each other in ordered lists is a source of wrong-drug errors

### 6.6 Insulin Discharge Order Set UX Redesign

[Case study published in the Journal of the Endocrine Society (PMC 2023)](https://pmc.ncbi.nlm.nih.gov/articles/PMC10554761/) using Figma prototyping:

**Problem**: 55% of insulin-prescribed discharge patients were missing correct insulin supplies. Prior order set presented 20 separate items for insulin pens, syringes, glucometers, testing strips, lancets, and alcohol pads as a flat list requiring individual selection.

**Redesign**: Collapsed to 2 choices: "Patient uses insulin pen" or "Patient uses vial and syringe." Each selection automatically pre-populated all associated supplies, default quantities, and referral orders.

**Method**: Multi-stakeholder collaborative prototyping in Figma with residents, diabetes educators, attendings, pharmacists, and endocrinologists.

**Key lesson**: The redesign applied progressive disclosure at the macro level (one decision → complete bundle) and at the micro level (supplies automatically populated based on device choice). The result was both faster for prescribers and more complete for patients.

### 6.7 Mayo Clinic — Barcode Medication Administration

While not a prescribing UX case study, [Mayo Clinic's BCMA implementation](https://www.linkedin.com/posts/ericshumake_healthcare-ux-case-study-at-mayo-clinic-activity-7371543045403627520-sGkI) demonstrates the magnitude of UX-driven safety improvements: adopting barcode medication administration cut reported medication administration errors by **43.5%** with harm events dropping **55.4%**. The mechanism was workflow redesign (nurses must scan both patient wristband and medication), not algorithm change.

### 6.8 Mobile-Responsive Medication Ordering

Mobile EHR adoption has grown substantially: [Empeek research](https://empeek.com/insights/mobile-ehr/) reports that 78% of physicians now use a certified EHR, and mobile-first EHR development is a growing priority. Key mobile-specific findings:

- **64% of nurses** report improved care coordination with mobile healthcare apps
- Barcode scanning on mobile devices can **decrease medication error risk by up to 74.2%** (NDC drug label scanning in e-prescribing workflows)
- Mobile order entry requires progressive disclosure even more than desktop, as screen real estate is dramatically reduced
- Voice dictation is the most efficient input modality for mobile (free-form notes or structured field navigation by voice command)
- [Thinkitive's mobile-first EMR design guide](https://www.thinkitive.com/blog/emr-application-development-building-mobile-first-solutions-for-modern-healthcare/) identifies key principles: minimize taps, reduce cognitive load, avoid screen clutter, use AI predictive UI to suggest relevant data

**Mobile-specific progressive disclosure patterns:**
- Accordion sections: expand only the section being actively edited
- Bottom sheets: slide up a configuration panel over the main order summary
- Steppers/wizards: one main decision per screen with clear progress indication
- Contextual keyboard types: numeric keypad for dose, unit selector for route

---

## 7. Synthesis: Implications for CompoundIQ

### 7.1 Recommended UX Architecture for Medication Ordering

Based on this research, the optimal UX architecture for CompoundIQ's prescription ordering flow should follow a **three-tier progressive disclosure model**:

**Tier 1: Quick Order (< 20 seconds)**
- Favorites / recent orders surfaced immediately
- Full compound configuration pre-filled; prescriber reviews summary card
- "Approve & Sign" completes the order
- Designed for the 80% of recurring orders that match an established pattern

**Tier 2: Guided Order (30–90 seconds)**
- Autocomplete search for compound or active ingredient
- Upon selection, drug-specific defaults populate dose/strength/vehicle/route/frequency
- Fields with smart defaults are shown but pre-filled — user only changes deviations
- Conditional fields appear based on selections (e.g., IV delivery triggers diluent/rate fields)
- Advanced options collapsed by default but clearly accessible ("Advanced Options ▼")

**Tier 3: Custom Order (1–3 minutes)**
- Full field-by-field configuration
- Structured fields for all safety-critical parameters with clear validation
- Free-text fields for pharmacist notes and special instructions in dedicated, clearly labeled areas
- Inline validation prevents submission with safety-critical fields blank

### 7.2 High-Priority Design Principles

| Principle | Implementation |
|---|---|
| **Default to the most common answer** | Analyze order history to set smart defaults; every blank field is friction |
| **Show only what's needed now** | Conditional field display based on prior selections; hide irrelevant fields |
| **Make common things fastest** | Favorites library at the top level; order sets for common compound types |
| **Validate inline, not at submission** | Show errors as fields are completed, not after the full form is filled |
| **Never lose user input** | If a field is hidden by a prior selection change, preserve but collapse its data |
| **Track what gets changed** | Use order friction data to identify defaults that consistently get overridden |
| **Keyboard-first** | Full ordering possible without mouse; Tab advances through all visible fields |
| **Structured first, free text as escape valve** | Structured fields with "Custom" option; free text flagged for pharmacist review |
| **Match mobile patterns** | Accordion sections, single-action screens, bottom sheets for complex inputs |

### 7.3 Specific Feature Recommendations

1. **"Favorites / QuickList"**: Allow prescribers to save named compound configurations from any completed order. Surface in autocomplete. Most important for specialty prescribers who order the same compounds repeatedly.

2. **Compound Type Order Sets**: Pre-build full configurations for common compound categories (pain, HRT, pediatric, wound care). Allow pharmacist administrators to maintain these sets; allow prescribers to customize personal versions.

3. **Indication-First Search Option**: Offer the ability to search by condition/indication ("pain management," "hormone replacement") to surface recommended compound options, reducing the cognitive demand of recalling specific formulations.

4. **Auto-Calculate Quantity from Sig × Duration**: Automatically compute total compound quantity (e.g., grams of topical cream) from application instructions × days supply, eliminating a common source of dispensing error.

5. **BUD/Stability Contextual Display**: When a compound configuration is selected, surface the expected Beyond-Use Date range as an inline advisory (not an alert), so prescribers can inform patients of storage requirements during the ordering step.

6. **Smart Defaults Tuning Dashboard**: Build a pharmacist-facing dashboard showing which defaults get overridden most often and by how much — the same approach as Epic's Order Friction data — to support continuous improvement of pre-filled values.

7. **Inline Drug-Compound Interaction Checking**: Surface ingredient-level interaction warnings (e.g., "selected vehicle inactivates Drug A") as contextual inline text, not as interruptive modal alerts, to reduce alert fatigue.

8. **Mobile-First Tier 1 Experience**: The favorites/quick-order tier should be fully functional on tablet. For clinic-based compound prescribers using tablets, the experience should be optimized for touch, with bottom-sheet configuration panels and large tap targets for approval.

---

## Sources

- [Epic open.epic Interface Documentation](https://open.epic.com/Interface/Other) — Epic e-prescribing interface specifications
- [Gregory Schmidt — Order Entry UX General Requirements](http://www.gregoryschmidt.ca/writing/order-entry-ux-general-requirements-meds) — EHR order entry UX analysis
- [Gregory Schmidt — Order Entry UX Examples and Order Sentences](https://www.gregoryschmidt.com/articles/order-entry-ux-eg-order-entry-and-order-sentences) — Order sentence UX critique
- [AMA — 62 Clicks to Order Tylenol](https://www.ama-assn.org/practice-management/digital-health/62-clicks-order-tylenol-what-happens-when-ehr-tweaks-go-bad) — Multi-center EHR usability and safety study
- [AMIA 2024 — Pre-Post Evaluation of Order Friction Data](https://pmc.ncbi.nlm.nih.gov/articles/PMC10785931/) — Epic FPO benchmarks and default optimization
- [ScienceDirect 2013 — 4000 Clicks Emergency Medicine](https://www.sciencedirect.com/science/article/abs/pii/S0735675713004051) — Physician EHR time-motion study
- [NCBI StatPearls — CPOE Overview](https://www.ncbi.nlm.nih.gov/books/NBK470273/) — CPOE clinical features and workflow patterns
- [FDA CPOEMS Study](https://www.fda.gov/files/drugs/published/Computerized-Prescriber-Order-Entry-Medication-Safety.pdf) — CPOE safety findings and issues
- [CapMinds — CPOE Design for Physician Adoption](https://www.capminds.com/blog/how-to-design-cpoe-for-maximizing-physician-adoption-what-works/) — CPOE UX recommendations
- [Cerner PowerChart Ordering Intro (YouTube)](https://www.youtube.com/watch?v=mjX9gFKpk18) — Cerner ordering UI walkthrough
- [CST Cerner Help — Medication Order Icons](https://cstcernerhelp.healthcarebc.ca/Patient_Chart/Orders/Meds/Medication_Order_Buttons_and_Icons.htm) — Cerner order entry UI elements
- [Athenahealth — athenaOne Efficiency Blog](https://www.athenahealth.com/resources/blog/athenaone-efficient-practice-management-workflows) — Athenahealth workflow design principles
- [Athenahealth — athenaPractice Roadmap PDF](https://akamai-opus-nc-public.digitellcdn.com/uploads/nachc/redactor/35871f58de2d9aeddde0ee0f65aea94f3b099750f6e042e7711bf056ddf97fdd.pdf) — Athenahealth prescribing UI
- [Interaction Design Foundation — Progressive Disclosure](https://ixdf.org/literature/topics/progressive-disclosure) — Definition and UX patterns
- [UX/UI Principles — Progressive Disclosure Research](https://uxuiprinciples.com/en/principles/progressive-disclosure) — Quantified impact data
- [UX Collective — Progressive Disclosure](https://uxdesign.cc/progressive-disclosure-91ea681eab70) — Design pattern overview
- [Gapsy Studio — Progressive Disclosure UX](https://gapsystudio.com/blog/progressive-disclosure-ux/) — Healthcare form design examples
- [Betsy Lehman Center — Cognitive Overload Recommendations](https://betsylehmancenterma.gov/best-practices/improving-safety-in-emergency-care/cognitive-overload) — Clinical cognitive load reduction
- [AMIA 2012 — Free-Text Medication Orders](https://pmc.ncbi.nlm.nih.gov/articles/PMC3540584/) — Free-text rate and error data
- [Journal of Patient Safety 2024 — Free Text in EHR Orders](https://patientsafetyj.com/article/118587-free-text-as-part-of-electronic-health-record-orders-context-or-concern) — Free-text safety issues
- [PMC 2021 — Free-Text CPOE Orders as Workaround](https://pmc.ncbi.nlm.nih.gov/articles/PMC9366105/) — Medication names in free-text orders
- [Applied Clinical Informatics 2021 — Clinician Perceptions on Free-Text](https://pmc.ncbi.nlm.nih.gov/articles/PMC8172259/) — Why clinicians use free text
- [Applied Clinical Informatics 2016 — CPOE Optimization Reduces Errors](https://pmc.ncbi.nlm.nih.gov/articles/PMC4941862/) — Inline validation reduces error rate 36%
- [PubMed 1999 — Bates et al. BWH CPOE Impact](https://pubmed.ncbi.nlm.nih.gov/10428004/) — 81% error reduction
- [PubMed 2001 — BWH Patient Safety and CPOE](https://pubmed.ncbi.nlm.nih.gov/11593885/) — BWH CPOE features and outcomes
- [PubMed 2013 — Chemotherapy CPOE Order Set Study](https://pubmed.ncbi.nlm.nih.gov/24003174/) — 14x error reduction with order sets
- [PSNET/AHRQ 2013 — Meta-analysis CPOE Error Reduction](https://psnet.ahrq.gov/issue/reduction-medication-errors-hospitals-due-adoption-computerized-provider-order-entry-systems) — 48% prescribing error reduction, 17M errors prevented/year
- [Am J Health Syst Pharm 2009 — CPOE Pharmacy Processing Time](https://pubmed.ncbi.nlm.nih.gov/19635778/) — 97% reduction in order-to-verification time
- [Methods Inf Med 2023 — CPOE vs. Paper Time Study](https://pubmed.ncbi.nlm.nih.gov/37019150/) — 20% longer with CPOE, 100% documentation quality vs 66.7%
- [JAMA Indications-Based CPOE Prototype — WUSTL](https://digitalcommons.wustl.edu/cgi/viewcontent.cgi?article=9923&context=open_access_pubs) — 5x error reduction, faster and preferred by all clinicians
- [PMC 2023 — Diabetes Discharge Order Set UX Case Study](https://pmc.ncbi.nlm.nih.gov/articles/PMC10554761/) — Figma-designed order set redesign
- [JMIR Formative Research 2024 — PowerPlan/SmartSet Study](https://formative.jmir.org/2024/1/e54022) — Order set utilization patterns
- [FDB CPOE Description](https://www.fdbhealth.com/applications/computerized-provider-order-entry-cpoe) — Smart medication order strings, patient-centric defaults
- [Enterprise Health — Prescribing Medications Docs](https://docs.enterprisehealth.com/features/medication-management-and-e-prescribing/prescribing-adding-medications/) — Tab-key field advancement, remembered prescriptions
- [Enterprise Health — Remembered Prescriptions](https://docs.enterprisehealth.com/features/medication-management-and-e-prescribing/remembered-prescriptions-and-meds-library/) — Favorites library mechanics
- [University of Iowa Epic Efficiency for Orders](https://epicsupport.sites.uiowa.edu/epic-resources/efficiencies-orders) — Preference lists, SmartSets, user panels
- [Hannah Dym UX — CPOE Prototype at Brigham and Women's](https://www.hannahux.com/mobile-app-iot-device-prototype) — Indication-based ordering UX prototype
- [PMC 2024 — CPOE-CDS Pediatric Dose Errors](https://pmc.ncbi.nlm.nih.gov/articles/PMC10891203/) — CDS alert effectiveness and customization
- [PMC 2021 — Automated Compounding Workflow Software](https://pmc.ncbi.nlm.nih.gov/articles/PMC8596227/) — Compounding pharmacy workflow and software design
- [Empeek — Mobile EHR Software](https://empeek.com/insights/mobile-ehr/) — Mobile EHR adoption data and features
- [NPJ Digital Medicine 2025 — EHR Optimization](https://pmc.ncbi.nlm.nih.gov/articles/PMC12769529/) — ML for smart EHR self-correction
- [DoseSpot — Compound Medication Prescribing](https://clinician-help.sigmamd.com/article/355-how-to-order-compound-medications-via-erx) — E-prescribing compound workflow
- [PMC 2024 — Czech mHealth UX Study](https://pmc.ncbi.nlm.nih.gov/articles/PMC11200957/) — Progressive disclosure in patient-facing medication ordering
