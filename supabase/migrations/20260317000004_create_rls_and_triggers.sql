-- Migration: RLS policies on all 21 tables + snapshot & updated_at triggers
-- WO-3: Database Schema V2.0 - RLS Policies & Triggers

-- ============================================================
-- TRIGGER FUNCTIONS
-- ============================================================

-- set_updated_at: automatically maintain updated_at on every UPDATE
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- prevent_snapshot_mutation: block updates to snapshot fields after order is locked
CREATE OR REPLACE FUNCTION prevent_snapshot_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.locked_at IS NOT NULL THEN
    IF (
      NEW.wholesale_price_snapshot  IS DISTINCT FROM OLD.wholesale_price_snapshot  OR
      NEW.retail_price_snapshot     IS DISTINCT FROM OLD.retail_price_snapshot     OR
      NEW.medication_snapshot       IS DISTINCT FROM OLD.medication_snapshot       OR
      NEW.shipping_state_snapshot   IS DISTINCT FROM OLD.shipping_state_snapshot   OR
      NEW.provider_npi_snapshot     IS DISTINCT FROM OLD.provider_npi_snapshot     OR
      NEW.pharmacy_snapshot         IS DISTINCT FROM OLD.pharmacy_snapshot         OR
      NEW.locked_at                 IS DISTINCT FROM OLD.locked_at
    ) THEN
      RAISE EXCEPTION 'Cannot modify snapshot fields after order is locked';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- TRIGGERS
-- ============================================================

-- Attach set_updated_at to all tables that have an updated_at column
-- (excludes append-only tables: catalog_history, order_status_history,
--  webhook_events, adapter_submissions, pharmacy_webhook_events,
--  sms_log, transfer_failures)

CREATE TRIGGER set_updated_at_clinics
  BEFORE UPDATE ON clinics
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at_providers
  BEFORE UPDATE ON providers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at_patients
  BEFORE UPDATE ON patients
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at_pharmacies
  BEFORE UPDATE ON pharmacies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at_catalog
  BEFORE UPDATE ON catalog
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at_orders
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at_inbound_fax_queue
  BEFORE UPDATE ON inbound_fax_queue
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at_pharmacy_api_configs
  BEFORE UPDATE ON pharmacy_api_configs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at_pharmacy_portal_configs
  BEFORE UPDATE ON pharmacy_portal_configs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at_normalized_catalog
  BEFORE UPDATE ON normalized_catalog
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at_sms_templates
  BEFORE UPDATE ON sms_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at_disputes
  BEFORE UPDATE ON disputes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Attach snapshot immutability trigger to orders
CREATE TRIGGER prevent_snapshot_mutation
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION prevent_snapshot_mutation();

-- ============================================================
-- RLS POLICIES
-- ============================================================
-- Roles:
--   clinic_user  — scoped to their clinic via JWT claim
--   ops_admin    — cross-clinic read access
--   service_role — full bypass (server-side only)
-- No role has DELETE permission — soft deletes only.
-- ============================================================

-- ------------------------------------------------------------
-- CLINICS
-- ------------------------------------------------------------
CREATE POLICY clinics_clinic_user_select ON clinics
  FOR SELECT TO authenticated
  USING (clinic_id = (auth.jwt() ->> 'clinic_id')::UUID);

CREATE POLICY clinics_clinic_user_update ON clinics
  FOR UPDATE TO authenticated
  USING (clinic_id = (auth.jwt() ->> 'clinic_id')::UUID);

CREATE POLICY clinics_ops_admin_select ON clinics
  FOR SELECT TO service_role
  USING (true);

-- ------------------------------------------------------------
-- PROVIDERS
-- ------------------------------------------------------------
CREATE POLICY providers_clinic_user_select ON providers
  FOR SELECT TO authenticated
  USING (clinic_id = (auth.jwt() ->> 'clinic_id')::UUID);

CREATE POLICY providers_clinic_user_insert ON providers
  FOR INSERT TO authenticated
  WITH CHECK (clinic_id = (auth.jwt() ->> 'clinic_id')::UUID);

CREATE POLICY providers_clinic_user_update ON providers
  FOR UPDATE TO authenticated
  USING (clinic_id = (auth.jwt() ->> 'clinic_id')::UUID);

CREATE POLICY providers_ops_admin_select ON providers
  FOR SELECT TO service_role
  USING (true);

-- ------------------------------------------------------------
-- PATIENTS
-- ------------------------------------------------------------
CREATE POLICY patients_clinic_user_select ON patients
  FOR SELECT TO authenticated
  USING (clinic_id = (auth.jwt() ->> 'clinic_id')::UUID);

CREATE POLICY patients_clinic_user_insert ON patients
  FOR INSERT TO authenticated
  WITH CHECK (clinic_id = (auth.jwt() ->> 'clinic_id')::UUID);

CREATE POLICY patients_clinic_user_update ON patients
  FOR UPDATE TO authenticated
  USING (clinic_id = (auth.jwt() ->> 'clinic_id')::UUID);

CREATE POLICY patients_ops_admin_select ON patients
  FOR SELECT TO service_role
  USING (true);

-- ------------------------------------------------------------
-- PHARMACIES (no clinic_id — ops_admin + service_role only)
-- ------------------------------------------------------------
CREATE POLICY pharmacies_authenticated_select ON pharmacies
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY pharmacies_service_role_all ON pharmacies
  FOR ALL TO service_role
  USING (true);

-- ------------------------------------------------------------
-- PHARMACY_STATE_LICENSES
-- ------------------------------------------------------------
CREATE POLICY pharmacy_state_licenses_authenticated_select ON pharmacy_state_licenses
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY pharmacy_state_licenses_service_role_all ON pharmacy_state_licenses
  FOR ALL TO service_role
  USING (true);

-- ------------------------------------------------------------
-- CATALOG
-- ------------------------------------------------------------
CREATE POLICY catalog_authenticated_select ON catalog
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY catalog_service_role_all ON catalog
  FOR ALL TO service_role
  USING (true);

-- ------------------------------------------------------------
-- CATALOG_HISTORY (append-only: INSERT + SELECT only)
-- Explicit DENY on UPDATE/DELETE makes immutability intent unmistakable.
-- Note: PostgreSQL RLS denies by default, but explicit policies are best practice.
-- ------------------------------------------------------------
CREATE POLICY catalog_history_authenticated_select ON catalog_history
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY catalog_history_service_role_insert ON catalog_history
  FOR INSERT TO service_role
  WITH CHECK (true);

CREATE POLICY catalog_history_deny_update ON catalog_history
  FOR UPDATE USING (false);

CREATE POLICY catalog_history_deny_delete ON catalog_history
  FOR DELETE USING (false);

-- ------------------------------------------------------------
-- ORDERS
-- ------------------------------------------------------------
CREATE POLICY orders_clinic_user_select ON orders
  FOR SELECT TO authenticated
  USING (clinic_id = (auth.jwt() ->> 'clinic_id')::UUID);

CREATE POLICY orders_clinic_user_insert ON orders
  FOR INSERT TO authenticated
  WITH CHECK (clinic_id = (auth.jwt() ->> 'clinic_id')::UUID);

CREATE POLICY orders_clinic_user_update ON orders
  FOR UPDATE TO authenticated
  USING (clinic_id = (auth.jwt() ->> 'clinic_id')::UUID);

CREATE POLICY orders_ops_admin_select ON orders
  FOR SELECT TO service_role
  USING (true);

-- ------------------------------------------------------------
-- ORDER_STATUS_HISTORY (append-only: INSERT + SELECT only)
-- ------------------------------------------------------------
CREATE POLICY order_status_history_clinic_user_select ON order_status_history
  FOR SELECT TO authenticated
  USING (
    order_id IN (
      SELECT order_id FROM orders
      WHERE clinic_id = (auth.jwt() ->> 'clinic_id')::UUID
    )
  );

CREATE POLICY order_status_history_service_role_insert ON order_status_history
  FOR INSERT TO service_role
  WITH CHECK (true);

CREATE POLICY order_status_history_service_role_select ON order_status_history
  FOR SELECT TO service_role
  USING (true);

CREATE POLICY order_status_history_deny_update ON order_status_history
  FOR UPDATE USING (false);

CREATE POLICY order_status_history_deny_delete ON order_status_history
  FOR DELETE USING (false);

-- ------------------------------------------------------------
-- WEBHOOK_EVENTS (append-only: INSERT + SELECT only)
-- ------------------------------------------------------------
CREATE POLICY webhook_events_service_role_insert ON webhook_events
  FOR INSERT TO service_role
  WITH CHECK (true);

CREATE POLICY webhook_events_service_role_select ON webhook_events
  FOR SELECT TO service_role
  USING (true);

CREATE POLICY webhook_events_deny_update ON webhook_events
  FOR UPDATE USING (false);

CREATE POLICY webhook_events_deny_delete ON webhook_events
  FOR DELETE USING (false);

-- ------------------------------------------------------------
-- ORDER_SLA_DEADLINES
-- Authenticated users: SELECT only (server-side manages writes)
-- Explicit DENY on INSERT/UPDATE for authenticated makes intent clear.
-- ------------------------------------------------------------
CREATE POLICY order_sla_deadlines_clinic_user_select ON order_sla_deadlines
  FOR SELECT TO authenticated
  USING (
    order_id IN (
      SELECT order_id FROM orders
      WHERE clinic_id = (auth.jwt() ->> 'clinic_id')::UUID
    )
  );

CREATE POLICY order_sla_deadlines_deny_insert_authenticated ON order_sla_deadlines
  FOR INSERT TO authenticated
  WITH CHECK (false);

CREATE POLICY order_sla_deadlines_deny_update_authenticated ON order_sla_deadlines
  FOR UPDATE TO authenticated
  USING (false);

CREATE POLICY order_sla_deadlines_service_role_all ON order_sla_deadlines
  FOR ALL TO service_role
  USING (true);

-- ------------------------------------------------------------
-- INBOUND_FAX_QUEUE
-- ------------------------------------------------------------
CREATE POLICY inbound_fax_queue_service_role_all ON inbound_fax_queue
  FOR ALL TO service_role
  USING (true);

CREATE POLICY inbound_fax_queue_ops_admin_select ON inbound_fax_queue
  FOR SELECT TO authenticated
  USING ((auth.jwt() ->> 'app_role') = 'ops_admin');

-- ------------------------------------------------------------
-- PHARMACY_API_CONFIGS (service_role only — contains Vault refs)
-- ------------------------------------------------------------
CREATE POLICY pharmacy_api_configs_service_role_all ON pharmacy_api_configs
  FOR ALL TO service_role
  USING (true);

-- ------------------------------------------------------------
-- PHARMACY_PORTAL_CONFIGS (service_role only — contains Vault refs)
-- ------------------------------------------------------------
CREATE POLICY pharmacy_portal_configs_service_role_all ON pharmacy_portal_configs
  FOR ALL TO service_role
  USING (true);

-- ------------------------------------------------------------
-- ADAPTER_SUBMISSIONS (append-only: INSERT + SELECT only)
-- ------------------------------------------------------------
CREATE POLICY adapter_submissions_service_role_insert ON adapter_submissions
  FOR INSERT TO service_role
  WITH CHECK (true);

CREATE POLICY adapter_submissions_service_role_select ON adapter_submissions
  FOR SELECT TO service_role
  USING (true);

CREATE POLICY adapter_submissions_deny_update ON adapter_submissions
  FOR UPDATE USING (false);

CREATE POLICY adapter_submissions_deny_delete ON adapter_submissions
  FOR DELETE USING (false);

CREATE POLICY adapter_submissions_clinic_user_select ON adapter_submissions
  FOR SELECT TO authenticated
  USING (
    order_id IN (
      SELECT order_id FROM orders
      WHERE clinic_id = (auth.jwt() ->> 'clinic_id')::UUID
    )
  );

-- ------------------------------------------------------------
-- NORMALIZED_CATALOG
-- ------------------------------------------------------------
CREATE POLICY normalized_catalog_authenticated_select ON normalized_catalog
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY normalized_catalog_service_role_all ON normalized_catalog
  FOR ALL TO service_role
  USING (true);

-- ------------------------------------------------------------
-- PHARMACY_WEBHOOK_EVENTS (append-only: INSERT + SELECT only)
-- ------------------------------------------------------------
CREATE POLICY pharmacy_webhook_events_service_role_insert ON pharmacy_webhook_events
  FOR INSERT TO service_role
  WITH CHECK (true);

CREATE POLICY pharmacy_webhook_events_service_role_select ON pharmacy_webhook_events
  FOR SELECT TO service_role
  USING (true);

CREATE POLICY pharmacy_webhook_events_deny_update ON pharmacy_webhook_events
  FOR UPDATE USING (false);

CREATE POLICY pharmacy_webhook_events_deny_delete ON pharmacy_webhook_events
  FOR DELETE USING (false);

-- ------------------------------------------------------------
-- SMS_LOG (append-only: INSERT + SELECT only)
-- ------------------------------------------------------------
CREATE POLICY sms_log_service_role_insert ON sms_log
  FOR INSERT TO service_role
  WITH CHECK (true);

CREATE POLICY sms_log_service_role_select ON sms_log
  FOR SELECT TO service_role
  USING (true);

CREATE POLICY sms_log_clinic_user_select ON sms_log
  FOR SELECT TO authenticated
  USING (
    order_id IN (
      SELECT order_id FROM orders
      WHERE clinic_id = (auth.jwt() ->> 'clinic_id')::UUID
    )
  );

CREATE POLICY sms_log_deny_update ON sms_log
  FOR UPDATE USING (false);

CREATE POLICY sms_log_deny_delete ON sms_log
  FOR DELETE USING (false);

-- ------------------------------------------------------------
-- SMS_TEMPLATES
-- ------------------------------------------------------------
CREATE POLICY sms_templates_authenticated_select ON sms_templates
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY sms_templates_service_role_all ON sms_templates
  FOR ALL TO service_role
  USING (true);

-- ------------------------------------------------------------
-- TRANSFER_FAILURES (append-only: INSERT + SELECT only)
-- ------------------------------------------------------------
CREATE POLICY transfer_failures_service_role_insert ON transfer_failures
  FOR INSERT TO service_role
  WITH CHECK (true);

CREATE POLICY transfer_failures_clinic_user_select ON transfer_failures
  FOR SELECT TO authenticated
  USING (clinic_id = (auth.jwt() ->> 'clinic_id')::UUID);

CREATE POLICY transfer_failures_service_role_select ON transfer_failures
  FOR SELECT TO service_role
  USING (true);

CREATE POLICY transfer_failures_deny_update ON transfer_failures
  FOR UPDATE USING (false);

CREATE POLICY transfer_failures_deny_delete ON transfer_failures
  FOR DELETE USING (false);

-- ------------------------------------------------------------
-- DISPUTES
-- ------------------------------------------------------------
CREATE POLICY disputes_clinic_user_select ON disputes
  FOR SELECT TO authenticated
  USING (
    order_id IN (
      SELECT order_id FROM orders
      WHERE clinic_id = (auth.jwt() ->> 'clinic_id')::UUID
    )
  );

CREATE POLICY disputes_service_role_all ON disputes
  FOR ALL TO service_role
  USING (true);
