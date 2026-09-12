-- Down migration for 20260912000001_wo96_rx_detail_fields.sql
-- Atomic: either the whole rollback lands or none of it does.

BEGIN;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_orders_days_supply_positive;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_orders_dispense_quantity_positive;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_orders_refills_range;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_orders_syringe_option;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_orders_shipping_type;

ALTER TABLE orders
  DROP COLUMN IF EXISTS days_supply,
  DROP COLUMN IF EXISTS dispense_quantity,
  DROP COLUMN IF EXISTS dispense_unit,
  DROP COLUMN IF EXISTS refills,
  DROP COLUMN IF EXISTS substitution_allowed,
  DROP COLUMN IF EXISTS syringe_option,
  DROP COLUMN IF EXISTS shipping_type,
  DROP COLUMN IF EXISTS clinical_difference,
  DROP COLUMN IF EXISTS diagnosis_code,
  DROP COLUMN IF EXISTS diagnosis_text,
  DROP COLUMN IF EXISTS special_instructions;

ALTER TABLE formulations DROP CONSTRAINT IF EXISTS chk_formulations_default_syringe_option;
ALTER TABLE formulations DROP CONSTRAINT IF EXISTS chk_formulations_default_shipping_type;

ALTER TABLE formulations
  DROP COLUMN IF EXISTS default_syringe_option,
  DROP COLUMN IF EXISTS default_shipping_type,
  DROP COLUMN IF EXISTS clinical_difference_options,
  DROP COLUMN IF EXISTS requires_clinical_difference;

COMMIT;
