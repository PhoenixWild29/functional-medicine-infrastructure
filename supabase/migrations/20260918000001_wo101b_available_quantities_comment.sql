-- ============================================================
-- WO-101b: available_quantities is not a display source
-- ============================================================
--
-- Prod, dr.chen, Semaglutide Injectable 5 mg/mL, 20 units weekly for 90
-- days: Quick Rx's option card read "3 × 1 mL vials · Available: 1 mL
-- vial, 3 mL vial". The size list came from this column; the suggestion
-- and prices come from pharmacy_formulation_packages, where the WO-101
-- backfill created only the first listed size. The 3 mL vial had no
-- price. The prescribing flow now lists sizes from the active packages
-- only (src/lib/orders/rx-details.ts pharmacySizeLabels).
--
-- Comment only: no data, no constraint. Nothing is backfilled — a size
-- with no known wholesale price is never shown, selectable or suggested.

COMMENT ON COLUMN pharmacy_formulations.available_quantities IS
  'Catalog import input only — NOT a display source. The sizes a pharmacy sells, with prices, are the active pharmacy_formulation_packages rows; the prescribing flow (builder, price step, Review) lists only those (WO-101b). Written by scripts/import-catalog-v3.ts and the formulation seed scripts; read by the WO-101 package backfill (migration 20260914000001) and the importer''s default-package rule. Sizes listed here without a package row have no known price.';
