-- Down migration for 20261024000012_rls_require_aal2.sql
-- Atomic: either the whole rollback lands or none of it does.
--
-- Removes the staff_mfa_aal2 policy from every table that has it, then the
-- two functions and the switch table. PostgREST is then back to the
-- middleware-only MFA gate (HIPAA B3 open again). Nothing else changed.

BEGIN;

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_policies WHERE schemaname = 'public' AND policyname = 'staff_mfa_aal2' LOOP
    EXECUTE format('DROP POLICY IF EXISTS staff_mfa_aal2 ON public.%I', t);
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS public.apply_staff_mfa_scope();
DROP FUNCTION IF EXISTS public.staff_mfa_satisfied();
DROP TABLE IF EXISTS public.security_settings;

COMMIT;
