-- DOWN: 20260317000002_create_v1_tables.sql
-- Drops all V1.0 tables in reverse FK dependency order.
-- Enums (20260317000001) must be dropped after this.

DROP TABLE IF EXISTS inbound_fax_queue           CASCADE;
DROP TABLE IF EXISTS order_sla_deadlines          CASCADE;
DROP TABLE IF EXISTS webhook_events               CASCADE;
DROP TABLE IF EXISTS order_status_history         CASCADE;
DROP TABLE IF EXISTS orders                       CASCADE;
DROP TABLE IF EXISTS catalog_history              CASCADE;
DROP TABLE IF EXISTS catalog                      CASCADE;
DROP TABLE IF EXISTS pharmacy_state_licenses      CASCADE;
DROP TABLE IF EXISTS pharmacies                   CASCADE;
DROP TABLE IF EXISTS patients                     CASCADE;
DROP TABLE IF EXISTS providers                    CASCADE;
DROP TABLE IF EXISTS clinics                      CASCADE;
DROP TABLE IF EXISTS sms_log                      CASCADE;
DROP TABLE IF EXISTS sms_templates                CASCADE;
DROP TABLE IF EXISTS transfer_failures            CASCADE;
DROP TABLE IF EXISTS disputes                     CASCADE;
