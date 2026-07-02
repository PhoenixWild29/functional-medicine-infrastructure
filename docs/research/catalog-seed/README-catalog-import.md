# CompoundIQ Catalog Seed v1 + Importer Spec

**Date:** 2026-07-02 · **File:** `compoundiq-catalog-seed-v1.csv` (166 rows, validated)

Synthetic-but-realistic compounded-medication catalog for the testing phase. Ingredient names / strengths / dosage forms are modeled on real public formularies (UCP, Olympia, Hallandale, Empower, Belmar); **wholesale prices are synthetic demo values** and will be replaced by a real 503B price list when it lands. Every `dosage_form` and `route` value is constrained to the app's reference-table vocabulary (`supabase/migrations/20260408000002_wo82_seed_reference_data.sql`), so the cascade resolves cleanly.

## Coverage (166 rows, 79 ingredients, 33 combos, 15 DEA-scheduled)

Women's Health 25 · Peptides 26 · Sexual Health 23 · Thyroid 17 · Weight Management 14 · IV Therapy 12 · Dermatology 12 · Men's Health 8 · Adrenal 8 · Hair Restoration 7 · Other/LDN 6 · Longevity 5 · Mental Health 3.

## CSV columns

`ingredient_common_name, therapeutic_category, dea_schedule, salt_name, formulation_name, dosage_form, route, concentration_value, concentration_unit, is_combination, combo_ingredients, wholesale_price_usd, available_quantities`

- `dea_schedule`: empty or 2-5. Testosterone = 3, Ketamine = 3; hormones/thyroid/peptides/GLP-1 = empty. **Drives the EPCS 2FA gate** (`>=2` requires TOTP at signing).
- `concentration_value`: empty for combination products (ratios live in `combo_ingredients`).
- `combo_ingredients`: pipe-delimited (`Estriol 80%|Estradiol 20%`) when `is_combination=true`.
- `available_quantities`: pipe-delimited (`30 caps|60 caps|90 caps`) -> `pharmacy_formulations.available_quantities` JSONB.

## How this maps to the V3 hierarchical catalog

`ingredients` (common_name, therapeutic_category, dea_schedule) -> `salt_forms` (salt_name; skip when blank) -> `formulations` (name, dosage_form_id + route_id resolved BY NAME against the reference tables, concentration_value/unit, is_combination, total_ingredients) -> `formulation_ingredients` (for combos, one row per piped entry) -> `pharmacy_formulations` (pharmacy_id, wholesale_price, available_quantities). Retail is NOT in the catalog - it's computed in the margin builder at Rx time.

## Building the importer

The V3 importer (`scripts/import-catalog-v3.ts`) is being built in a separate PR. The exact 4-level insert shape is demonstrated end-to-end in `e2e/fixtures/seed.ts` and consumed field-for-field by `src/app/api/formulations/route.ts`. Resolve `dosage_form_id`/`route_id` by name against `20260408000002_wo82_seed_reference_data.sql` (do not create new reference rows). Importer must be idempotent on natural keys (common_name; ingredient_id+salt_name; formulation name; pharmacy_id+formulation_id).

## Legacy flat-catalog alternative (faster, less rich)

If you just need pharmacy-search/autocomplete populated now, the legacy `catalog` table already has a working CSV upload at `/ops/catalog` (drag-drop -> `POST /api/ops/catalog/upload`, ops_admin). Required columns there: `medication_name, form, dose, wholesale_price` (+ optional `retail_price, regulatory_status, requires_prior_auth`). A one-line transform of this CSV produces that shape. The V3 importer is the better long-term path since it powers the cascading builder.
