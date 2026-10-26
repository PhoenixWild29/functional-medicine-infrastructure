-- ============================================================
-- MFA in RLS: staff need aal2 to touch PHI (HIPAA B3)
-- ============================================================
--
-- C's evidence map (2026-10-25), gap B3: MFA was enforced only in the
-- Next.js middleware. A staff session at aal1 (password only) could read
-- PHI straight from PostgREST with the public anon key. This adds a
-- RESTRICTIVE policy, staff_mfa_aal2, for `authenticated`, on every PHI
-- table (STAFF_MFA_PHI_TABLES in src/lib/auth/staff-mfa-rls.ts; a test
-- holds the two lists equal). RESTRICTIVE policies are ANDed with the
-- permissive ones, so nothing anyone may do today is widened.
--
-- The rule (the app's, src/lib/auth/mfa.ts, made stricter at the database):
--   - aal2 (the JWT's aal claim): passes;
--   - pharmacy_admin (ALWAYS_MFA_ROLES): always needs aal2;
--   - every other `authenticated` JWT needs aal2 only when the database
--     switch is on. That includes a JWT with no app_role or one the list
--     does not know: patients never hold a Supabase session (every account
--     is a staff account made with the service role, lib/auth/create-
--     login), so an aal1 JWT with no recognised role is a mis-provisioned
--     account, a role renamed in one place only, or a public sign-up, and
--     must not read PHI on a clinic_id alone (B's review, F1).
--
-- The policy calls the function as (SELECT public.staff_mfa_satisfied()),
-- so Postgres plans it as an InitPlan and runs it once per statement, not
-- once per row (it takes no row input; B's review, F2).
--
-- The switch. Postgres cannot see REQUIRE_MFA, so it is a one-row table,
-- public.security_settings (require_staff_mfa, default false: as the app
-- today). No API role can read or write it; staff_mfa_satisfied() is
-- SECURITY DEFINER and reads it on their behalf. A missing row counts as
-- on (fail closed). Sam flips it with one statement in the SQL editor:
--
--   UPDATE public.security_settings SET require_staff_mfa = true, updated_at = now() WHERE id = 1;
--
-- together with REQUIRE_MFA=true in Vercel, so the app sends aal1 users to
-- enrollment / the challenge instead of showing them empty pages.
-- MFA_ENFORCED_EMAILS (per account) stays app-only.
--
-- Not affected: the service role (BYPASSRLS): patients' token pages
-- (checkout, intake, plan, join), crons and webhooks; anon.
--
-- apply_staff_mfa_scope() (re)creates the policy on each listed table that
-- exists, so a later migration that adds a PHI table extends the list there
-- and runs it again. It creates a table, so apply_pharmacy_admin_scope()
-- (20261014000001) is the last statement before COMMIT.
--
-- PREPARED and DECISION-GATED: Sam has not decided REQUIRE_MFA for all
-- staff. With the switch off (the default) this changes only
-- pharmacy_admin, which the app already always requires. Sorts after
-- 20261024000011 (order-transmission-integrity).

BEGIN;

-- ── 1. The switch ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.security_settings (
  id                smallint    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  require_staff_mfa boolean     NOT NULL DEFAULT false,
  updated_at        timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.security_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.security_settings IS
  'HIPAA B3: one row. require_staff_mfa: every authenticated session needs aal2 (MFA) to touch PHI through PostgREST; pharmacy_admin always does. Flip together with REQUIRE_MFA. No API role can read or write it.';

ALTER TABLE public.security_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.security_settings FROM PUBLIC, anon, authenticated;

-- ── 2. The rule ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.staff_mfa_satisfied() RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  always_roles CONSTANT text[] := ARRAY['pharmacy_admin'];
  app_role text := auth.jwt() -> 'app_metadata' ->> 'app_role';
BEGIN
  IF (auth.jwt() ->> 'aal') = 'aal2' THEN
    RETURN true;
  END IF;
  IF app_role = ANY (always_roles) THEN
    RETURN false;
  END IF;
  RETURN NOT coalesce((SELECT s.require_staff_mfa FROM public.security_settings s WHERE s.id = 1), true);
END;
$$;

REVOKE ALL ON FUNCTION public.staff_mfa_satisfied() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_mfa_satisfied() TO authenticated, service_role;

-- ── 3. The policy on every PHI table ─────────────────────────
CREATE OR REPLACE FUNCTION public.apply_staff_mfa_scope() RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  phi_tables CONSTANT text[] := ARRAY[
    'patients', 'orders', 'order_status_history', 'order_clarifications', 'clinic_notifications',
    'adapter_submissions', 'adapter_submission_debug_payloads', 'sms_log', 'webhook_events',
    'pharmacy_webhook_events', 'inbound_fax_queue', 'payment_groups', 'phi_access_log', 'epcs_audit_log',
    'provider_favorites', 'protocol_instances', 'patient_protocol_phases', 'phase_advancement_history',
    'patient_external_ids', 'patient_field_changes', 'patient_import_batches', 'patient_intake_links',
    'ehr_sync_events', 'treatment_proposals', 'treatment_proposal_options', 'treatment_proposal_events',
    'proposal_choice_items', 'saved_clinical_statements', 'order_sla_deadlines'
  ];
  t text;
BEGIN
  FOREACH t IN ARRAY phi_tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('DROP POLICY IF EXISTS staff_mfa_aal2 ON public.%I', t);
    EXECUTE format('CREATE POLICY staff_mfa_aal2 ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.staff_mfa_satisfied())) WITH CHECK ((SELECT public.staff_mfa_satisfied()))', t);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_staff_mfa_scope() FROM PUBLIC, anon, authenticated;

SELECT public.apply_staff_mfa_scope();

SELECT apply_pharmacy_admin_scope();

COMMIT;
