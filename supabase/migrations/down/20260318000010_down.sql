-- DOWN: 20260318000010_wo22_fax_retry_tracking.sql
-- Removes fax_attempt_count from orders, index, and prescription-pdfs storage bucket.
-- NOTE: Deleting the bucket will fail if it contains objects. Ensure the bucket is
-- empty before running this down migration in production.
-- Wrapped in a transaction so that a bucket-delete failure rolls back the column/index drops.

BEGIN;

DROP INDEX IF EXISTS idx_orders_fax_retry_candidates;
ALTER TABLE orders DROP COLUMN IF EXISTS fax_attempt_count;
DELETE FROM storage.buckets WHERE id = 'prescription-pdfs';

COMMIT;
