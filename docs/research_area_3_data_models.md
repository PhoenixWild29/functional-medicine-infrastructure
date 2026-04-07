# Research Area 3: Medication Data Models for Compounding Pharmacies

**Date:** April 7, 2026  
**Scope:** How compounding pharmacy databases structure medication data — covering data representation, 503A vs 503B catalog structures, data standards, formulary design patterns, and multi-ingredient compound modeling.

---

## Table of Contents

1. [Compounded Medication Data Representation](#1-compounded-medication-data-representation)
2. [503A vs 503B Catalog Structure](#2-503a-vs-503b-catalog-structure)
3. [Data Standards for Compounded Medications](#3-data-standards-for-compounded-medications)
4. [Formulary Database Design Patterns](#4-formulary-database-design-patterns)
5. [Multi-Ingredient Compound Modeling](#5-multi-ingredient-compound-modeling)
6. [Summary: Key Design Implications](#6-summary-key-design-implications)

---

## 1. Compounded Medication Data Representation

### 1.1 Core Conceptual Structure

A compounded medication is fundamentally a *recipe* — a set of ingredients in specified amounts, combined via a prescribed process, producing a final preparation with a defined dosage form, strength, and route of administration. Unlike a commercial NDC product (which is a fixed, pre-approved item), a compounded medication is a *configurable* combination whose representation must capture:

| Dimension | Examples |
|-----------|----------|
| Active ingredient(s) | Testosterone Cypionate, Anastrozole, Semaglutide |
| Salt / ester form | Testosterone *cypionate* vs. testosterone *propionate*; prazosin *HCl* vs. prazosin base |
| Concentration / strength | 200 mg/mL, 0.5 mg/mL, 2.5%, 10 mg/g |
| Dosage form | Injectable solution, cream, gel, troche, capsule, sublingual drop, nasal spray, suppository, pellet |
| Route of administration | IM, SubQ, topical, oral, sublingual, intranasal, intravaginal, rectal |
| Total quantity | 10 mL vial, 30 g tube, 60 capsules |
| Beyond-use date | Date/time after which the preparation must not be used |
| Inactive ingredients / base | PLO gel, cottonseed oil, benzyl alcohol, anhydrous SuspendIt |

### 1.2 The Relationship Between Core Attributes

In compounding, these attributes form a dependency chain:

```
Active Ingredient (moiety)
  └─ Salt/Ester Form (affects molecular weight and potency factor)
       └─ Concentration (mg/mL, %, mg/g — unit depends on dosage form)
            └─ Dosage Form (solution, cream, troche, etc.)
                 └─ Route of Administration (IM requires injectable; topical requires non-oral form)
                      └─ Total Quantity (dispensed volume or weight)
                           └─ BUD (depends on sterility category, ingredients, storage)
```

**Salt form is a critical data point**, not merely cosmetic naming. PCCA's documentation on API calculations ([PCCA API Calculations guide](https://www.pccarx.com/Blog/how-to-determine-api-calculations-in-pharmacy-compounding)) shows that salt form determines the actual weight of chemical needed:

- 1 mg amlodipine (base) = 1.39 mg amlodipine *besylate* (MW factor 567/409)
- 1 mg prazosin (base) = 1.095 mg prazosin *HCl* (salt factor)
- 1 mg estradiol (base) = 1.033 mg estradiol *hemihydrate* (fixed conversion factor)

Accordingly, a well-designed database must store both the **active moiety** (therapeutic reference) and the **precise ingredient/salt form** (what is physically weighed). This mirrors the FDA's naming policy for salt-containing drugs ([FDA Salt Naming Guidance](https://www.fda.gov/files/drugs/published/Naming-of-Drug-Products-Containing-Salt-Drug-Substances.pdf)), which distinguishes between:

- `active_moiety` — the pharmacologically active molecule (e.g., "amlodipine")
- `precise_ingredient` — the specific form used (e.g., "amlodipine besylate")
- `strength_moiety` — amount expressed in terms of moiety (e.g., 1 mg amlodipine)
- `strength_salt` — equivalent salt strength (e.g., 1.39 mg besylate)
- `conversion_factor` — molecular weight ratio or lot-specific COA factor

### 1.3 Standard Entity-Relationship Model

No single universally adopted ER standard exists for compounding pharmacy databases, but the dominant patterns converge on a **Master Formulation Record (MFR)** as the central entity. The MFR is required by both USP \<795\> (nonsterile) and USP \<797\> (sterile) ([USP \<795\> MFR Requirements, University of Illinois](https://answers.illinois.edu/illinois.vetmedvth/130889)):

**Core entities and relationships:**

```
FORMULATION (Master Formulation Record)
  ├─ formula_id (PK)
  ├─ name
  ├─ strength_display (e.g., "200 mg/mL")
  ├─ dosage_form_id (FK → DOSAGE_FORM)
  ├─ route_id (FK → ROUTE)
  ├─ total_quantity
  ├─ total_quantity_unit
  ├─ bud_hours_room_temp
  ├─ bud_hours_refrigerated
  ├─ bud_hours_frozen
  ├─ bud_basis (USP default / stability study / bracketed)
  ├─ version
  ├─ created_at
  ├─ updated_at
  └─ [References: stability data, USP chapter, source formulation]

FORMULATION_INGREDIENT (junction table — one row per ingredient per formulation)
  ├─ formulation_ingredient_id (PK)
  ├─ formula_id (FK → FORMULATION)
  ├─ ingredient_id (FK → INGREDIENT)
  ├─ is_active (boolean)
  ├─ role (active / base / preservative / diluent / vehicle / excipient)
  ├─ strength_numerator_value
  ├─ strength_numerator_unit (mg, g, mL, %)
  ├─ strength_denominator_value
  ├─ strength_denominator_unit (mL, g, capsule)
  ├─ quantity_per_batch
  ├─ quantity_unit
  └─ sort_order

INGREDIENT (master table)
  ├─ ingredient_id (PK)
  ├─ name (e.g., "Testosterone Cypionate")
  ├─ moiety_name (e.g., "Testosterone")
  ├─ rxnorm_cui (RxCUI for the ingredient)
  ├─ rxnorm_pin_cui (RxCUI for precise ingredient / salt)
  ├─ unii (FDA Unique Ingredient Identifier)
  ├─ cas_number (Chemical Abstracts Service)
  ├─ salt_form (e.g., "cypionate", "hydrochloride", "besylate")
  ├─ molecular_weight
  ├─ conversion_factor (moiety → salt)
  ├─ is_controlled (boolean, DEA schedule)
  ├─ dea_schedule
  ├─ is_hazardous (NIOSH designation)
  ├─ usp_monograph_ref
  └─ ndc_source (for 503B reporting: source NDC of the API)

DOSAGE_FORM
  ├─ dosage_form_id (PK)
  ├─ name (e.g., "Injectable Solution")
  ├─ code (SNOMED CT / HL7 / FDA SPL code)
  ├─ is_sterile (boolean)
  ├─ calculation_method (weight-based / volume-based / % w/v / % w/w)
  ├─ default_unit
  └─ usp_chapter (795 or 797)

ROUTE_OF_ADMINISTRATION
  ├─ route_id (PK)
  ├─ name (e.g., "Intramuscular")
  ├─ code (SNOMED or FDA SPL route code)
  └─ abbreviation (IM, SubQ, PO, SL, IN, TOP, IVag, PR)
```

### 1.4 How Multi-Ingredient Compounds Are Handled

The **Testosterone Cypionate 200 mg/mL + Anastrozole 0.5 mg/mL** combination in a single vial is the canonical example of a multi-ingredient injectable compound. This is a well-documented clinical combination ([patent US10201549B2, Google Patents](https://patents.google.com/patent/US10201549B2/en); [University of Maryland testosterone cypionate review](https://archive.hshsl.umaryland.edu/bitstreams/7b15e8aa-6959-4d00-8dc0-d999aac86590/download)), and [Vios Compounding](https://www.vioscompounding.com/product/testosterone-cypionate-anastrozole-compounded/) offers it commercially.

In a database, this compound is modeled with **one FORMULATION row** and **multiple rows in FORMULATION_INGREDIENT**:

```
FORMULATION row:
  formula_id: F001
  name: "Testosterone Cypionate / Anastrozole Injectable"
  dosage_form: "Solution for Injection"
  route: "Intramuscular"
  total_quantity: 10 mL
  bud: per USP <797> or stability study

FORMULATION_INGREDIENT rows:
  [1] formula_id: F001, ingredient: "Testosterone Cypionate"
      is_active: true, role: "active"
      strength: 200 mg / 1 mL
      
  [2] formula_id: F001, ingredient: "Anastrozole"
      is_active: true, role: "active"  
      strength: 0.5 mg / 1 mL
      
  [3] formula_id: F001, ingredient: "Benzyl Alcohol"
      is_active: false, role: "preservative"
      strength: 9 mg / 1 mL (0.9%)
      
  [4] formula_id: F001, ingredient: "Cottonseed Oil"
      is_active: false, role: "vehicle"
      strength: qs to 1 mL
```

This **junction table pattern** is the standard approach confirmed across multiple implementations:
- [HL7 FHIR R6 Medication resource](https://build.fhir.org/medication.html) uses `ingredient[]` as a repeating BackboneElement
- [Medplum's formulary guide](https://www.medplum.com/docs/medications/formulary) uses `MedicationKnowledge.ingredient[]` with `isActive` and `strength` per ingredient
- [Back4app's compound pharmacy template](https://www.back4app.com/templates/compound-pharmacy-app) uses an `ingredients: Array<Pointer<IngredientInventory>>` in MedicationRecipe

---

## 2. 503A vs 503B Catalog Structure

### 2.1 Regulatory Distinction

The Drug Quality and Security Act (DQSA) of 2013 created two distinct categories of compounding pharmacies with fundamentally different operational and database models ([NCBI/National Academies, Regulatory Framework for Compounded Preparations](https://www.ncbi.nlm.nih.gov/books/NBK562888/)):

| Feature | 503A Pharmacy | 503B Outsourcing Facility |
|---------|--------------|--------------------------|
| Regulatory oversight | State Board of Pharmacy | FDA (federal) |
| Prescription requirement | Required (patient-specific) | Not required (may compound for "office use") |
| Batch size | Small/individual; limited anticipatory compounding | Large batch production |
| Distribution | Patient-specific; home use | Hospitals, clinics, surgical centers |
| Manufacturing standard | USP \<795\>, \<797\>, \<800\> | FDA cGMP |
| FDA registration | Not required | Required (voluntary) |
| Product reporting | Not required | Biannual to FDA (June and December) |
| NDC numbers | Not applicable / cannot assign | Can assign (encouraged); reported to NDC Directory |
| Beyond-use dating | Shorter (USP default or extended by study) | Longer (cGMP + stability testing = expiration dates) |
| BUD determination | Professional judgment + USP guidelines | Rigorous stability testing per cGMP |

Sources: [SCA Pharma](https://scapharma.com/503a-vs-503b-pharmacy-designations-their-significance/), [DrugPatentWatch](https://www.drugpatentwatch.com/blog/breaking-down-patent-barriers-a-guide-for-compounding-pharmacies/), [MediVera](https://mediverarx.com/503a-compounding-pharmacy-explained/), [TechTarget](https://www.techtarget.com/pharmalifesciences/feature/Understanding-the-differences-between-503A-503B-compounding-pharmacies)

### 2.2 503A Catalog Structure: Patient-Specific Formulations

A 503A pharmacy's "catalog" is not a catalog in the traditional sense — it is a **library of Master Formulation Records** that pharmacists can draw from to fulfill patient-specific prescriptions.

**Key characteristics of 503A data structure:**

1. **Formulation library** (MFR database): Each unique formulation has an MFR describing ingredients, quantities, processes, BUD, and quality controls. PCCA provides members with over 9,600 tested formulations ([PCCA Formulary](https://www.pccarx.com/AboutUs/Glossary/CompoundingFormulas)), and CompoundingToday's database contains over 3,600 formulas ([CompoundingToday](https://compoundingtoday.com/formulation/Formula.cfm)).

2. **No fixed SKUs**: Unlike 503B, a 503A product is not pre-manufactured. The "product" is the MFR + the resulting prescription-specific preparation. Each preparation gets a unique Compounding Record (CR) linked to the MFR.

3. **High customization**: Prescribers can specify any concentration, any base, any dosage form. The MFR must accommodate variable strengths (e.g., PCCA's "bracketed" FormulaPlus formulas cover a range of API concentrations with a single stability study).

4. **Prescription linkage**: The data model must link Formulation → Compounding Record → Prescription → Patient. Each CR records lot numbers and expiration dates of every ingredient used.

5. **No NDC codes**: 503A compounds are patient-specific and cannot be assigned NDC numbers. Identification uses prescription/RX numbers and internal compound lot numbers.

**503A catalog data model summary:**

```
503A Data Hierarchy:
MFR (template) 
  → Prescription (patient-specific order)
      → Compounding Record (actual batch preparation)
          → Label (RX number, ingredients, BUD, storage)
```

### 2.3 503B Catalog Structure: Pre-Made Batches / Fixed Products

503B outsourcing facilities produce standardized batch products that are more akin to commercial pharmaceutical products. Their catalog structure is fundamentally different.

**Key characteristics of 503B data structure:**

1. **Fixed product catalog with NDC-like identifiers**: 503B facilities are strongly encouraged (though not required) to assign NDC numbers to their compounded products ([FDA 503B Product Reporting guidance](https://www.fda.gov/media/162171/download), [FDA CDER Direct 503B Product Reporting](https://www.fda.gov/media/154503/download)). When assigned, an NDC has the standard 10-digit, 3-segment format (labeler-product-package).

2. **Biannual product reporting to FDA**: Every 503B must report all compounded products to FDA in June and December. Required fields per FDA include:
   - Active ingredient(s) and strength per unit
   - Source NDC of the active ingredient (bulk API or finished drug)
   - Dosage form
   - Route of administration
   - Package description
   - Number of individual units produced
   - NDC of the final product (if assigned)

3. **Marketing category**: 503B products in the NDC Directory carry the category "Outsourcing Facility Compounded Human Drug Product (Exempt from Approval Requirements)."

4. **Fixed SKU structure**: Once an NDC is assigned to a 503B product, the active ingredient, strength, dosage form, and route cannot change without a new NDC ([FDA CDER Direct tutorial](https://www.youtube.com/watch?v=KgSmMurRl50)).

5. **Multi-ingredient reporting per ingredient**: For a compound with multiple active ingredients, each ingredient is reported separately (each with its own source NDC). A product with two active ingredients appears with two ingredient entries.

6. **Expiration dates, not BUDs**: 503B uses true stability-tested expiration dates (like commercial drugs), not the conservative USP-default BUDs of 503A ([Olympia Pharmaceuticals](https://www.olympiapharmacy.com/blog/compounding-503a-vs-503b/), [Epicur Pharma BUD vs Expiration Date](https://epicurpharma.com/wp-content/uploads/2021/04/Beyond-Use-Date-vs.-Expiration-Date_2023.pdf)).

**503B catalog data model summary:**

```
503B Data Hierarchy:
Product Catalog Entry (NDC assigned)
  ├─ Product NDC (10-digit)
  ├─ Nonproprietary Name
  ├─ Active Ingredient(s) [one row per ingredient in FDA reporting]
  ├─ Dosage Form
  ├─ Route
  ├─ Package Size / Description
  ├─ Expiration Date (stability tested)
  └─ Lot Number
       → Batch Production Record (cGMP)
            → Distribution Record (shipped to healthcare facility X)
```

### 2.4 Database Design Implications

| Design Dimension | 503A | 503B |
|-----------------|------|------|
| Product identity | RX number + MFR reference | NDC code (optional but standard) |
| Catalog type | MFR library (templates) | Fixed SKU catalog |
| Prescription linkage | Mandatory (1:1 patient) | Optional (1:many facilities) |
| Batch tracking | Per-prescription CR | Batch lot numbers with full cGMP records |
| Strength variability | High (any strength per Rx) | Low (fixed per batch) |
| BUD/expiration | Calculated per BUD rules; shorter | Stability-tested; longer |
| Reporting | State board only | FDA biannual + NDC directory |
| Ingredient source tracking | Lot/expiry per CR | Source NDC required in FDA reporting |

---

## 3. Data Standards for Compounded Medications

### 3.1 NDC Codes and 503A Compounds

**503A pharmacies cannot assign NDC numbers.** The NDC system is designed for commercially manufactured drugs registered under FDA Sections 510/505. A 503A compound is patient-specific and exempt from FDA approval requirements; it receives no NDC ([NCBI regulatory framework](https://www.ncbi.nlm.nih.gov/books/NBK562888/)).

Instead, 503A pharmacies identify compounds using:
- **Internal prescription (RX) number** — unique per patient-prescription
- **Internal compound lot/batch number** — tied to the Compounding Record
- **MFR formula reference number** — links to the Master Formulation Record

In e-prescribing systems (e.g., Tebra EMR), compounded prescriptions are often transmitted by selecting a commercially available drug as a placeholder to trigger DEA controls, with the actual compound described in the Sig/Notes field ([Coastal Pharmacy prescribing guide](https://www.coastalpharmacyandwellness.com/prescriber-resources/how-to-write-an-rx)).

### 3.2 503B Outsourcing Facilities and NDC Numbers

**503B facilities can and should assign NDC numbers** to their compounded products, though it is not technically required. FDA has:
- Created a marketing category: "Outsourcing Facility Compounded Human Drug Product (Exempt from Approval Requirements)"
- Added a searchable "Compounded Products" tab to the NDC Directory
- Encouraged assignment of NDCs to all compounded products to ensure traceability ([FDA 503B NDC guidance](https://www.fda.gov/media/162171/download))

When assigned, 503B NDCs:
- Use the same 10-digit, 3-segment labeler-product-package format
- Do **not** constitute FDA drug approval
- Are listed in the NDC Directory with active ingredient(s), dosage form, route, package description, and reporting period
- Must remain stable: same active ingredient and strength must be maintained for the same NDC

### 3.3 RxNorm as the Standard for Ingredient Coding

**RxNorm**, maintained by the National Library of Medicine, is the de facto standard for medication coding in U.S. healthcare systems ([RxNorm Overview, NLM](https://www.nlm.nih.gov/research/umls/rxnorm/overview.html); [RxNorm Term Types, NLM](https://www.nlm.nih.gov/research/umls/rxnorm/docs/appendix5.html)). Its term type hierarchy is directly applicable to compounding database design:

| RxNorm TTY | Name | Description | Example |
|------------|------|-------------|---------|
| IN | Ingredient | Active moiety / USAN name | Testosterone |
| PIN | Precise Ingredient | Salt or isomer form | Testosterone Cypionate |
| MIN | Multiple Ingredients | Two or more ingredients in one preparation | Testosterone / Anastrozole |
| SCDC | Semantic Clinical Drug Component | Ingredient + Strength | Testosterone 200 MG/ML |
| SCDF | Semantic Clinical Drug Form | Ingredient + Dose Form | Testosterone Injectable Solution |
| SCD | Semantic Clinical Drug | Ingredient + Strength + Dose Form | Testosterone 200 MG/ML Injectable Solution |
| DF | Dose Form | Standalone dose form concept | Injectable Solution |

**Key application to compounding databases:**
- Store `rxnorm_in_cui` (ingredient/moiety) and `rxnorm_pin_cui` (precise ingredient/salt) as separate fields
- Multi-ingredient compounds are identified by `rxnorm_min_cui` (Multiple Ingredients)
- Strength is expressed per [UCUM](https://ucum.org/) units of measure (mg, mL, g) with numerator/denominator pattern

Medplum's FHIR-based formulary implementation ([Medplum formulary docs](https://www.medplum.com/docs/medications/formulary)) uses RxNorm as the preferred code system for each ingredient in `MedicationKnowledge.ingredient[].itemCodeableConcept`.

### 3.4 PCCA Formulary Database Structure

PCCA (Professional Compounding Centers of America) maintains the industry's largest proprietary compounding formulary with over 9,600 formulations ([PCCA formulary](https://www.pccarx.com/AboutUs/Glossary/CompoundingFormulas)). Key structural features:

**Formula organization:**
- Each formula is a combination of **active pharmaceutical ingredients (APIs)** + **base/vehicle ingredients** + **excipients** in specific quantities
- Formulas are tied to **PCCA-brand bases and ingredients** — substituting a non-PCCA ingredient invalidates the BUD ([PCCA Standard](https://thepccastandard.pccarx.com/Formulation))
- Formulas carry a **"BUD Study" designation** when supported by stability-indicating analytical testing per the new USP \<795\>/\<797\> requirements ([PCCA FormulaPlus changes](https://www.pccarx.com/Blog/upcoming-changes-to-pcca-formulas-per-the-new-usp-795-797-and-800-part-one))

**FormulaPlus™ (bracketed formulas):**
- Tested at low and high API concentrations, establishing stability across a *range* of strengths
- Approximately 225 FormulaPlus formulas, with ~20 new studies added annually
- Each study costs up to $50,000 and includes: stability-indicating assay, USP \<51\> antimicrobial effectiveness testing, container-closure testing

**Regulatory compliance tracking:**
- Formulas are tracked against FDA's 503A Bulk Drug Substances list; when substances are removed (e.g., tranilast in 2019), PCCA removes or flags affected formulas ([PCCA blog on FDA ruling](https://www.pccarx.com/Blog/what-pcca-formulas-mean-for-compounders))
- Formulas include hazardous drug flags per NIOSH designation and reference USP \<800\> for handling requirements

### 3.5 USP \<795\> and \<797\>: Data Modeling Implications

**USP \<795\>** (nonsterile compounding) and **USP \<797\>** (sterile compounding) define the Master Formulation Record (MFR) and Compounding Record (CR) as the core documentation objects. These directly define the data schema for compounding software. As of November 2023, both chapters have been revised with significantly stricter BUD extension requirements.

**Required MFR fields per USP \<795\>** ([University of Illinois USP 795 MFR guide](https://answers.illinois.edu/illinois.vetmedvth/130889), [USP General Chapter \<795\> PDF](https://www.vtvets.org/assets/docs/0c10418b-9976-4cbc-a032-ace030dfe10f.pdf)):

| Field | Database Column |
|-------|----------------|
| Name, strength/activity, dosage form | `formula_name`, `strength_display`, `dosage_form_id` |
| Identities and amounts of all components | `FORMULATION_INGREDIENT` table |
| Relevant component characteristics (particle size, salt form, purity grade, solubility) | `ingredient_characteristics` in ingredient table |
| Calculations to determine/verify quantities and API concentrations | `calculation_notes`, `conversion_factor` |
| Compatibility and stability information with references | `stability_reference`, `stability_source` |
| Equipment required | `equipment_list` |
| Detailed mixing instructions / process steps | `FORMULATION_STEP` table |
| Sample labeling: generic name, concentration of each API, BUD, storage, RX number | `label_template` |
| Container used in dispensing | `container_type` |
| Packaging and storage requirements | `storage_conditions`, `container_closure` |
| Physical description of final preparation | `appearance_description` |
| Quality control measures and expected results | `qc_procedures`, `qc_expected_results` |
| Assigned BUD (or BUD extension references) | `bud_hours_room_temp`, `bud_hours_refrigerated`, `bud_hours_frozen`, `bud_reference` |

**Required Compounding Record (CR) fields** — these are the *instance* data tied to each preparation:

| Field | Database Column |
|-------|----------------|
| MFR reference | `mfr_formula_id` (FK) |
| Names and quantities of all components used | `COMPOUNDING_RECORD_INGREDIENT` |
| Source, lot numbers, expiration dates of each component | `ingredient_lot_number`, `ingredient_expiry` |
| Total quantity compounded | `total_quantity_compounded` |
| Date and time of preparation | `prepared_at` |
| Assigned prescription/control number | `rx_number` |
| Assigned BUD | `bud_date`, `bud_time` |
| Personnel signatures (preparer, QC checker, verifying pharmacist) | `prepared_by`, `qc_by`, `verified_by` |
| Quality control results (pH, visual inspection, filter integrity) | `qc_results` |
| Description of final preparation | `final_appearance` |
| Deviations from MFR | `deviations` |

**USP \<797\>-specific additions for sterile preparations:**

- Sterilization method (autoclave, filter sterilization, terminal sterilization) — `sterilization_method`
- ISO classification of compounding environment — `iso_class`
- CSP category (Category 1, 2, or 3 per revised USP \<797\>) — `csp_category`
- Extended BUD justification: must include documented stability-indicating analytical testing, USP \<51\> AET, container-closure testing ([Fagron Academy BUD extension analysis](https://www.fagronacademy.us/blog/regulatory-update-understanding-new-requirements-for-beyond-use-date-extension-for-usp-795-and-797))

---

## 4. Formulary Database Design Patterns

### 4.1 Ingredient Master Table

The ingredient master is the foundational reference table. Based on RxNorm structure, USP requirements, and FDA naming conventions, a well-designed ingredient master includes:

```sql
CREATE TABLE ingredient (
    ingredient_id          SERIAL PRIMARY KEY,
    
    -- Identity
    name                   VARCHAR(255) NOT NULL,        -- "Testosterone Cypionate"
    moiety_name            VARCHAR(255),                 -- "Testosterone"
    synonyms               TEXT[],                       -- alternate names
    
    -- Coding / cross-references
    rxnorm_in_cui          VARCHAR(20),                  -- RxNorm Ingredient CUI
    rxnorm_pin_cui         VARCHAR(20),                  -- RxNorm Precise Ingredient CUI
    unii                   VARCHAR(10),                  -- FDA Unique Ingredient Identifier
    cas_number             VARCHAR(20),                  -- Chemical Abstracts Service number
    ndc_source             VARCHAR(12),                  -- Source NDC (for 503B reporting)
    
    -- Chemical properties
    salt_form              VARCHAR(100),                 -- "cypionate", "hydrochloride", "besylate"
    molecular_formula      VARCHAR(100),                 -- "C27H40O3"
    molecular_weight       DECIMAL(10,4),                -- in g/mol
    conversion_factor      DECIMAL(10,6),                -- moiety-to-salt weight factor
    
    -- Regulatory
    is_controlled          BOOLEAN DEFAULT FALSE,
    dea_schedule           VARCHAR(10),                  -- "III", "IV", "V"
    is_hazardous_drug      BOOLEAN DEFAULT FALSE,        -- NIOSH hazardous drug list
    niosh_hazard_category  VARCHAR(50),
    is_bulk_substance      BOOLEAN DEFAULT FALSE,        -- bulk API vs. finished product
    bulk_list_status       VARCHAR(50),                  -- "503A Category 1", "503B approved"
    
    -- Quality
    usp_monograph_ref      VARCHAR(255),
    purity_grade           VARCHAR(50),                  -- "USP", "NF", "pharmaceutical grade"
    
    -- Timestamps
    created_at             TIMESTAMP DEFAULT NOW(),
    updated_at             TIMESTAMP DEFAULT NOW()
);
```

**Notes on CAS numbers**: CAS numbers uniquely identify chemical substances including specific salt forms. Testosterone cypionate has CAS 58-20-8; testosterone propionate has CAS 57-85-2. Storing CAS allows cross-referencing to external chemical databases, detecting duplicates, and linking to safety data.

### 4.2 Concentration and Strength Representation

The **numerator/denominator ratio pattern** is used universally in pharmacy data standards:

| Concentration Type | Expression | Numerator | Denominator |
|-------------------|------------|-----------|-------------|
| mg/mL (injectable, solution) | 200 mg/mL | 200 mg | 1 mL |
| % w/v (topical liquid) | 2% | 2 g | 100 mL |
| % w/w (topical cream/gel) | 5% | 5 g | 100 g |
| mg/g (topical solid/gel) | 10 mg/g | 10 mg | 1 g |
| mg/capsule (oral solid) | 50 mg | 50 mg | 1 capsule |
| mcg/actuation (nasal spray) | 50 mcg | 50 mcg | 1 actuation |
| mg/mL (sublingual drop) | 1 mg/0.1 mL = 10 mg/mL | 10 mg | 1 mL |
| mg/pellet (implant) | 100 mg | 100 mg | 1 pellet |

**FHIR Medication resource** (R6) encodes strength as:
```json
"ingredient": [{
  "item": { "concept": { "coding": [{ "system": "http://www.nlm.nih.gov/research/umls/rxnorm", "code": "1001", "display": "Testosterone Cypionate" }] } },
  "isActive": true,
  "strengthRatio": {
    "numerator": { "value": 200, "unit": "mg", "system": "http://unitsofmeasure.org", "code": "mg" },
    "denominator": { "value": 1, "unit": "mL", "system": "http://unitsofmeasure.org", "code": "mL" }
  }
}]
```
Source: [HL7 FHIR R6 Medication](https://build.fhir.org/medication.html)

**Unit normalization:** Systems should store a `base_concentration_mg_per_mL` or `base_concentration_mg_per_g` as a computed/normalized field for cross-formulation queries and dose calculations, even if the display representation uses %, mg/g, etc.

### 4.3 Dosage Form Taxonomy

Dosage forms used in compounding span both sterile and non-sterile preparations. Based on FDA SPL terminology and compounding practice:

| Category | Dosage Forms | Sterile? |
|----------|-------------|---------|
| **Injectables** | Solution for injection, Suspension for injection, Emulsion for injection | Yes |
| **Topical** | Cream, Gel, Ointment, Lotion, Foam, Transdermal patch, Spray | No |
| **Oral solid** | Capsule, Tablet, Troche/Lozenge, Rapid-dissolve tablet | No |
| **Oral liquid** | Solution, Suspension, Syrup, Elixir, Emulsion | No |
| **Sublingual** | Sublingual tablet, Sublingual drop, Sublingual troche | No |
| **Mucosal** | Suppository (rectal/vaginal), Enema, Pessary | No |
| **Inhalation** | Nasal spray, Nasal drops, Inhalation solution | No/Yes |
| **Ophthalmic** | Eye drops, Eye gel, Eye ointment | Yes |
| **Otic** | Ear drops | No |
| **Implant** | Pellet | Varies |

In Compound Direct's software, dosage forms have associated ([Compound Direct dosage forms docs](https://compound.direct/documentation/en/dosage-forms)):
- **Calculation method** (weight-based, volume-based, capsule-fill with packing statistics)
- **Default base ingredient** (only ingredients marked as "base" are available)
- **Default devices** (capsule molds, syringes, tubes)
- **Days till expiry** (BUD default for all formulas in that dosage form)
- **Route of administration** (linked at dosage form level)
- **Prefix/suffix** (e.g., "Topical", "Vaginal", "Otic" suffixes)

### 4.4 Route of Administration Coding

Routes are encoded using standardized code systems. The most common approaches:

**SNOMED CT Route Codes** (used in FHIR):
- Oral (PO): `26643006`
- Intramuscular (IM): `78421000`
- Subcutaneous (SubQ): `34206005`
- Topical: `6064005`
- Sublingual (SL): `37839007`
- Intranasal: `46713006`
- Intravenous (IV): `47625008`
- Vaginal: `16857009`
- Rectal: `37161004`

**FDA SPL Route Codes** (used in NDC directory and 503B product reporting) — available at FDA's SPL terminology page.

**Abbreviations used in compounding practice:** SubQ, IM, IV, PO, SL, TOP, IN, IVag, PR, IO (intraosseous for veterinary)

### 4.5 Representing a "Configurable Product"

The challenge of 503A compounding is that the same "formulation template" may be used to produce preparations with different strengths on different prescriptions. Two patterns handle this:

**Pattern 1: Fixed MFR per exact formulation**  
A separate MFR exists for each unique combination of strength + dosage form. If a prescriber orders testosterone cypionate at 150 mg/mL (vs. the standard 200 mg/mL), a new MFR is created or cloned. This is the strictest interpretation of USP requirements.

**Pattern 2: Parent-child (hierarchical) model**  
A parent record defines the formula's ingredient *ratios* (without a fixed absolute strength), and child records represent specific dose variations. This is the approach used in Medplum's FHIR implementation ([Medplum formulary docs](https://www.medplum.com/docs/medications/formulary)):

```
PARENT MedicationKnowledge:
  name: "Testosterone Cypionate Injectable"
  ingredient: [Testosterone Cypionate, Cottonseed Oil, Benzyl Alcohol]
  relatedMedicationKnowledge.type: "child" → [child1, child2, child3]

CHILD MedicationKnowledge:
  name: "Testosterone Cypionate 100mg/mL 10mL vial"
  amount: 10 mL
  relatedMedicationKnowledge.type: "parent" → [parent]
  
CHILD MedicationKnowledge:
  name: "Testosterone Cypionate 200mg/mL 10mL vial"
  amount: 10 mL
  relatedMedicationKnowledge.type: "parent" → [parent]
```

**Pattern 3: PCCA bracketed formulas**  
PCCA uses a single FormulaPlus formula with a defined range of API concentrations (e.g., 5-20% for a cream formulation), validated by testing at the low and high ends. The database stores `min_api_concentration` and `max_api_concentration` fields, and the BUD is valid for any concentration within the range.

### 4.6 Beyond-Use Dating as a Data Field

The BUD is not a single value but a complex, multi-dimensional field derived from USP chapter requirements, sterility category, and storage conditions. Since the November 2023 revision of USP \<795\> and \<797\> ([Fagron Academy analysis](https://www.fagronacademy.us/blog/regulatory-update-understanding-new-requirements-for-beyond-use-date-extension-for-usp-795-and-797); [Mississippi Board of Pharmacy BUD fact sheet](https://www.mbp.ms.gov/sites/default/files/2023-03/USP_Compounding_BUD_Fact_Sheet.pdf)):

**For nonsterile preparations (USP \<795\>):**
- Nonaqueous: up to 180 days (default) or extended BUD with stability study
- Aqueous: up to 30 days (default) or extended with study
- Extension requires: stability-indicating analytical testing + USP \<51\> AET (for aqueous) + container-closure testing at bracketed concentrations

**For sterile preparations (USP \<797\>):**
| CSP Category | Room Temp | Refrigerated | Frozen |
|-------------|-----------|--------------|--------|
| Category 1 | 12 hours | 24 hours | — |
| Category 2 | Per stability data (up to 90 days RT) | Up to 120 days | Up to 180 days |
| Category 3 (qualified facility) | Up to 90 days | Up to 120 days | Up to 180 days |

**BUD fields in database:**

```sql
-- In FORMULATION table:
bud_room_temp_hours       INTEGER,    -- BUD at room temp (CRT)
bud_refrigerated_hours    INTEGER,    -- BUD at 2-8°C
bud_frozen_hours          INTEGER,    -- BUD at ≤-20°C
bud_basis                 VARCHAR(50), -- "USP_default" / "stability_study" / "bracketed"
bud_reference             TEXT,        -- citation for extended BUD
usp_chapter               VARCHAR(10), -- "795" or "797"
csp_category              VARCHAR(20), -- "Category1" / "Category2" / "Category3" (797 only)

-- In COMPOUNDING_RECORD table (per-preparation instance):
bud_date                  DATE,
bud_time                  TIME,        -- for CSPs, BUD includes hour
bud_assigned_by           INTEGER      -- FK to pharmacist
```

**503A vs 503B BUD distinction**: 503A preparations have BUDs (conservative, determined from date of compounding). 503B preparations have **expiration dates** determined by comprehensive stability testing — essentially equivalent to commercial pharmaceutical expiration dates ([Epicur Pharma BUD vs Expiration](https://epicurpharma.com/wp-content/uploads/2021/04/Beyond-Use-Date-vs.-Expiration-Date_2023.pdf)).

---

## 5. Multi-Ingredient Compound Modeling

### 5.1 Junction Table Pattern

The standard approach across all major implementations is the **junction (associative) table** pattern, where each row in `FORMULATION_INGREDIENT` represents one ingredient in one formulation:

```
FORMULATION (1) ─────────────── (many) FORMULATION_INGREDIENT (many) ─────────────── (1) INGREDIENT
```

This was validated in:
- HL7 FHIR R6: `Medication.ingredient[]` is an array of BackboneElements, each referencing a substance or medication ([FHIR R6 Medication](https://build.fhir.org/medication.html))
- FHIR US Core: `Medication.ingredient[].item` references Substance or Medication, with `isActive` and `strength` per ingredient ([US Core Medication Profile](https://build.fhir.org/ig/HL7/US-Core/StructureDefinition-us-core-medication.html))
- Medplum: `MedicationKnowledge.ingredient[]` with per-ingredient `isActive` and `strength` ratio ([Medplum formulary](https://www.medplum.com/docs/medications/formulary))
- Back4app template: `MedicationRecipe.ingredients: Array<Pointer<IngredientInventory>>` ([Back4app compound pharmacy](https://www.back4app.com/templates/compound-pharmacy-app))

**Full junction table schema:**

```sql
CREATE TABLE formulation_ingredient (
    formulation_ingredient_id   SERIAL PRIMARY KEY,
    formula_id                  INTEGER NOT NULL REFERENCES formulation(formula_id),
    ingredient_id               INTEGER NOT NULL REFERENCES ingredient(ingredient_id),
    
    -- Role classification
    is_active                   BOOLEAN NOT NULL DEFAULT TRUE,
    ingredient_role             VARCHAR(50),  -- "active", "base", "vehicle", "preservative", 
                                             --  "diluent", "excipient", "flavor", "colorant"
    
    -- Strength (numerator/denominator ratio pattern)
    strength_numerator_value    DECIMAL(12,6),
    strength_numerator_unit     VARCHAR(20),  -- mg, g, mL, mcg, IU, %
    strength_denominator_value  DECIMAL(12,6),
    strength_denominator_unit   VARCHAR(20),  -- mL, g, capsule, actuation
    
    -- Absolute quantity per batch
    quantity_per_batch_value    DECIMAL(12,6),
    quantity_per_batch_unit     VARCHAR(20),
    
    -- Concentration normalization
    concentration_mg_per_ml     DECIMAL(12,6),  -- normalized for queries
    concentration_mg_per_g      DECIMAL(12,6),  -- for solid forms
    
    -- Salt form calculation
    expressed_as                VARCHAR(50),    -- "moiety", "salt", "ester"
    potency_factor              DECIMAL(10,6),  -- COA-specific adjustment
    
    -- Ordering
    sort_order                  INTEGER,
    
    -- QS (quantity sufficient) flag
    is_qs                       BOOLEAN DEFAULT FALSE,  -- "add to 100 mL" / "qs ad"
    
    UNIQUE(formula_id, ingredient_id, ingredient_role)
);
```

### 5.2 Concentration Normalization Across Different Units

When a formula contains multiple ingredients in different concentration units, normalization is essential for:
- Dose calculations
- Compatibility checking
- Cross-formulation comparison

The normalization approach:

| Input Expression | Normalization Target | Calculation |
|-----------------|---------------------|-------------|
| 200 mg/mL | mg/mL | Direct |
| 2% w/v | mg/mL | 2% = 2 g/100 mL = 20 mg/mL |
| 5% w/w | mg/g | 5% = 50 mg/g |
| 50 mcg/actuation | mcg/actuation | Direct (no volume normalization) |
| 100 mg/capsule | mg per unit | Direct |

**Salt form normalization**: Strengths are typically expressed in terms of the **active moiety** per FDA/USP naming policy. The physical weight to dispense is calculated as `moiety_strength / conversion_factor`. For example:
- Target: 200 mg testosterone cypionate per mL
- Conversion: testosterone cypionate IS the salt (no moiety conversion needed; cypionate ester is part of the active molecule per FDA naming exception for steroids)
- But for prazosin: target 1 mg/mL prazosin → need 1.095 mg/mL prazosin HCl

### 5.3 Ingredient Interactions and Compatibility

Compounding databases must handle ingredient incompatibilities, which determine whether ingredients can be combined in the same preparation. This is a distinct concern from drug-drug interaction (which is clinical/pharmacological), focusing instead on **physical and chemical compatibility** ([PK Software, rxcmpd.com](http://www.rxcmpd.com/products/products.aspx) includes clinical drug screening at ingredient level).

**Compatibility data model:**

```sql
CREATE TABLE ingredient_compatibility (
    compatibility_id    SERIAL PRIMARY KEY,
    ingredient_id_1     INTEGER REFERENCES ingredient(ingredient_id),
    ingredient_id_2     INTEGER REFERENCES ingredient(ingredient_id),
    compatibility_type  VARCHAR(50),   -- "physical", "chemical", "pH"
    result              VARCHAR(20),   -- "compatible", "incompatible", "conditionally_compatible"
    conditions          TEXT,          -- e.g., "compatible at pH < 6 only"
    reference           TEXT,          -- source citation
    CHECK (ingredient_id_1 < ingredient_id_2)  -- prevent duplicates
);
```

**PCCA's approach**: The FormulaPlus program tests specific ingredient combinations for stability and compatibility. The formula database flags whether ingredients other than the specified PCCA-brand components have been validated — substitutions invalidate the tested BUD.

The **testosterone cypionate + anastrozole** combination in cottonseed oil is validated in published literature and patent filings ([US10201549B2](https://patents.google.com/patent/US10201549B2/en)), but the compatibility is solubility-dependent: anastrozole (slightly water-soluble) must dissolve in the oil vehicle at the target concentration.

### 5.4 Complete Example: Testosterone Cypionate 200 mg/mL + Anastrozole 0.5 mg/mL in Cottonseed Oil

**Formulation record:**

| Field | Value |
|-------|-------|
| formula_id | F-TC-ANAST-001 |
| name | Testosterone Cypionate 200mg/mL + Anastrozole 0.5mg/mL Injectable |
| dosage_form | Solution for Injection |
| route | Intramuscular |
| total_quantity | 10 mL (per vial) |
| usp_chapter | 797 |
| csp_category | Category 2 |
| bud_refrigerated_hours | 720 (30 days, per USP <797> default) |
| is_sterile | true |
| sterility_category | 503A or 503B depending on compounder |

**Formulation ingredient rows:**

| Ingredient | Role | isActive | Strength | Quantity/10 mL |
|------------|------|----------|----------|---------------|
| Testosterone Cypionate | active | true | 200 mg/mL | 2,000 mg |
| Anastrozole | active | true | 0.5 mg/mL | 5 mg |
| Benzyl Benzoate | preservative/solubilizer | false | 0.1 mL/mL (10%) | 1 mL |
| Cottonseed Oil | vehicle | false | qs ad 1 mL | qs to 10 mL |

**Note on 503B product reporting:** For FDA reporting, this product would be reported as two separate ingredient entries (one per active ingredient), each with the source NDC of the API used. The testosterone cypionate would use a bulk testosterone cypionate API NDC; the anastrozole would use a bulk anastrozole API NDC.

---

## 6. Summary: Key Design Implications

### 6.1 The Core Data Model

A compounding pharmacy database requires, at minimum, these interconnected entities:

```
INGREDIENT_MASTER
  (ingredient_id, name, moiety_name, rxnorm_cui, unii, cas_number, 
   salt_form, molecular_weight, conversion_factor, is_controlled,
   is_hazardous, ndc_source_api)

DOSAGE_FORM_TAXONOMY
  (dosage_form_id, name, code, is_sterile, usp_chapter,
   calculation_method, default_unit)

ROUTE_OF_ADMINISTRATION
  (route_id, name, snomed_code, fda_spl_code, abbreviation)

FORMULATION [MFR]
  (formula_id, name, dosage_form_id→, route_id→, 
   total_quantity, total_quantity_unit, version,
   bud_room_temp_hours, bud_refrigerated_hours, bud_frozen_hours,
   bud_basis, bud_reference, usp_chapter, csp_category,
   is_sterile, sterility_process, stability_reference,
   is_bracketed, min_api_concentration, max_api_concentration,
   source_formula_ref [PCCA/CompoundingToday formula ID],
   pharmacy_type [503A/503B], ndc_product [503B only])

FORMULATION_INGREDIENT [junction table]
  (formulation_ingredient_id, formula_id→, ingredient_id→,
   is_active, ingredient_role, 
   strength_numerator_value, strength_numerator_unit,
   strength_denominator_value, strength_denominator_unit,
   quantity_per_batch_value, quantity_per_batch_unit,
   concentration_mg_per_ml, expressed_as, potency_factor,
   is_qs, sort_order)

COMPOUNDING_RECORD [per-preparation instance]
  (record_id, formula_id→, rx_number [503A] / batch_number [503B],
   patient_id [503A], 
   prepared_at, bud_date, bud_time,
   prepared_by, verified_by,
   total_quantity_compounded, appearance)

COMPOUNDING_RECORD_INGREDIENT [instance ingredients with lot tracking]
  (cr_ingredient_id, record_id→, ingredient_id→,
   quantity_used, unit, lot_number, expiration_date, 
   supplier_ndc [for 503B reporting])
```

### 6.2 Key Distinctions from Commercial Drug Databases

| Aspect | Commercial Drug DB (NDC) | Compounding DB |
|--------|--------------------------|---------------|
| Product identity | Fixed NDC code | Formula ID (MFR) + RX number (503A) or NDC (503B optional) |
| Ingredients | Single record | Junction table (one row per ingredient) |
| Strength | Single value field | Ratio (numerator/denominator with units) |
| Dosage form | Lookup from fixed list | Lookup with calculation method and BUD rules |
| Expiration | Fixed manufacturer date | Calculated BUD (503A) or tested expiry (503B) |
| Salt form | Embedded in name | Separate field with conversion factor |
| Batch/lot | Not applicable | Required (CR tracks per-ingredient lot) |
| Customization | None | Parent-child or bracketed range patterns |

### 6.3 Applicable Standards and Reference Implementations

| Standard/System | Purpose | URL |
|----------------|---------|-----|
| RxNorm (NLM) | Ingredient coding (IN, PIN, SCDC, SCD, MIN term types) | [nlm.nih.gov/rxnorm](https://www.nlm.nih.gov/research/umls/rxnorm/overview.html) |
| HL7 FHIR R6 Medication | Open interoperability schema for medications | [build.fhir.org/medication](https://build.fhir.org/medication.html) |
| HL7 FHIR MedicationKnowledge | Formulary-level medication catalog | [medplum.com/docs/medications/formulary](https://www.medplum.com/docs/medications/formulary) |
| USP \<795\> | MFR/CR requirements for nonsterile compounding | USP-NF |
| USP \<797\> | MFR/CR requirements for sterile compounding + BUD rules | USP-NF |
| FDA 503B NDC directory | Product catalog for 503B outsourcing facilities | [FDA NDC Directory](https://www.fda.gov/media/162171/download) |
| PCCA Formulary | 9,600+ tested compounding formulas | [pccarx.com/AboutUs/Glossary/CompoundingFormulas](https://www.pccarx.com/AboutUs/Glossary/CompoundingFormulas) |
| CompoundingToday | 3,600+ public formulas with BUD and source refs | [compoundingtoday.com/formulation/Formula.cfm](https://compoundingtoday.com/formulation/Formula.cfm) |
| SNOMED CT Routes | Standard route of administration codes | HL7/SNOMED |
| UCUM | Standard units of measure for concentrations | [unitsofmeasure.org](https://ucum.org) |
| FDA Salt Naming Policy | How to handle salt form in naming and strength | [FDA guidance PDF](https://www.fda.gov/files/drugs/published/Naming-of-Drug-Products-Containing-Salt-Drug-Substances.pdf) |

---

*Research compiled April 7, 2026. All sources cited inline throughout the document.*
