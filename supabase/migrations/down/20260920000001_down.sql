-- Down migration for 20260920000001_wo105_titration_steps.sql
-- Atomic: either the whole rollback lands or none of it does.
--
-- Drops the WO-105 columns and their constraints. Any titration schedule
-- entered after the migration is lost with them: the generated summary
-- sentence in orders.sig_text is all that survives, which is the
-- pre-WO-105 state. Nothing else read these columns, so no other object
-- depends on them.

BEGIN;

ALTER TABLE provider_favorites DROP CONSTRAINT IF EXISTS chk_provider_favorites_titration_steps_array;
ALTER TABLE provider_favorites DROP COLUMN IF EXISTS titration_steps;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_orders_titration_steps_mode;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_orders_titration_steps_array;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_orders_sig_mode;
ALTER TABLE orders DROP COLUMN IF EXISTS titration_steps;
ALTER TABLE orders DROP COLUMN IF EXISTS sig_mode;

COMMIT;
