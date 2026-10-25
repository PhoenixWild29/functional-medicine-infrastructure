-- Down migration for 20261024000001_rls_hardening.sql
-- Atomic: either the whole rollback lands or none of it does.
--
-- Restores the clinic_user UPDATE policy (app_metadata, as 20261010000001
-- left it), the default write grants and the old search_path. Rolling back
-- reopens the self-approval path described in the up migration.

BEGIN;

DROP POLICY IF EXISTS clinics_clinic_user_update ON public.clinics;
CREATE POLICY clinics_clinic_user_update ON public.clinics FOR UPDATE TO authenticated
  USING (clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID);
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.clinics TO anon, authenticated;

GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.clinic_signup_links TO authenticated;

ALTER FUNCTION public.clinic_team_members(uuid) SET search_path = public, pg_catalog;
ALTER FUNCTION public.set_clinic_member_active(uuid, uuid, boolean, uuid) SET search_path = public, pg_catalog;

SELECT apply_pharmacy_admin_scope();

COMMIT;
