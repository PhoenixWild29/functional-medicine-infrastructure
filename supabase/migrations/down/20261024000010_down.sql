-- Down migration for 20261024000010_signed_order_freeze.sql
-- Atomic: either the whole rollback lands or none of it does.
--
-- Restores prevent_snapshot_mutation exactly as 20261012000001 left it:
-- the 16 snapshot columns frozen, and sig_text, quantity, refills,
-- dispense and the other clinical columns editable after signing again.
-- Nothing else changed, so nothing else is restored.

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
      NEW.clinical_difference              IS DISTINCT FROM OLD.clinical_difference              OR
      NEW.diagnosis_code                   IS DISTINCT FROM OLD.diagnosis_code                   OR
      NEW.diagnosis_text                   IS DISTINCT FROM OLD.diagnosis_text                   OR
      NEW.locked_at                        IS DISTINCT FROM OLD.locked_at
    ) THEN
      RAISE EXCEPTION 'Cannot modify snapshot fields after order is locked';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
