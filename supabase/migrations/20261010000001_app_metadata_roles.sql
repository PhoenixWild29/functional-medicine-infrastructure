-- ============================================================
-- Role and clinic move from user_metadata to app_metadata
-- ============================================================
--
-- SECURITY. app_role and clinic_id were read from user_metadata (in the
-- JWT as auth.jwt() -> 'user_metadata', in auth.users as
-- raw_user_meta_data). Any signed-in user can rewrite their own
-- user_metadata with supabase.auth.updateUser(), so a provider could make
-- themselves clinic_admin, or point clinic_id at another clinic, and pass
-- RLS. app_metadata (raw_app_meta_data) is writable only with the service
-- role, and Supabase puts it in the JWT as app_metadata.
--
-- 1. Backfill: copy app_role and clinic_id from raw_user_meta_data into
--    raw_app_meta_data for every auth user that has them. A value already
--    in app_metadata wins (re-running is a no-op). For a user linked to an
--    active providers row, clinic_id is taken from providers.clinic_id,
--    the table of record, overriding a self-edited value. Counts are
--    reported with RAISE NOTICE.
-- 2. Every live RLS policy that read user_metadata / raw_user_meta_data is
--    rewritten in place (ALTER POLICY) to read app_metadata. Expressions
--    are otherwise unchanged. The seven that selected raw_user_meta_data
--    from auth.users now read the JWT claim, like every other policy
--    (authenticated has no SELECT grant on auth.users).
-- 3. A final check fails the migration if any policy or function in the
--    public schema still reads user_metadata or raw_user_meta_data
--    (drift from migrations included).
--
-- No SQL function in public read user_metadata; none is changed.
-- user_metadata itself is left as is (display data such as full_name
-- stays there; the old role keys are now ignored).
--
-- Existing sessions: a JWT minted before this runs has no app_metadata
-- role, so its RLS reads match nothing until the token refreshes (within
-- the access-token lifetime, 1 hour) or the user signs in again.
--
-- Policies rewritten (43):
--   public.adapter_submissions           adapter_submissions_clinic_user_select
--   public.adapter_submissions           ops_admin_read_all_submissions
--   public.clinic_notifications          clinic_staff_read_own_notifications
--   public.clinics                       clinics_clinic_user_select
--   public.clinics                       clinics_clinic_user_update
--   public.dispute_orders                dispute_orders_clinic_user_select
--   public.disputes                      disputes_clinic_user_select
--   public.epcs_audit_log                epcs_audit_read
--   public.inbound_fax_queue             inbound_fax_queue_ops_admin_select
--   public.order_clarifications          Authenticated users can read clinic order clarifications
--   public.order_sla_deadlines           ops_admin_read_all_sla
--   public.order_sla_deadlines           ops_admin_update_sla
--   public.order_sla_deadlines           order_sla_deadlines_clinic_user_select
--   public.order_status_history          ops_admin_read_all_history
--   public.order_status_history          order_status_history_clinic_user_select
--   public.orders                        ops_admin_read_all_orders
--   public.orders                        ops_admin_update_orders
--   public.orders                        orders_clinic_user_insert
--   public.orders                        orders_clinic_user_update
--   public.orders                        orders_provider_clinic_optin_select
--   public.orders                        orders_role_aware_select
--   public.patient_protocol_phases       patient_protocol_read
--   public.patients                      patients_clinic_user_insert
--   public.patients                      patients_clinic_user_select
--   public.patients                      patients_clinic_user_update
--   public.payment_groups                payment_groups_clinic_user_insert
--   public.payment_groups                payment_groups_clinic_user_select
--   public.payment_groups                payment_groups_clinic_user_update
--   public.phase_advancement_history     phase_history_read
--   public.phi_access_log                phi_access_log_clinic_admin_select
--   public.protocol_instances            Authenticated users can read clinic protocol instances
--   public.protocol_items                Authenticated users can read protocol items
--   public.protocol_template_versions    Authenticated users can read protocol versions
--   public.protocol_templates            Authenticated users can read clinic protocols
--   public.provider_favorites            Authenticated users can read favorites
--   public.provider_npi_verifications    provider_npi_verifications_admin_write
--   public.provider_npi_verifications    provider_npi_verifications_clinic_select
--   public.provider_state_licenses       provider_state_licenses_admin_write
--   public.provider_state_licenses       provider_state_licenses_clinic_select
--   public.providers                     providers_clinic_user_select
--   public.providers                     providers_clinic_user_update
--   public.sms_log                       sms_log_clinic_user_select
--   public.transfer_failures             transfer_failures_clinic_user_select

-- ── 1. Backfill raw_app_meta_data ─────────────────────────────
DO $$
DECLARE
  copied     integer;
  overridden integer;
BEGIN
  UPDATE auth.users u
     SET raw_app_meta_data =
           jsonb_strip_nulls(jsonb_build_object(
             'app_role',  u.raw_user_meta_data -> 'app_role',
             'clinic_id', u.raw_user_meta_data -> 'clinic_id'))
           || COALESCE(u.raw_app_meta_data, '{}'::jsonb)
   WHERE u.raw_user_meta_data ?| ARRAY['app_role', 'clinic_id'];
  GET DIAGNOSTICS copied = ROW_COUNT;

  UPDATE auth.users u
     SET raw_app_meta_data = COALESCE(u.raw_app_meta_data, '{}'::jsonb)
                             || jsonb_build_object('clinic_id', p.clinic_id::text)
    FROM providers p
   WHERE p.user_id = u.id
     AND p.deleted_at IS NULL
     AND (u.raw_app_meta_data ->> 'clinic_id') IS DISTINCT FROM p.clinic_id::text;
  GET DIAGNOSTICS overridden = ROW_COUNT;

  RAISE NOTICE 'app_metadata backfill: % user(s) copied, % provider login(s) given their providers.clinic_id', copied, overridden;
END $$;

-- ── 2. Policies read app_metadata ──────────────────────────────
ALTER POLICY adapter_submissions_clinic_user_select ON public.adapter_submissions
  USING (order_id IN (SELECT order_id FROM orders WHERE clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID));

ALTER POLICY ops_admin_read_all_submissions ON public.adapter_submissions
  USING ((auth.jwt() -> 'app_metadata' ->> 'app_role') = 'ops_admin');

ALTER POLICY clinic_staff_read_own_notifications ON public.clinic_notifications
  USING (clinic_id = ((auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID));

ALTER POLICY clinics_clinic_user_select ON public.clinics
  USING (clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID);

ALTER POLICY clinics_clinic_user_update ON public.clinics
  USING (clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID);

ALTER POLICY dispute_orders_clinic_user_select ON public.dispute_orders
  USING (order_id IN (SELECT order_id FROM orders WHERE clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID));

ALTER POLICY disputes_clinic_user_select ON public.disputes
  USING (order_id IN (SELECT order_id FROM orders WHERE clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID));

ALTER POLICY epcs_audit_read ON public.epcs_audit_log
  USING (provider_id IN (SELECT provider_id FROM providers WHERE clinic_id = ((auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID)));

ALTER POLICY inbound_fax_queue_ops_admin_select ON public.inbound_fax_queue
  USING ((auth.jwt() -> 'app_metadata' ->> 'app_role') = 'ops_admin');

ALTER POLICY "Authenticated users can read clinic order clarifications" ON public.order_clarifications
  USING (order_id IN (SELECT order_id FROM orders WHERE clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID));

ALTER POLICY ops_admin_read_all_sla ON public.order_sla_deadlines
  USING ((auth.jwt() -> 'app_metadata' ->> 'app_role') = 'ops_admin');

ALTER POLICY ops_admin_update_sla ON public.order_sla_deadlines
  USING ((auth.jwt() -> 'app_metadata' ->> 'app_role') = 'ops_admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'app_role') = 'ops_admin');

ALTER POLICY order_sla_deadlines_clinic_user_select ON public.order_sla_deadlines
  USING (order_id IN (SELECT order_id FROM orders WHERE clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID));

ALTER POLICY ops_admin_read_all_history ON public.order_status_history
  USING ((auth.jwt() -> 'app_metadata' ->> 'app_role') = 'ops_admin');

ALTER POLICY order_status_history_clinic_user_select ON public.order_status_history
  USING (order_id IN (SELECT order_id FROM orders WHERE clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID));

ALTER POLICY ops_admin_read_all_orders ON public.orders
  USING ((auth.jwt() -> 'app_metadata' ->> 'app_role') = 'ops_admin');

ALTER POLICY ops_admin_update_orders ON public.orders
  USING ((auth.jwt() -> 'app_metadata' ->> 'app_role') = 'ops_admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'app_role') = 'ops_admin');

ALTER POLICY orders_clinic_user_insert ON public.orders
  WITH CHECK (clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID);

ALTER POLICY orders_clinic_user_update ON public.orders
  USING (clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID);

ALTER POLICY orders_provider_clinic_optin_select ON public.orders
  USING ((auth.jwt() -> 'app_metadata' ->> 'app_role') = 'provider' AND clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID AND (nullif(current_setting('request.headers', true), '')::json ->> 'x-provider-view-mode') = 'clinic');

ALTER POLICY orders_role_aware_select ON public.orders
  USING ((auth.jwt() -> 'app_metadata' ->> 'app_role') = 'ops_admin' OR ((auth.jwt() -> 'app_metadata' ->> 'app_role') IN ('clinic_admin', 'medical_assistant') AND clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID) OR ((auth.jwt() -> 'app_metadata' ->> 'app_role') = 'provider' AND clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID AND EXISTS (SELECT 1 FROM providers p WHERE p.provider_id = orders.provider_id AND p.user_id = auth.uid() AND p.clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID AND p.deleted_at IS NULL)));

ALTER POLICY patient_protocol_read ON public.patient_protocol_phases
  USING (patient_id IN (SELECT patient_id FROM patients WHERE clinic_id = ((auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID)));

ALTER POLICY patients_clinic_user_insert ON public.patients
  WITH CHECK (clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID);

ALTER POLICY patients_clinic_user_select ON public.patients
  USING (clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID);

ALTER POLICY patients_clinic_user_update ON public.patients
  USING (clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID);

ALTER POLICY payment_groups_clinic_user_insert ON public.payment_groups
  WITH CHECK (clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID);

ALTER POLICY payment_groups_clinic_user_select ON public.payment_groups
  USING (clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID);

ALTER POLICY payment_groups_clinic_user_update ON public.payment_groups
  USING (clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID);

ALTER POLICY phase_history_read ON public.phase_advancement_history
  USING (tracking_id IN (SELECT tracking_id FROM patient_protocol_phases WHERE patient_id IN (SELECT patient_id FROM patients WHERE clinic_id = ((auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID))));

ALTER POLICY phi_access_log_clinic_admin_select ON public.phi_access_log
  USING (clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID AND (auth.jwt() -> 'app_metadata' ->> 'app_role') = 'clinic_admin');

ALTER POLICY "Authenticated users can read clinic protocol instances" ON public.protocol_instances
  USING (clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID);

ALTER POLICY "Authenticated users can read protocol items" ON public.protocol_items
  USING (protocol_id IN (SELECT protocol_id FROM protocol_templates WHERE clinic_id = ((auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID)));

ALTER POLICY "Authenticated users can read protocol versions" ON public.protocol_template_versions
  USING (protocol_id IN (SELECT protocol_id FROM protocol_templates WHERE clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID));

ALTER POLICY "Authenticated users can read clinic protocols" ON public.protocol_templates
  USING (clinic_id = ((auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID));

ALTER POLICY "Authenticated users can read favorites" ON public.provider_favorites
  USING (provider_id IN (SELECT provider_id FROM providers WHERE clinic_id = ((auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID)));

ALTER POLICY provider_npi_verifications_admin_write ON public.provider_npi_verifications
  USING ((auth.jwt() -> 'app_metadata' ->> 'app_role') = 'clinic_admin' AND provider_id IN (SELECT provider_id FROM providers WHERE clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID))
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'app_role') = 'clinic_admin' AND provider_id IN (SELECT provider_id FROM providers WHERE clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID));

ALTER POLICY provider_npi_verifications_clinic_select ON public.provider_npi_verifications
  USING (provider_id IN (SELECT provider_id FROM providers WHERE clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID));

ALTER POLICY provider_state_licenses_admin_write ON public.provider_state_licenses
  USING ((auth.jwt() -> 'app_metadata' ->> 'app_role') = 'clinic_admin' AND provider_id IN (SELECT provider_id FROM providers WHERE clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID))
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'app_role') = 'clinic_admin' AND provider_id IN (SELECT provider_id FROM providers WHERE clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID));

ALTER POLICY provider_state_licenses_clinic_select ON public.provider_state_licenses
  USING (provider_id IN (SELECT provider_id FROM providers WHERE clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID));

ALTER POLICY providers_clinic_user_select ON public.providers
  USING (clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID);

ALTER POLICY providers_clinic_user_update ON public.providers
  USING (clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID);

ALTER POLICY sms_log_clinic_user_select ON public.sms_log
  USING (order_id IN (SELECT order_id FROM orders WHERE clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID));

ALTER POLICY transfer_failures_clinic_user_select ON public.transfer_failures
  USING (clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID);

-- ── 3. Nothing in public reads user_metadata any more ───────────
DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(format('%I.%I', tablename, policyname), ', ')
    INTO bad
    FROM pg_policies
   WHERE schemaname = 'public'
     AND (COALESCE(qual, '') ~ '(user_metadata|raw_user_meta_data)'
          OR COALESCE(with_check, '') ~ '(user_metadata|raw_user_meta_data)');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'policies still read user_metadata: %', bad;
  END IF;

  SELECT string_agg(p.proname, ', ')
    INTO bad
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prosrc ~ '(user_metadata|raw_user_meta_data)';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'functions still read user_metadata: %', bad;
  END IF;
END $$;
