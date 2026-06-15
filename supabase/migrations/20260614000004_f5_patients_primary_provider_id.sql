-- ============================================================
-- F-5: patients.primary_provider_id
-- ============================================================
--
-- Audit reference: docs/audits/role-audit-and-data-model.md §F-5.
--
-- Pre-F-5, the patient→provider relationship was implicit-only,
-- derived from SELECT DISTINCT provider_id FROM orders WHERE
-- patient_id = X. That's fine for "who has Rx'd this patient,"
-- but it blocks a few real use cases the audit flagged:
--
--   * "Set Dr. Chen as patient Y's primary provider" — no
--     place to store it today.
--   * "Patient transfers from Dr. Chen to Dr. Patel" — order
--     history correctly references Dr. Chen, but there's no
--     clean way to indicate Dr. Patel is the current PCP.
--   * "Show me all of Dr. Patel's primary patients, including
--     ones he hasn't prescribed for yet" — impossible while
--     the relationship is order-derived.
--
-- This migration adds a single nullable column. It is purely
-- additive and non-behavioral on its own:
--   * Existing rows are untouched (column starts NULL).
--   * No backfill — the value gets populated lazily by the
--     create-order path (src/app/api/orders/route.ts), which
--     sets primary_provider_id on first order from the patient
--     IF the column is still NULL. Reassignment is a UX
--     decision, not a side-effect of order creation.
--
-- ── Pre-requisites ──────────────────────────────────────────
-- None. The FK targets providers(provider_id), which has
-- existed since the first schema migration.
--
-- ── Idempotency ─────────────────────────────────────────────
-- ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS. Safe
-- to apply twice. Matches the pattern used in earlier F-series
-- migrations.
--
-- ── RLS ─────────────────────────────────────────────────────
-- No new policy. The existing patient SELECT/UPDATE policies
-- already gate by clinic_id, which covers the new column for
-- free. F-3's order-side policy is unaffected — this column
-- lives on patients, not orders.
-- ============================================================

ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS primary_provider_id UUID NULL
    REFERENCES providers(provider_id) ON DELETE SET NULL;

COMMENT ON COLUMN patients.primary_provider_id IS
  'F-5 (2026-06-14): the providers row currently treating this patient as PCP. '
  'Nullable: a patient may exist without an assigned primary provider. '
  'Set lazily by create-order (only if currently NULL) — never overwritten '
  'by order creation. Reassignment is an explicit UX action. '
  'ON DELETE SET NULL: a deleted provider does not orphan their patients. '
  'See docs/audits/role-audit-and-data-model.md §F-5.';

-- Reverse-lookup index: "all of provider P's primary patients."
-- Partial — only NON-NULL values, matching the providers_user_id_unique
-- pattern from 20260528000001_f1_providers_user_id.sql. We don't index
-- the NULL rows (no reverse lookup ever needs them) so the index stays
-- small on existing patient tables where most rows start NULL.
CREATE INDEX IF NOT EXISTS patients_primary_provider_id_idx
  ON patients (primary_provider_id)
  WHERE primary_provider_id IS NOT NULL;
