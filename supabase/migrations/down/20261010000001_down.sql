-- Down for 20261010000001_app_metadata_roles.sql
--
-- Restores every rewritten policy to its previous expression (reading
-- user_metadata / raw_user_meta_data), verbatim from its latest
-- definition before 20261010000001.
--
-- raw_app_meta_data is deliberately NOT stripped. The app reads role and
-- clinic from app_metadata; removing the keys would sign every staff user
-- out of their role if only the database were rolled back. They are
-- harmless to the old policies, which do not read them.

ALTER POLICY adapter_submissions_clinic_user_select ON public.adapter_submissions
  USING (order_id IN (SELECT order_id FROM orders WHERE clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID));

ALTER POLICY ops_admin_read_all_submissions ON public.adapter_submissions
  USING ((auth.jwt() -> 'user_metadata' ->> 'app_role') = 'ops_admin');

ALTER POLICY clinic_staff_read_own_notifications ON public.clinic_notifications
  USING (clinic_id = (SELECT (raw_user_meta_data->>'clinic_id')::uuid FROM auth.users WHERE id = auth.uid()));

ALTER POLICY clinics_clinic_user_select ON public.clinics
  USING (clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID);

ALTER POLICY clinics_clinic_user_update ON public.clinics
  USING (clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID);

ALTER POLICY dispute_orders_clinic_user_select ON public.dispute_orders
  USING (order_id IN (SELECT order_id FROM orders WHERE clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID));

ALTER POLICY disputes_clinic_user_select ON public.disputes
  USING (order_id IN (SELECT order_id FROM orders WHERE clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID));

ALTER POLICY epcs_audit_read ON public.epcs_audit_log
  USING (provider_id IN (SELECT provider_id FROM providers WHERE clinic_id = (SELECT (raw_user_meta_data->>'clinic_id')::uuid FROM auth.users WHERE id = auth.uid())));

ALTER POLICY inbound_fax_queue_ops_admin_select ON public.inbound_fax_queue
  USING ((auth.jwt() -> 'user_metadata' ->> 'app_role') = 'ops_admin');

ALTER POLICY "Authenticated users can read clinic order clarifications" ON public.order_clarifications
  USING (order_id IN (SELECT order_id FROM orders WHERE clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID));

ALTER POLICY ops_admin_read_all_sla ON public.order_sla_deadlines
  USING ((auth.jwt() -> 'user_metadata' ->> 'app_role') = 'ops_admin');

ALTER POLICY ops_admin_update_sla ON public.order_sla_deadlines
  USING ((auth.jwt() -> 'user_metadata' ->> 'app_role') = 'ops_admin')
  WITH CHECK ((auth.jwt() -> 'user_metadata' ->> 'app_role') = 'ops_admin');

ALTER POLICY order_sla_deadlines_clinic_user_select ON public.order_sla_deadlines
  USING (order_id IN (SELECT order_id FROM orders WHERE clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID));

ALTER POLICY ops_admin_read_all_history ON public.order_status_history
  USING ((auth.jwt() -> 'user_metadata' ->> 'app_role') = 'ops_admin');

ALTER POLICY order_status_history_clinic_user_select ON public.order_status_history
  USING (order_id IN (SELECT order_id FROM orders WHERE clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID));

ALTER POLICY ops_admin_read_all_orders ON public.orders
  USING ((auth.jwt() -> 'user_metadata' ->> 'app_role') = 'ops_admin');

ALTER POLICY ops_admin_update_orders ON public.orders
  USING ((auth.jwt() -> 'user_metadata' ->> 'app_role') = 'ops_admin')
  WITH CHECK ((auth.jwt() -> 'user_metadata' ->> 'app_role') = 'ops_admin');

ALTER POLICY orders_clinic_user_insert ON public.orders
  WITH CHECK (clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID);

ALTER POLICY orders_clinic_user_update ON public.orders
  USING (clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID);

ALTER POLICY orders_provider_clinic_optin_select ON public.orders
  USING ((auth.jwt() -> 'user_metadata' ->> 'app_role') = 'provider' AND clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID AND (nullif(current_setting('request.headers', true), '')::json ->> 'x-provider-view-mode') = 'clinic');

ALTER POLICY orders_role_aware_select ON public.orders
  USING ((auth.jwt() -> 'user_metadata' ->> 'app_role') = 'ops_admin' OR ((auth.jwt() -> 'user_metadata' ->> 'app_role') IN ('clinic_admin', 'medical_assistant') AND clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID) OR ((auth.jwt() -> 'user_metadata' ->> 'app_role') = 'provider' AND clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID AND EXISTS (SELECT 1 FROM providers p WHERE p.provider_id = orders.provider_id AND p.user_id = auth.uid() AND p.clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID AND p.deleted_at IS NULL)));

ALTER POLICY patient_protocol_read ON public.patient_protocol_phases
  USING (patient_id IN (SELECT patient_id FROM patients WHERE clinic_id = (SELECT (raw_user_meta_data->>'clinic_id')::uuid FROM auth.users WHERE id = auth.uid())));

ALTER POLICY patients_clinic_user_insert ON public.patients
  WITH CHECK (clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID);

ALTER POLICY patients_clinic_user_select ON public.patients
  USING (clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID);

ALTER POLICY patients_clinic_user_update ON public.patients
  USING (clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID);

ALTER POLICY payment_groups_clinic_user_insert ON public.payment_groups
  WITH CHECK (clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID);

ALTER POLICY payment_groups_clinic_user_select ON public.payment_groups
  USING (clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID);

ALTER POLICY payment_groups_clinic_user_update ON public.payment_groups
  USING (clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID);

ALTER POLICY phase_history_read ON public.phase_advancement_history
  USING (tracking_id IN (SELECT tracking_id FROM patient_protocol_phases WHERE patient_id IN (SELECT patient_id FROM patients WHERE clinic_id = (SELECT (raw_user_meta_data->>'clinic_id')::uuid FROM auth.users WHERE id = auth.uid()))));

ALTER POLICY phi_access_log_clinic_admin_select ON public.phi_access_log
  USING (clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID AND (auth.jwt() -> 'user_metadata' ->> 'app_role') = 'clinic_admin');

ALTER POLICY "Authenticated users can read clinic protocol instances" ON public.protocol_instances
  USING (clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID);

ALTER POLICY "Authenticated users can read protocol items" ON public.protocol_items
  USING (protocol_id IN (SELECT protocol_id FROM protocol_templates WHERE clinic_id = (SELECT (raw_user_meta_data->>'clinic_id')::uuid FROM auth.users WHERE id = auth.uid())));

ALTER POLICY "Authenticated users can read protocol versions" ON public.protocol_template_versions
  USING (protocol_id IN (SELECT protocol_id FROM protocol_templates WHERE clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID));

ALTER POLICY "Authenticated users can read clinic protocols" ON public.protocol_templates
  USING (clinic_id = (SELECT (raw_user_meta_data->>'clinic_id')::uuid FROM auth.users WHERE id = auth.uid()));

ALTER POLICY "Authenticated users can read favorites" ON public.provider_favorites
  USING (provider_id IN (SELECT provider_id FROM providers WHERE clinic_id = (SELECT (raw_user_meta_data->>'clinic_id')::uuid FROM auth.users WHERE id = auth.uid())));

ALTER POLICY provider_npi_verifications_admin_write ON public.provider_npi_verifications
  USING ((auth.jwt() -> 'user_metadata' ->> 'app_role') = 'clinic_admin' AND provider_id IN (SELECT provider_id FROM providers WHERE clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID))
  WITH CHECK ((auth.jwt() -> 'user_metadata' ->> 'app_role') = 'clinic_admin' AND provider_id IN (SELECT provider_id FROM providers WHERE clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID));

ALTER POLICY provider_npi_verifications_clinic_select ON public.provider_npi_verifications
  USING (provider_id IN (SELECT provider_id FROM providers WHERE clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID));

ALTER POLICY provider_state_licenses_admin_write ON public.provider_state_licenses
  USING ((auth.jwt() -> 'user_metadata' ->> 'app_role') = 'clinic_admin' AND provider_id IN (SELECT provider_id FROM providers WHERE clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID))
  WITH CHECK ((auth.jwt() -> 'user_metadata' ->> 'app_role') = 'clinic_admin' AND provider_id IN (SELECT provider_id FROM providers WHERE clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID));

ALTER POLICY provider_state_licenses_clinic_select ON public.provider_state_licenses
  USING (provider_id IN (SELECT provider_id FROM providers WHERE clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID));

ALTER POLICY providers_clinic_user_select ON public.providers
  USING (clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID);

ALTER POLICY providers_clinic_user_update ON public.providers
  USING (clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID);

ALTER POLICY sms_log_clinic_user_select ON public.sms_log
  USING (order_id IN (SELECT order_id FROM orders WHERE clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID));

ALTER POLICY transfer_failures_clinic_user_select ON public.transfer_failures
  USING (clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID);
