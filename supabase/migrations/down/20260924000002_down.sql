-- Down migration for 20260924000002_cycling_pattern_constraints.sql
--
-- Nothing to undo on its own: it re-adds 20260924000001's constraints in
-- their corrected form. 20260924000001's down migration drops them.

BEGIN;
COMMIT;
