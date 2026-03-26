-- DOWN: 20260318000014_wo20_portal_review_fixes.sql
-- Removes portal_last_polled_at from adapter_submissions and drops the
-- ops_admin SELECT policy on the adapter-screenshots bucket.

DROP POLICY IF EXISTS "adapter-screenshots: ops_admin read" ON storage.objects;
ALTER TABLE adapter_submissions DROP COLUMN IF EXISTS portal_last_polled_at;
