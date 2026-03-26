-- ============================================================
-- Clinic Admin & Stripe Onboarding — WO-30
-- ============================================================
--
-- REQ-CAD-005: RLS enforcement — no DELETE through RLS.
--   Explicit DENY policies make soft-delete-only intent unmistakable.
--   PostgreSQL denies by default but explicit policies are best practice
--   (mirrors the pattern used for catalog_history / order_status_history).
--
-- Tables covered: orders, patients, providers, clinics.
-- (catalog_history and order_status_history deny-delete already exists
--  in 20260317000004_create_rls_and_triggers.sql)

BEGIN;

-- Orders: soft-delete only (deleted_at) — REQ-CAD-005, REQ-OAS-010
CREATE POLICY orders_deny_delete ON orders
  FOR DELETE USING (false);

-- Patients: soft-delete only (deleted_at) — REQ-CAD-005
CREATE POLICY patients_deny_delete ON patients
  FOR DELETE USING (false);

-- Providers: soft-delete only (deleted_at) — REQ-CAD-005
CREATE POLICY providers_deny_delete ON providers
  FOR DELETE USING (false);

-- Clinics: soft-delete only (deleted_at) — REQ-CAD-005
CREATE POLICY clinics_deny_delete ON clinics
  FOR DELETE USING (false);

COMMIT;
