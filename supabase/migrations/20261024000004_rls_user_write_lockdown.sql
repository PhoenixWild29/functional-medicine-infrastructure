-- ============================================================
-- Security review L5: no writes with a user's JWT on clinic data
-- ============================================================
--
-- The tables below kept user write policies from before the app moved
-- every write behind its API routes. With the public anon key and a
-- clinic user's JWT (since self sign-up, any visitor's, for their own new
-- clinic) PostgREST accepted inserts and updates that skip the API's
-- approval guard and signing checks: orders (status, prices), patients,
-- providers, payment groups, provider NPI verifications and state licenses.
--
-- Every app write to these tables uses the service role, which bypasses
-- RLS and these grants (traced writer by writer on Oct 24: routes, crons,
-- webhooks, and every library that takes a client parameter, back to
-- createServiceClient; browser clients only read). So nothing in the app
-- changes. Every SELECT policy stays; the two *_admin_write policies were
-- FOR ALL, and reads stay covered by the *_clinic_select policies.
--
-- ops_admin_update_orders is left as it is: without the UPDATE grant it
-- no longer applies to authenticated; ops writes orders through the
-- service role.

BEGIN;

-- ── orders ───────────────────────────────────────────────────
DROP POLICY IF EXISTS orders_clinic_user_insert ON public.orders;
DROP POLICY IF EXISTS orders_clinic_user_update ON public.orders;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.orders FROM anon, authenticated;

-- ── patients ─────────────────────────────────────────────────
DROP POLICY IF EXISTS patients_clinic_user_insert ON public.patients;
DROP POLICY IF EXISTS patients_clinic_user_update ON public.patients;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.patients FROM anon, authenticated;

-- ── providers ────────────────────────────────────────────────
DROP POLICY IF EXISTS providers_clinic_user_insert ON public.providers;
DROP POLICY IF EXISTS providers_clinic_user_update ON public.providers;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.providers FROM anon, authenticated;

-- ── payment_groups ───────────────────────────────────────────
DROP POLICY IF EXISTS payment_groups_clinic_user_insert ON public.payment_groups;
DROP POLICY IF EXISTS payment_groups_clinic_user_update ON public.payment_groups;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.payment_groups FROM anon, authenticated;

-- ── provider_npi_verifications ───────────────────────────────
DROP POLICY IF EXISTS provider_npi_verifications_admin_write ON public.provider_npi_verifications;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.provider_npi_verifications FROM anon, authenticated;

-- ── provider_state_licenses ──────────────────────────────────
DROP POLICY IF EXISTS provider_state_licenses_admin_write ON public.provider_state_licenses;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.provider_state_licenses FROM anon, authenticated;

-- No table is created, but the call stays last so every table keeps the
-- restrictive pharmacy_admin_scope policy.
SELECT apply_pharmacy_admin_scope();

COMMIT;
