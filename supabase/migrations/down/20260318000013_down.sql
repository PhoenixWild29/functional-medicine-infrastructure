-- DOWN: 20260318000013_wo20_tier2_portal.sql
-- Removes selectors column from pharmacy_portal_configs, the RESTRICTIVE RLS policy
-- on storage.objects for adapter-screenshots, and the adapter-screenshots bucket.
-- NOTE: Deleting the bucket will fail if it contains objects. Ensure the bucket is
-- empty before running this down migration in production.
-- NOTE: Roll back 20260318000014_down.sql first to remove the ops_admin SELECT policy
-- before deleting the bucket; otherwise an orphaned storage policy will remain.
-- Wrapped in a transaction so that a bucket-delete failure rolls back the column/policy drops.

BEGIN;

DROP POLICY IF EXISTS "adapter-screenshots: deny authenticated access" ON storage.objects;
ALTER TABLE pharmacy_portal_configs DROP COLUMN IF EXISTS selectors;
DELETE FROM storage.buckets WHERE id = 'adapter-screenshots';

COMMIT;
