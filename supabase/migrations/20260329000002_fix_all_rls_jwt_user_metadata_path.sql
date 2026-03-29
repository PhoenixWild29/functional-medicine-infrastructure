-- Fix all RLS policies: clinic_id and app_role live in user_metadata, not top-level JWT

-- clinics
DROP POLICY IF EXISTS clinics_clinic_user_select ON clinics;
CREATE POLICY clinics_clinic_user_select ON clinics FOR SELECT TO authenticated
  USING (clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID);

DROP POLICY IF EXISTS clinics_clinic_user_update ON clinics;
CREATE POLICY clinics_clinic_user_update ON clinics FOR UPDATE TO authenticated
  USING (clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID);

-- providers
DROP POLICY IF EXISTS providers_clinic_user_select ON providers;
CREATE POLICY providers_clinic_user_select ON providers FOR SELECT TO authenticated
  USING (clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID);

DROP POLICY IF EXISTS providers_clinic_user_update ON providers;
CREATE POLICY providers_clinic_user_update ON providers FOR UPDATE TO authenticated
  USING (clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID);

-- patients
DROP POLICY IF EXISTS patients_clinic_user_select ON patients;
CREATE POLICY patients_clinic_user_select ON patients FOR SELECT TO authenticated
  USING (clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID);

DROP POLICY IF EXISTS patients_clinic_user_update ON patients;
CREATE POLICY patients_clinic_user_update ON patients FOR UPDATE TO authenticated
  USING (clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID);

-- order_status_history
DROP POLICY IF EXISTS order_status_history_clinic_user_select ON order_status_history;
CREATE POLICY order_status_history_clinic_user_select ON order_status_history FOR SELECT TO authenticated
  USING (order_id IN (SELECT order_id FROM orders WHERE clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID));

-- order_sla_deadlines
DROP POLICY IF EXISTS order_sla_deadlines_clinic_user_select ON order_sla_deadlines;
CREATE POLICY order_sla_deadlines_clinic_user_select ON order_sla_deadlines FOR SELECT TO authenticated
  USING (order_id IN (SELECT order_id FROM orders WHERE clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID));

-- adapter_submissions
DROP POLICY IF EXISTS adapter_submissions_clinic_user_select ON adapter_submissions;
CREATE POLICY adapter_submissions_clinic_user_select ON adapter_submissions FOR SELECT TO authenticated
  USING (order_id IN (SELECT order_id FROM orders WHERE clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID));

-- sms_log
DROP POLICY IF EXISTS sms_log_clinic_user_select ON sms_log;
CREATE POLICY sms_log_clinic_user_select ON sms_log FOR SELECT TO authenticated
  USING (order_id IN (SELECT order_id FROM orders WHERE clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID));

-- transfer_failures
DROP POLICY IF EXISTS transfer_failures_clinic_user_select ON transfer_failures;
CREATE POLICY transfer_failures_clinic_user_select ON transfer_failures FOR SELECT TO authenticated
  USING (clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID);

-- disputes
DROP POLICY IF EXISTS disputes_clinic_user_select ON disputes;
CREATE POLICY disputes_clinic_user_select ON disputes FOR SELECT TO authenticated
  USING (order_id IN (SELECT order_id FROM orders WHERE clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID));

-- inbound_fax_queue
DROP POLICY IF EXISTS inbound_fax_queue_ops_admin_select ON inbound_fax_queue;
CREATE POLICY inbound_fax_queue_ops_admin_select ON inbound_fax_queue FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'user_metadata' ->> 'app_role') = 'ops_admin');
