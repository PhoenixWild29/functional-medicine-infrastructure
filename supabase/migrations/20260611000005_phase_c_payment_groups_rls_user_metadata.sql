-- ============================================================
-- Phase C: fix payment_groups RLS to use the correct JWT path
-- ============================================================
--
-- Codex 2026-06-11 sweep, cross-PR observation:
--   The original Stage 1 migration (20260609000001) wrote the RLS
--   policies as `auth.jwt() ->> 'clinic_id'`. The codebase convention
--   established by 20260329000001 / 20260329000002 (and reaffirmed in
--   20260611000004 for the F-3 dashboard filter) is that the clinic_id
--   claim lives under user_metadata, so the correct path is
--       auth.jwt() -> 'user_metadata' ->> 'clinic_id'
--   With the wrong path, any session-client query against payment_groups
--   resolves zero rows. Server-side code that uses the service role
--   bypasses RLS and hasn't surfaced the bug, but the moment a clinic
--   dashboard or any session-tier read of payment_groups ships, it sees
--   an empty result.
--
-- This migration drops + recreates the three Stage 1 policies with the
-- correct user_metadata path. Idempotent via DROP POLICY IF EXISTS.
-- No data migration — policies only; rows are untouched.

DROP POLICY IF EXISTS payment_groups_clinic_user_select ON payment_groups;
DROP POLICY IF EXISTS payment_groups_clinic_user_insert ON payment_groups;
DROP POLICY IF EXISTS payment_groups_clinic_user_update ON payment_groups;

CREATE POLICY payment_groups_clinic_user_select ON payment_groups
  FOR SELECT TO authenticated
  USING (clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID);

CREATE POLICY payment_groups_clinic_user_insert ON payment_groups
  FOR INSERT TO authenticated
  WITH CHECK (clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID);

CREATE POLICY payment_groups_clinic_user_update ON payment_groups
  FOR UPDATE TO authenticated
  USING (clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID);

COMMENT ON POLICY payment_groups_clinic_user_select ON payment_groups IS
  'Phase C Stage 1 (corrected 2026-06-11): clinic-scoped SELECT via user_metadata JWT path. '
  'Replaces the original auth.jwt()->>clinic_id which was always NULL. '
  'See Codex 2026-06-11 sweep, cross-PR observation.';
