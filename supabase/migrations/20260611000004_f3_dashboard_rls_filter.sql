-- ============================================================
-- F-3: Role-aware dashboard RLS filter on `orders` (Option A)
-- ============================================================
--
-- Audit reference: docs/audits/role-audit-and-data-model.md §F-3.
-- User choice: Option A — enforce at the database tier via RLS, so
-- the filter holds regardless of which client/code path queries
-- `orders` (server components, client browser session, route handlers).
--
-- Visibility contract (SELECT-only):
--   ops_admin            → every row, cross-clinic
--   clinic_admin         → every row in their clinic_id
--   medical_assistant    → every row in their clinic_id
--   provider             → only rows in their clinic where
--                          orders.provider_id matches the providers
--                          row whose user_id = auth.uid()
--
-- This realises the F-3 spec ("provider's /dashboard defaults to my
-- patients"). RLS is a hard filter — there is no "toggle to all
-- clinic orders" for providers under Option A. That's intentional:
-- the audit's toggle was a UX nicety appropriate to an app-tier
-- filter; at the DB tier the policy is the contract. If a future
-- requirement reintroduces the toggle, it must come with a
-- second policy or an explicit grant tied to a new app_role claim.
--
-- ── Pre-requisites ──────────────────────────────────────────
-- F-1 (20260528000001) added providers.user_id so we can resolve
-- "which providers row is this auth user." This migration relies
-- on that column and on providers_user_id_unique.
--
-- ── JWT path convention ─────────────────────────────────────
-- Per 20260329000001 / 20260329000002, role + clinic claims live
-- under user_metadata, not at the JWT root:
--     (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID
--     (auth.jwt() -> 'user_metadata' ->> 'app_role')::TEXT
--
-- ── Idempotency ─────────────────────────────────────────────
-- DROP POLICY IF EXISTS … then CREATE POLICY, matching the
-- pattern used in 20260329000001 / 20260329000002. Safe to apply
-- twice.
--
-- ── Data migration ──────────────────────────────────────────
-- None. Policies only. Existing rows are untouched.
-- ============================================================

-- Old policy (clinic-scoped only) is superseded by the role-aware one.
-- We replace the SELECT policy. INSERT/UPDATE policies stay as they
-- were — F-3 is a read-side concern; write-side scoping is handled by
-- the existing clinic-id checks plus F-2 signer-identity enforcement.
DROP POLICY IF EXISTS orders_clinic_user_select ON orders;
DROP POLICY IF EXISTS orders_role_aware_select  ON orders;

CREATE POLICY orders_role_aware_select ON orders
  FOR SELECT TO authenticated
  USING (
    -- ops_admin: cross-clinic visibility (matches the existing
    -- ops_admin_read_all_orders policy on service_role; we extend the
    -- same visibility to authenticated sessions carrying the claim so
    -- the ops dashboard works with the anon-key + session client too).
    (auth.jwt() -> 'user_metadata' ->> 'app_role') = 'ops_admin'
    OR
    -- clinic_admin and medical_assistant: every order in their clinic.
    (
      (auth.jwt() -> 'user_metadata' ->> 'app_role') IN ('clinic_admin', 'medical_assistant')
      AND clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID
    )
    OR
    -- provider: only their own orders within their clinic. We resolve
    -- "my provider_id" via the F-1 providers.user_id link to auth.uid().
    -- Filtering by clinic_id as well as the EXISTS keeps cross-clinic
    -- isolation absolute even if a stale provider row from another
    -- clinic were somehow linked to the same auth user.
    (
      (auth.jwt() -> 'user_metadata' ->> 'app_role') = 'provider'
      AND clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID
      AND EXISTS (
        SELECT 1
          FROM providers p
         WHERE p.provider_id = orders.provider_id
           AND p.user_id     = auth.uid()
           AND p.clinic_id   = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID
           AND p.deleted_at IS NULL
      )
    )
  );

COMMENT ON POLICY orders_role_aware_select ON orders IS
  'F-3 (2026-06-11): role-aware SELECT — ops_admin cross-clinic; '
  'clinic_admin + medical_assistant per-clinic; provider only their own. '
  'Replaces orders_clinic_user_select. See docs/audits/role-audit-and-data-model.md §F-3.';
