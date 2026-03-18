-- ============================================================
-- WO-20 Review Fix: Portal status poll tracking + bucket access
-- ============================================================
--
-- BUG-02: Add portal_last_polled_at to adapter_submissions so the
-- portal-status-poll cron can throttle per-order polls correctly using
-- actual last-polled time instead of submission creation time.
--
-- NB-10: Add PERMISSIVE SELECT policy for ops_admin to view error
-- screenshots in adapter-screenshots (required for MANUAL_REVIEW workflow).

ALTER TABLE adapter_submissions
  ADD COLUMN IF NOT EXISTS portal_last_polled_at TIMESTAMPTZ;

-- ops_admin SELECT access to adapter-screenshots bucket
-- service_role bypasses RLS; this policy allows ops dashboard users to
-- retrieve screenshots for MANUAL_REVIEW handling (REQ-PTA-004).
-- auth.jwt() ->> 'role' uses the custom claim set by the app on login.
CREATE POLICY "adapter-screenshots: ops_admin read"
  ON storage.objects
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'adapter-screenshots'
    AND (auth.jwt() ->> 'role') = 'ops_admin'
  );
