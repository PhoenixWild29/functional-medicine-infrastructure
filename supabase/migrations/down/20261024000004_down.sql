-- Down migration for 20261024000004_rls_user_write_lockdown.sql
-- Atomic: either the whole rollback lands or none of it does.
--
-- Restores the ten user write policies exactly as they stood (pg_policies
-- on a database built from every migration up to 20261024000003) and the
-- default write grants. Rolling back reopens the PostgREST write path the
-- up migration describes.

BEGIN;

-- ── orders ───────────────────────────────────────────────────
DROP POLICY IF EXISTS orders_clinic_user_insert ON public.orders;
CREATE POLICY orders_clinic_user_insert ON public.orders FOR INSERT TO authenticated
  WITH CHECK (clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID);
DROP POLICY IF EXISTS orders_clinic_user_update ON public.orders;
CREATE POLICY orders_clinic_user_update ON public.orders FOR UPDATE TO authenticated
  USING (clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID);
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.orders TO anon, authenticated;

-- ── patients ─────────────────────────────────────────────────
DROP POLICY IF EXISTS patients_clinic_user_insert ON public.patients;
CREATE POLICY patients_clinic_user_insert ON public.patients FOR INSERT TO authenticated
  WITH CHECK (clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID);
DROP POLICY IF EXISTS patients_clinic_user_update ON public.patients;
CREATE POLICY patients_clinic_user_update ON public.patients FOR UPDATE TO authenticated
  USING (clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID);
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.patients TO anon, authenticated;

-- ── providers ────────────────────────────────────────────────
-- providers_clinic_user_insert read the top-level clinic_id claim (it was
-- never moved to app_metadata); restored as it was.
DROP POLICY IF EXISTS providers_clinic_user_insert ON public.providers;
CREATE POLICY providers_clinic_user_insert ON public.providers FOR INSERT TO authenticated
  WITH CHECK (clinic_id = (auth.jwt() ->> 'clinic_id')::UUID);
DROP POLICY IF EXISTS providers_clinic_user_update ON public.providers;
CREATE POLICY providers_clinic_user_update ON public.providers FOR UPDATE TO authenticated
  USING (clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID);
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.providers TO anon, authenticated;

-- ── payment_groups ───────────────────────────────────────────
DROP POLICY IF EXISTS payment_groups_clinic_user_insert ON public.payment_groups;
CREATE POLICY payment_groups_clinic_user_insert ON public.payment_groups FOR INSERT TO authenticated
  WITH CHECK (clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID);
DROP POLICY IF EXISTS payment_groups_clinic_user_update ON public.payment_groups;
CREATE POLICY payment_groups_clinic_user_update ON public.payment_groups FOR UPDATE TO authenticated
  USING (clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID);
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.payment_groups TO anon, authenticated;

-- ── provider_npi_verifications ───────────────────────────────
DROP POLICY IF EXISTS provider_npi_verifications_admin_write ON public.provider_npi_verifications;
CREATE POLICY provider_npi_verifications_admin_write ON public.provider_npi_verifications FOR ALL TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'app_role') = 'clinic_admin'
    AND provider_id IN (SELECT providers.provider_id FROM providers WHERE providers.clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID)
  )
  WITH CHECK (
    (auth.jwt() -> 'app_metadata' ->> 'app_role') = 'clinic_admin'
    AND provider_id IN (SELECT providers.provider_id FROM providers WHERE providers.clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID)
  );
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.provider_npi_verifications TO anon, authenticated;

-- ── provider_state_licenses ──────────────────────────────────
DROP POLICY IF EXISTS provider_state_licenses_admin_write ON public.provider_state_licenses;
CREATE POLICY provider_state_licenses_admin_write ON public.provider_state_licenses FOR ALL TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'app_role') = 'clinic_admin'
    AND provider_id IN (SELECT providers.provider_id FROM providers WHERE providers.clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID)
  )
  WITH CHECK (
    (auth.jwt() -> 'app_metadata' ->> 'app_role') = 'clinic_admin'
    AND provider_id IN (SELECT providers.provider_id FROM providers WHERE providers.clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID)
  );
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.provider_state_licenses TO anon, authenticated;

SELECT apply_pharmacy_admin_scope();

COMMIT;
