-- DOWN: 20260319000011_wo36_fax_triage.sql
-- NOTE: Postgres does not support removing values from an enum type.
-- The fax_queue_status_enum values PROCESSING, ERROR, PROCESSED, ARCHIVED
-- added by this migration cannot be removed without dropping and recreating
-- the enum and all columns that reference it.
-- This down migration is a no-op. To fully roll back, recreate the enum
-- from scratch (see 20260317000001_down.sql as reference).
DO $$ BEGIN END $$; -- no-op: enum values cannot be removed from fax_queue_status_enum
