-- ============================================================
-- Security review, Oct 24: RLS and grant hardening
-- ============================================================
--
-- 1. clinics: no writes with a user's JWT.
--    clinics_clinic_user_update (Mar 2026, moved to app_metadata on Oct 10)
--    let any authenticated user UPDATE every column of their own clinic
--    through PostgREST. Since self sign-up (20261020000001) any visitor gets
--    a clinic_admin JWT for a new, unapproved clinic, so with the public
--    anon key they could PATCH their clinic to is_active = true,
--    onboarding_status = 'approved' (the approval guard's only inputs) and
--    any stripe_connect_account_id / stripe_connect_status, skipping ops
--    review. Every clinics write in the app uses the service role, which
--    bypasses RLS and grants, so nothing in the app changes. SELECT stays.
--
-- 2. clinic_signup_links: authenticated keeps SELECT only. RLS already
--    refused its row writes (no write policy); TRUNCATE ignores RLS.
--
-- 3. clinic_team_members, set_clinic_member_active (SECURITY DEFINER):
--    resolve pg_catalog before public, so an object created in public can
--    never shadow a built-in they call (count, btrim, hashtextextended,
--    pg_advisory_xact_lock). EXECUTE stays service_role only.

BEGIN;

-- ── 1. clinics ───────────────────────────────────────────────
DROP POLICY IF EXISTS clinics_clinic_user_update ON public.clinics;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.clinics FROM anon, authenticated;

-- ── 2. clinic_signup_links ───────────────────────────────────
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.clinic_signup_links FROM authenticated;

-- ── 3. SECURITY DEFINER search_path ──────────────────────────
ALTER FUNCTION public.clinic_team_members(uuid) SET search_path = pg_catalog, public;
ALTER FUNCTION public.set_clinic_member_active(uuid, uuid, boolean, uuid) SET search_path = pg_catalog, public;

-- No table is created, but the call stays last so every table keeps the
-- restrictive pharmacy_admin_scope policy.
SELECT apply_pharmacy_admin_scope();

COMMIT;
