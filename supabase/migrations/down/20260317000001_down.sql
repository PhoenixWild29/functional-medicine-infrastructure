-- DOWN: 20260317000001_create_enums.sql
-- Drops all 10 application enum types created by this migration.
-- CASCADE removes any columns or domains that depend on these types.
-- Intended for full schema teardown only — all tables must be dropped first
-- or CASCADE will handle the column dependencies automatically.

DROP TYPE IF EXISTS order_status_enum              CASCADE;
DROP TYPE IF EXISTS stripe_connect_status_enum     CASCADE;
DROP TYPE IF EXISTS app_role_enum                  CASCADE;
DROP TYPE IF EXISTS webhook_source_enum            CASCADE;
DROP TYPE IF EXISTS sla_type_enum                  CASCADE;
DROP TYPE IF EXISTS fax_queue_status_enum          CASCADE;
DROP TYPE IF EXISTS regulatory_status_enum         CASCADE;
DROP TYPE IF EXISTS integration_tier_enum          CASCADE;
DROP TYPE IF EXISTS adapter_submission_status_enum CASCADE;
DROP TYPE IF EXISTS catalog_source_enum            CASCADE;
