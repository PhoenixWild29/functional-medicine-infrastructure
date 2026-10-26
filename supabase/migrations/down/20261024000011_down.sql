-- Down migration for 20261024000011_order_signing_snapshots.sql
-- Atomic: either the whole rollback lands or none of it does.
--
-- Refuses while any order carries a snapshot: they are part of what the
-- provider signed, and an order signed with them cannot be sent without
-- them (the send guard refuses it). Revert the app code first.

BEGIN;

DO $$
DECLARE
  kept INTEGER;
BEGIN
  SELECT count(*) INTO kept FROM orders WHERE patient_snapshot IS NOT NULL OR prescriber_snapshot IS NOT NULL;
  IF kept > 0 THEN
    RAISE EXCEPTION 'Cannot roll back 20261024000011: % order(s) carry signing snapshots', kept;
  END IF;
END $$;

ALTER TABLE orders
  DROP COLUMN IF EXISTS prescriber_snapshot,
  DROP COLUMN IF EXISTS patient_snapshot;

COMMIT;
