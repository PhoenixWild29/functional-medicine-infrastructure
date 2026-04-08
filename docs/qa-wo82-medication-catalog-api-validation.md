# WO-82 Hierarchical Medication Catalog API Validation — QA Report

**Date:** April 8, 2026
**Phase:** Phase 13 — UI/UX Redesign
**Work Order:** WO-82 — Hierarchical Medication Catalog (Database + API)
**Application:** CompoundIQ Clinic App
**URL:** https://functional-medicine-infrastructure.vercel.app
**API Endpoint:** `/api/formulations`
**Tester:** Claude (Automated QA)

---

## Summary

**Overall Result: ✅ ALL 4 STEPS PASS** (1 minor data observation)

The hierarchical medication catalog API is fully functional. The `/api/formulations` endpoint correctly supports multi-level cascading queries across the full hierarchy: ingredients → salt forms → dosage forms → routes → formulations → pharmacy pricing. The API supports 20 ingredients, 13 therapeutic categories, 19 formulations (16 single-ingredient + 3 combinations), and state-filtered pharmacy pricing. Search filtering works correctly. The data model supports rich metadata including FDA alert status, DEA scheduling, sterility flags, injection supply requirements, sig prefixes, and integration tier info.

---

## Results Table

| Step | Test | Result | Notes |
|------|------|--------|-------|
| 1 | Ingredient Search | ✅ PASS | Unfiltered: 20 ingredients returned alphabetically. Filtered (`q=sema`): only Semaglutide returned. Rich metadata includes `therapeutic_category`, `dea_schedule`, `fda_alert_status`, `fda_alert_message`, `description`. |
| 2 | Categories | ✅ PASS | 13 therapeutic categories returned: Anti-Aging, Autoimmune, Cognitive, Detox, Hormone Support, Immune, MCAS, Men's Health, Pain Management, Peptides, Sleep, Weight Loss, Women's Health. |
| 3 | Full Cascade | ✅ PASS | Semaglutide → "Semaglutide (base)" salt form → 2 formulations (5mg/mL, 2.5mg/mL) → Strive Pharmacy with $150 wholesale, 5mL/2.5mL vials, 5-day turnaround, TIER_4_FAX. |
| 4 | Combination Formulations | ✅ PASS | 3 combinations found: NAD+/MOTS-c/5-Amino-1MQ (3 ingredients linked), BPC-157/TB-500/GHK-Cu (3 ingredients linked), Lipo-Mino Mix C (6 ingredients, links not populated — see observation). |

---

## Step 1 — Ingredient Search Detail

### Unfiltered: `GET /api/formulations?level=ingredients`

**Response:** 20 ingredients returned alphabetically:

| # | Ingredient | Category | DEA | FDA Alert |
|---|-----------|----------|-----|-----------|
| 1 | 5-Amino-1MQ | Weight Loss | — | — |
| 2 | BPC-157 | Peptides | — | Category 2 |
| 3 | DHEA | Hormone Support | — | — |
| 4 | DSIP | Sleep | — | — |
| 5 | GHK-Cu | Anti-Aging | — | — |
| 6 | Glutathione | Detox | — | — |
| 7 | Ketamine | Pain Management | — | — |
| 8 | Ketotifen | MCAS | — | — |
| 9 | Lipo-Mino Mix | Weight Loss | — | — |
| 10 | Methylene Blue | Cognitive | — | — |
| 11 | MOTS-c | Anti-Aging | — | — |
| 12 | NAD+ | Anti-Aging | — | — |
| 13 | Naltrexone | Autoimmune | — | — |
| 14 | Progesterone | Women's Health | — | — |
| 15 | Semaglutide | Weight Loss | — | — |
| 16 | Sermorelin | Peptides | — | — |
| 17 | TB-500 | Peptides | — | — |
| 18 | Testosterone | Men's Health | — | — |
| 19 | Thymosin Alpha-1 | Immune | — | — |
| 20 | Tirzepatide | Weight Loss | — | — |

**Notable:** BPC-157 has FDA Alert "Category 2" with message: "FDA categorized BPC-157 as a substance presenting significant safety risks (immunogenicity/angiogenesis). Provider must acknowledge before prescribing."

### Filtered: `GET /api/formulations?level=ingredients&q=sema`

**Response:** 1 result — `Semaglutide` only. ✅ Search filter works correctly (case-insensitive partial match).

---

## Step 2 — Categories Detail

### `GET /api/formulations?level=categories`

**Response:** 13 therapeutic categories returned as string array:

Anti-Aging, Autoimmune, Cognitive, Detox, Hormone Support, Immune, MCAS, Men's Health, Pain Management, Peptides, Sleep, Weight Loss, Women's Health

---

## Step 3 — Full Cascade Detail

### Level 1: Ingredient → Salt Forms
`GET /api/formulations?level=salt_forms&ingredient_id=b1000000-0000-4000-8000-000000000001`

| Salt Form | ID | Abbreviation |
|-----------|----|-------------|
| Semaglutide (base) | b2000000-0000-4000-8000-000000000001 | base |

### Level 2: Salt Form → Formulations
`GET /api/formulations?level=formulations&salt_form_id=b2000000-0000-4000-8000-000000000001`

| Formulation | Concentration | Dosage Form | Route | Sterile | Injection Supplies |
|-------------|--------------|-------------|-------|---------|-------------------|
| Semaglutide 5mg/mL Injectable | 5mg/mL | Injectable Solution | Subcutaneous (SubQ) | ✅ | ✅ |
| Semaglutide 2.5mg/mL Injectable | 2.5mg/mL | Injectable Solution | Subcutaneous (SubQ) | ✅ | ✅ |

**Sig prefix:** "Inject" (from route_of_administration)

### Level 3: Formulation → Pharmacy Options
`GET /api/formulations?level=pharmacy_options&formulation_id=b3000000-0000-4000-8000-000000000001&state=TX`

| Pharmacy | Wholesale | Quantities | Turnaround | Integration |
|----------|-----------|------------|------------|-------------|
| Strive Pharmacy | $150.00 | 5mL vial, 2.5mL vial | 5 days | TIER_4_FAX |

**Full cascade verified:** Ingredient → Salt Form → Formulation → Pharmacy with pricing, all linked correctly.

---

## Step 4 — Combination Formulations Detail

### `GET /api/formulations?level=formulations` (filtered `is_combination === true`)

**3 combination formulations found:**

| Formulation | Total Ingredients | Linked Ingredients | Route |
|-------------|------------------|--------------------|-------|
| NAD+/MOTS-c/5-Amino-1MQ 100/10/10mg Injectable | 3 | NAD+, MOTS-c, 5-Amino-1MQ | SubQ |
| BPC-157/TB-500/GHK-Cu 10/10/50mg Injectable | 3 | BPC-157, TB-500, GHK-Cu | SubQ |
| Lipo-Mino Mix C 30mL Multi-Dose Vial | 6 | (empty — see observation) | IM |

---

## Full Formulation Catalog (19 total)

| # | Formulation | Combination | Route |
|---|------------|-------------|-------|
| 1 | Ketamine HCL 150mg RDT | No | — |
| 2 | Lipo-Mino Mix C 30mL Multi-Dose Vial | Yes (6) | IM |
| 3 | GHK-Cu Topical Cream | No | — |
| 4 | Naltrexone HCL 1mg/mL Oral Solution (LDN) | No | — |
| 5 | Naltrexone HCL 4.5mg Capsule (LDN) | No | — |
| 6 | Ketotifen 1mg Capsule | No | — |
| 7 | Methylene Blue 10mg Capsule | No | — |
| 8 | Semaglutide 5mg/mL Injectable | No | SubQ |
| 9 | Semaglutide 2.5mg/mL Injectable | No | SubQ |
| 10 | Testosterone Cypionate 200mg/mL Injectable | No | — |
| 11 | Testosterone Cypionate 200mg/mL in MCT Oil | No | — |
| 12 | BPC-157 5mg/mL Injectable | No | — |
| 13 | NAD+ 200mg/mL Injectable | No | — |
| 14 | Thymosin Alpha-1 3mg/mL Injectable | No | — |
| 15 | GHK-Cu 2mg/mL Injectable | No | — |
| 16 | Sermorelin 9mg/3mL Injectable | No | — |
| 17 | Tirzepatide 5mg/mL Injectable | No | — |
| 18 | NAD+/MOTS-c/5-Amino-1MQ 100/10/10mg Injectable | Yes (3) | SubQ |
| 19 | BPC-157/TB-500/GHK-Cu 10/10/50mg Injectable | Yes (3) | SubQ |

---

## API Schema Summary

| Level | Endpoint Param | Returns | Key Fields |
|-------|---------------|---------|------------|
| `ingredients` | `level=ingredients` | 20 records | `ingredient_id`, `common_name`, `therapeutic_category`, `dea_schedule`, `fda_alert_status`, `fda_alert_message`, `description` |
| `categories` | `level=categories` | 13 strings | Flat string array of therapeutic categories |
| `salt_forms` | `level=salt_forms&ingredient_id=` | Variable | `salt_form_id`, `salt_name`, `abbreviation`, `molecular_weight`, `conversion_factor` |
| `formulations` | `level=formulations` or `&salt_form_id=` | 19 total | `formulation_id`, `name`, `concentration`, `is_combination`, `total_ingredients`, `dosage_forms{}`, `routes_of_administration{}`, `formulation_ingredients[]` |
| `pharmacy_options` | `level=pharmacy_options&formulation_id=&state=` | Variable | `pharmacy_formulation_id`, `wholesale_price`, `available_quantities[]`, `estimated_turnaround_days`, `pharmacies{}` |

---

## Findings

### Observation (Non-Blocking)

**Lipo-Mino Mix C `formulation_ingredients` empty:** The Lipo-Mino Mix C formulation reports `total_ingredients: 6` and `is_combination: true`, but its `formulation_ingredients` array is empty (`[]`). The other two combination formulations (NAD+/MOTS-c/5-Amino-1MQ and BPC-157/TB-500/GHK-Cu) correctly populate their ingredient links. This is likely because the Lipo-Mino sub-ingredients (B12, MIC components, etc.) are not modeled as standalone entries in the `ingredients` table. Consider either: (a) adding those sub-ingredients to the catalog, or (b) adding a `display_ingredients` text field for combos that don't have full ingredient linkage.

---

## Conclusion

WO-82's hierarchical medication catalog API is fully functional and ready for the cascading dropdown prescription builder (WO-83). The API correctly implements 5 query levels with proper parent→child cascading, supports text search filtering, state-based pharmacy pricing, and rich metadata (FDA alerts, DEA scheduling, sterility flags, sig prefixes, integration tiers). The data model is well-structured for the multi-tier selection flow that WO-83 will build.
