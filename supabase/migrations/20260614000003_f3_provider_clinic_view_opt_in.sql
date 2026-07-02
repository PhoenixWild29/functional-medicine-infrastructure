-- ============================================================
-- F-3 follow-up: provider opt-in "clinic view" toggle
-- ============================================================
--
-- Audit reference: docs/audits/role-audit-and-data-model.md §F-3
-- and the §10 resolution note (PR #87, 2026-06-11).
--
-- Context
-- ───────
-- The base F-3 migration (20260611000004_f3_dashboard_rls_filter.sql)
-- locked providers to their own orders inside their clinic. The audit's
-- original §F-3 spec called for a UX toggle — "default to my patients,
-- with an option to flip to all clinic orders." Option A deferred that
-- toggle because RLS, by itself, can't read "what view did the user
-- pick on this page-load."
--
-- This follow-up reintroduces the toggle as a SECOND, additive SELECT
-- policy gated on a per-request HTTP header. The provider's session
-- carries `x-provider-view-mode: clinic` only when the dashboard SSR
-- explicitly opts in (via query string `?view=clinic`). The default
-- view ("my patients") sends no extra header and is served by the
-- existing orders_role_aware_select policy from migration 4 — no
-- change to that policy here.
--
-- Why a header instead of a new app_role claim
-- ────────────────────────────────────────────
-- Supabase `user_metadata` is persistent — flipping a metadata field
-- would either require a write per toggle (slow, audit-noisy) or a
-- session re-mint. A request header is per-request, costs nothing,
-- and never persists past the SSR call. PostgREST surfaces the
-- incoming HTTP headers to PostgreSQL via the `request.headers` GUC,
-- which RLS policies can read with current_setting(...).
--
-- Visibility contract added by this migration (SELECT-only)
-- ─────────────────────────────────────────────────────────
--   provider + header `x-provider-view-mode = 'clinic'` →
--     every row in the provider's clinic_id (NOT cross-clinic)
--
-- All four pre-existing branches in orders_role_aware_select
-- (ops_admin / clinic_admin / medical_assistant / provider) are
-- untouched. RLS is a logical-OR of policies for the same FOR/role
-- pair, so this additive policy never reduces visibility — it only
-- widens it when the opt-in header is present.
--
-- Cross-clinic isolation
-- ──────────────────────
-- ABSOLUTE. The new policy still scopes by
--   clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID
-- A provider opting into clinic-view sees ALL orders in THEIR clinic
-- — never another clinic's. F-2 (signer identity at sign-and-send)
-- and the §F-3 base policy remain in force for any subsequent
-- INSERT/UPDATE on the rows surfaced here.
--
-- Header-reading idiom (PostgREST → Postgres)
-- ───────────────────────────────────────────
-- PostgREST sets the `request.headers` GUC to a JSON object with all
-- incoming HTTP headers (lower-cased). The safe read is:
--   nullif(current_setting('request.headers', true), '')::json
--     ->> 'x-provider-view-mode'
-- - second arg `true` → return NULL instead of erroring when the GUC
--   is unset (direct SQL, migrations, psql sessions).
-- - nullif('') → guards against the rare case where the GUC is set
--   to the empty string.
-- - cast to ::json then ->> name → returns the header VALUE as text
--   when present, NULL otherwise.
--
-- JWT path convention
-- ───────────────────
-- Per 20260329000001 / 20260329000002, role + clinic claims live
-- under user_metadata, not at the JWT root:
--     (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID
--     (auth.jwt() -> 'user_metadata' ->> 'app_role')::TEXT
--
-- Idempotency
-- ───────────
-- DROP POLICY IF EXISTS … then CREATE POLICY, same pattern as the
-- rest of the RLS migrations. Safe to apply twice.
--
-- Data migration
-- ──────────────
-- None. Policies only. Existing rows are untouched.
-- ============================================================

DROP POLICY IF EXISTS orders_provider_clinic_optin_select ON orders;

CREATE POLICY orders_provider_clinic_optin_select ON orders
  FOR SELECT TO authenticated
  USING (
    -- provider role only — every other role already has its own
    -- visibility branch in orders_role_aware_select and doesn't need
    -- this opt-in path.
    (auth.jwt() -> 'user_metadata' ->> 'app_role') = 'provider'
    AND
    -- cross-clinic isolation: still scoped to the provider's own clinic
    clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID
    AND
    -- per-request opt-in header. nullif guards against an empty GUC,
    -- `true` second arg makes current_setting() return NULL when the
    -- GUC isn't set at all (psql sessions, migrations).
    (
      nullif(current_setting('request.headers', true), '')::json
        ->> 'x-provider-view-mode'
    ) = 'clinic'
  );

COMMENT ON POLICY orders_provider_clinic_optin_select ON orders IS
  'F-3 follow-up (2026-06-14): provider opt-in clinic view. Additive '
  'SELECT policy gated on per-request header x-provider-view-mode=clinic. '
  'Cross-clinic isolation absolute — still scoped to JWT clinic_id. '
  'See docs/audits/role-audit-and-data-model.md §F-3.';
