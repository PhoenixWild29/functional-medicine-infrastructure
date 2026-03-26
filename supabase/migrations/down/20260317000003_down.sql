-- DOWN: 20260317000003_create_v2_adapter_tables.sql
-- Drops V2.0 adapter tables in reverse FK dependency order.

DROP TABLE IF EXISTS pharmacy_webhook_events  CASCADE;
DROP TABLE IF EXISTS normalized_catalog       CASCADE;
DROP TABLE IF EXISTS adapter_submissions      CASCADE;
DROP TABLE IF EXISTS pharmacy_portal_configs  CASCADE;
DROP TABLE IF EXISTS pharmacy_api_configs     CASCADE;
