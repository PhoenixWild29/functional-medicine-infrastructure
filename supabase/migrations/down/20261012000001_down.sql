-- Down migration for 20261012000001_compounding_status.sql
-- Atomic: either the whole rollback lands or none of it does.
--
-- Restores prevent_snapshot_mutation exactly as 20261006000001 left it
-- (clinical_difference and the diagnosis editable after signing again),
-- and drops the compounding fields, the audit trigger and the audit
-- table. The audit history is lost with it: export it first if it must
-- be kept. Revert the app code that reads these columns first, or every
-- formulation line is refused as compounding_status_unknown.

BEGIN;

CREATE OR REPLACE FUNCTION prevent_snapshot_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.locked_at IS NOT NULL THEN
    IF (
      NEW.wholesale_price_snapshot         IS DISTINCT FROM OLD.wholesale_price_snapshot         OR
      NEW.retail_price_snapshot            IS DISTINCT FROM OLD.retail_price_snapshot            OR
      NEW.medication_snapshot              IS DISTINCT FROM OLD.medication_snapshot              OR
      NEW.shipping_state_snapshot          IS DISTINCT FROM OLD.shipping_state_snapshot          OR
      NEW.shipping_address_line1_snapshot  IS DISTINCT FROM OLD.shipping_address_line1_snapshot  OR
      NEW.shipping_address_line2_snapshot  IS DISTINCT FROM OLD.shipping_address_line2_snapshot  OR
      NEW.shipping_city_snapshot           IS DISTINCT FROM OLD.shipping_city_snapshot           OR
      NEW.shipping_zip_snapshot            IS DISTINCT FROM OLD.shipping_zip_snapshot            OR
      NEW.shipping_address_snapshot_at     IS DISTINCT FROM OLD.shipping_address_snapshot_at     OR
      NEW.provider_npi_snapshot            IS DISTINCT FROM OLD.provider_npi_snapshot            OR
      NEW.provider_signature_hash_snapshot IS DISTINCT FROM OLD.provider_signature_hash_snapshot OR
      NEW.pharmacy_snapshot                IS DISTINCT FROM OLD.pharmacy_snapshot                OR
      NEW.locked_at                        IS DISTINCT FROM OLD.locked_at
    ) THEN
      RAISE EXCEPTION 'Cannot modify snapshot fields after order is locked';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS log_ingredient_compounding_change ON ingredients;
DROP FUNCTION IF EXISTS log_ingredient_compounding_change();

DROP TRIGGER IF EXISTS ingredient_compounding_history_no_truncate ON ingredient_compounding_history;
DROP TRIGGER IF EXISTS ingredient_compounding_history_no_update_delete ON ingredient_compounding_history;
DROP POLICY IF EXISTS ingredient_compounding_history_ops_select ON ingredient_compounding_history;
DROP TABLE IF EXISTS ingredient_compounding_history;
DROP FUNCTION IF EXISTS ingredient_compounding_history_append_only();

ALTER TABLE ingredients DROP CONSTRAINT IF EXISTS chk_ingredients_compounding_source;
ALTER TABLE ingredients DROP CONSTRAINT IF EXISTS chk_ingredients_compounding_reviewed;
ALTER TABLE ingredients DROP CONSTRAINT IF EXISTS chk_ingredients_compounding_status;

ALTER TABLE ingredients
  DROP COLUMN IF EXISTS compounding_status_reviewed_by,
  DROP COLUMN IF EXISTS compounding_status_reviewed_at,
  DROP COLUMN IF EXISTS compounding_status_source,
  DROP COLUMN IF EXISTS on_fda_shortage,
  DROP COLUMN IF EXISTS commercial_equivalent,
  DROP COLUMN IF EXISTS compounding_status;

COMMIT;
