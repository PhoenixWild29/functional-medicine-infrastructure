-- ============================================================
-- F-1: Link providers to auth.users
-- ============================================================
--
-- Adds providers.user_id so the application can verify
-- "the signed-in user IS this provider." This is the
-- prerequisite for:
--   - F-2: EPCS sign-and-send signer enforcement
--   - F-3: per-provider RBAC (e.g. "my patients" filter)
--   - Phase C: same-provider multi-Rx checkout cart
--     (the cart endpoint must confirm all orders share one
--      provider and that provider is the calling session).
--
-- ── Backfill design ─────────────────────────────────────────
-- auth.users IDs are non-deterministic — they're minted by
-- Supabase Auth (createUser), not by migrations — so the
-- provider→user link CANNOT be hardcoded here. The link is
-- established in scripts/seed-poc.ts (linkProviderToAuthUser),
-- which runs after both the auth user and the provider row
-- exist. For a real (non-POC) clinic, the link is set at
-- provider-onboarding time by application code.
--
-- This migration is purely additive and non-behavioral:
-- nothing reads user_id until F-2 ships. Safe to apply ahead
-- of the enforcement change.
-- ============================================================

ALTER TABLE providers
  ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN providers.user_id IS
  'FK to auth.users — the Supabase Auth identity that IS this provider. '
  'Nullable: a provider row may exist before its login is provisioned. '
  'Set at seed/onboarding time, not in migrations (auth UIDs are non-deterministic).';

-- At most one provider row per auth user, among non-deleted rows.
-- Partial index mirrors the existing providers_npi_number_unique pattern.
CREATE UNIQUE INDEX providers_user_id_unique
  ON providers (user_id)
  WHERE user_id IS NOT NULL AND deleted_at IS NULL;

-- NB: no new RLS policy needed. The existing
-- providers_clinic_user_select policy already lets a clinic user
-- read every provider row in their clinic (filtered by clinic_id
-- JWT claim), which includes their own row. The app resolves
-- "which provider am I" via:
--   SELECT provider_id FROM providers
--   WHERE user_id = auth.uid() AND clinic_id = <jwt clinic_id>
