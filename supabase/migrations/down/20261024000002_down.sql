-- Down migration for 20261024000002_treatment_proposals.sql
-- Atomic: either the whole rollback lands or none of it does.
--
-- Refuses while any proposal exists: proposals, their choices and their
-- audit events are part of the patient's record, not a migration's to
-- delete.

BEGIN;

DO $$
DECLARE
  proposals INTEGER;
BEGIN
  SELECT count(*) INTO proposals FROM treatment_proposals;
  IF proposals > 0 THEN
    RAISE EXCEPTION 'Cannot roll back 20261024000002: % treatment proposal(s) exist', proposals;
  END IF;
END $$;

DROP INDEX IF EXISTS idx_orders_proposal_option;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_orders_proposal_pair;
ALTER TABLE orders DROP COLUMN IF EXISTS proposal_option_id;
ALTER TABLE orders DROP COLUMN IF EXISTS proposal_required;

DROP TABLE IF EXISTS treatment_proposal_events;
DROP TABLE IF EXISTS proposal_choice_items;
ALTER TABLE IF EXISTS treatment_proposals DROP CONSTRAINT IF EXISTS fk_treatment_proposals_chosen_option;
DROP TABLE IF EXISTS treatment_proposal_options;
DROP TABLE IF EXISTS treatment_proposals;

DROP FUNCTION IF EXISTS proposals_append_only();

COMMIT;
