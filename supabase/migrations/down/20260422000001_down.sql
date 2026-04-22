-- Down-migration for PR #7a GIN index on adapter_submissions.metadata.
-- Dropping the index is a no-op on data (metadata column itself was
-- added in 20260318000009_wo46_adapter_audit_trail.sql and is not
-- touched here).

DROP INDEX IF EXISTS adapter_submissions_metadata_gin;
