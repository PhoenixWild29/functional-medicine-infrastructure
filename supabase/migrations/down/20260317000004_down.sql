-- DOWN: 20260317000004_create_rls_and_triggers.sql
-- Drops triggers and RLS policies added in this migration.
-- Tables themselves are dropped by their respective down migrations.

-- Drop triggers
DROP TRIGGER IF EXISTS prevent_snapshot_mutation ON orders;
DROP TRIGGER IF EXISTS set_updated_at_clinics    ON clinics;
DROP TRIGGER IF EXISTS set_updated_at_pharmacies ON pharmacies;
DROP TRIGGER IF EXISTS set_updated_at_orders     ON orders;
DROP TRIGGER IF EXISTS set_updated_at_catalog    ON catalog;
DROP TRIGGER IF EXISTS log_status_change         ON orders;

DROP FUNCTION IF EXISTS prevent_snapshot_mutation() CASCADE;
DROP FUNCTION IF EXISTS set_updated_at()            CASCADE;
DROP FUNCTION IF EXISTS log_order_status_change()   CASCADE;

-- Drop RLS policies explicitly.
-- When rolling back 000004 standalone (without also running 000002_down.sql),
-- policies on still-existing tables must be dropped explicitly.
-- When 000002_down.sql drops the tables, CASCADE removes attached policies.

DROP POLICY IF EXISTS clinics_clinic_user_select                        ON clinics;
DROP POLICY IF EXISTS clinics_clinic_user_update                        ON clinics;
DROP POLICY IF EXISTS clinics_ops_admin_select                          ON clinics;
DROP POLICY IF EXISTS providers_clinic_user_select                      ON providers;
DROP POLICY IF EXISTS providers_clinic_user_insert                      ON providers;
DROP POLICY IF EXISTS providers_clinic_user_update                      ON providers;
DROP POLICY IF EXISTS providers_ops_admin_select                        ON providers;
DROP POLICY IF EXISTS patients_clinic_user_select                       ON patients;
DROP POLICY IF EXISTS patients_clinic_user_insert                       ON patients;
DROP POLICY IF EXISTS patients_clinic_user_update                       ON patients;
DROP POLICY IF EXISTS patients_ops_admin_select                         ON patients;
DROP POLICY IF EXISTS pharmacies_authenticated_select                   ON pharmacies;
DROP POLICY IF EXISTS pharmacies_service_role_all                       ON pharmacies;
DROP POLICY IF EXISTS pharmacy_state_licenses_authenticated_select      ON pharmacy_state_licenses;
DROP POLICY IF EXISTS pharmacy_state_licenses_service_role_all          ON pharmacy_state_licenses;
DROP POLICY IF EXISTS catalog_authenticated_select                      ON catalog;
DROP POLICY IF EXISTS catalog_service_role_all                          ON catalog;
DROP POLICY IF EXISTS catalog_history_authenticated_select              ON catalog_history;
DROP POLICY IF EXISTS catalog_history_service_role_insert               ON catalog_history;
DROP POLICY IF EXISTS catalog_history_deny_update                       ON catalog_history;
DROP POLICY IF EXISTS catalog_history_deny_delete                       ON catalog_history;
DROP POLICY IF EXISTS orders_clinic_user_select                         ON orders;
DROP POLICY IF EXISTS orders_clinic_user_insert                         ON orders;
DROP POLICY IF EXISTS orders_clinic_user_update                         ON orders;
DROP POLICY IF EXISTS orders_ops_admin_select                           ON orders;
DROP POLICY IF EXISTS order_status_history_clinic_user_select           ON order_status_history;
DROP POLICY IF EXISTS order_status_history_service_role_insert          ON order_status_history;
DROP POLICY IF EXISTS order_status_history_service_role_select          ON order_status_history;
DROP POLICY IF EXISTS order_status_history_deny_update                  ON order_status_history;
DROP POLICY IF EXISTS order_status_history_deny_delete                  ON order_status_history;
DROP POLICY IF EXISTS webhook_events_service_role_insert                ON webhook_events;
DROP POLICY IF EXISTS webhook_events_service_role_select                ON webhook_events;
DROP POLICY IF EXISTS webhook_events_deny_update                        ON webhook_events;
DROP POLICY IF EXISTS webhook_events_deny_delete                        ON webhook_events;
DROP POLICY IF EXISTS order_sla_deadlines_clinic_user_select            ON order_sla_deadlines;
DROP POLICY IF EXISTS order_sla_deadlines_deny_insert_authenticated     ON order_sla_deadlines;
DROP POLICY IF EXISTS order_sla_deadlines_deny_update_authenticated     ON order_sla_deadlines;
DROP POLICY IF EXISTS order_sla_deadlines_service_role_all              ON order_sla_deadlines;
DROP POLICY IF EXISTS inbound_fax_queue_service_role_all                ON inbound_fax_queue;
DROP POLICY IF EXISTS inbound_fax_queue_ops_admin_select                ON inbound_fax_queue;
DROP POLICY IF EXISTS pharmacy_api_configs_service_role_all             ON pharmacy_api_configs;
DROP POLICY IF EXISTS pharmacy_portal_configs_service_role_all          ON pharmacy_portal_configs;
DROP POLICY IF EXISTS adapter_submissions_service_role_insert           ON adapter_submissions;
DROP POLICY IF EXISTS adapter_submissions_service_role_select           ON adapter_submissions;
DROP POLICY IF EXISTS adapter_submissions_deny_update                   ON adapter_submissions;
DROP POLICY IF EXISTS adapter_submissions_deny_delete                   ON adapter_submissions;
DROP POLICY IF EXISTS adapter_submissions_clinic_user_select            ON adapter_submissions;
DROP POLICY IF EXISTS normalized_catalog_authenticated_select           ON normalized_catalog;
DROP POLICY IF EXISTS normalized_catalog_service_role_all               ON normalized_catalog;
DROP POLICY IF EXISTS pharmacy_webhook_events_service_role_insert       ON pharmacy_webhook_events;
DROP POLICY IF EXISTS pharmacy_webhook_events_service_role_select       ON pharmacy_webhook_events;
DROP POLICY IF EXISTS pharmacy_webhook_events_deny_update               ON pharmacy_webhook_events;
DROP POLICY IF EXISTS pharmacy_webhook_events_deny_delete               ON pharmacy_webhook_events;
DROP POLICY IF EXISTS sms_log_service_role_insert                       ON sms_log;
DROP POLICY IF EXISTS sms_log_service_role_select                       ON sms_log;
DROP POLICY IF EXISTS sms_log_clinic_user_select                        ON sms_log;
DROP POLICY IF EXISTS sms_log_deny_update                               ON sms_log;
DROP POLICY IF EXISTS sms_log_deny_delete                               ON sms_log;
DROP POLICY IF EXISTS sms_templates_authenticated_select                ON sms_templates;
DROP POLICY IF EXISTS sms_templates_service_role_all                    ON sms_templates;
DROP POLICY IF EXISTS transfer_failures_service_role_insert             ON transfer_failures;
DROP POLICY IF EXISTS transfer_failures_clinic_user_select              ON transfer_failures;
DROP POLICY IF EXISTS transfer_failures_service_role_select             ON transfer_failures;
DROP POLICY IF EXISTS transfer_failures_deny_update                     ON transfer_failures;
DROP POLICY IF EXISTS transfer_failures_deny_delete                     ON transfer_failures;
DROP POLICY IF EXISTS disputes_clinic_user_select                       ON disputes;
DROP POLICY IF EXISTS disputes_service_role_all                         ON disputes;
