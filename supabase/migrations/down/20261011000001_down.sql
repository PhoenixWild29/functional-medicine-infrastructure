-- Down migration for 20261011000001_retention_foundations.sql
-- Atomic: either the whole rollback lands or none of it does.
--
-- WARNING: drops retention_runs and legal_holds and every row in them.
-- Export both first on any database that has run retention jobs or holds
-- a legal hold. epcs_audit_log keeps its rows and its ip_hash and
-- user_agent_hash columns (dropping them would lose audit data); only
-- its append-only triggers go.

BEGIN;

DROP INDEX IF EXISTS idx_orders_draft_updated_at;
DROP INDEX IF EXISTS idx_sms_log_created_at;
DROP INDEX IF EXISTS idx_pharmacy_webhook_events_processed_at;
DROP INDEX IF EXISTS idx_webhook_events_processed_at;

DROP TRIGGER IF EXISTS orders_no_truncate ON orders;
DROP TRIGGER IF EXISTS orders_no_delete_signed ON orders;
DROP FUNCTION IF EXISTS orders_refuse_signed_delete();

DROP TRIGGER IF EXISTS epcs_audit_log_no_truncate ON epcs_audit_log;
DROP TRIGGER IF EXISTS epcs_audit_log_no_update_delete ON epcs_audit_log;
DROP FUNCTION IF EXISTS epcs_audit_log_append_only();
GRANT UPDATE, DELETE, TRUNCATE ON epcs_audit_log TO service_role;

DROP TRIGGER IF EXISTS legal_holds_no_truncate ON legal_holds;
DROP TRIGGER IF EXISTS legal_holds_release_only ON legal_holds;
DROP TABLE IF EXISTS legal_holds;
DROP FUNCTION IF EXISTS legal_holds_release_only();

DROP TRIGGER IF EXISTS retention_runs_no_truncate ON retention_runs;
DROP TRIGGER IF EXISTS retention_runs_no_update_delete ON retention_runs;
DROP TABLE IF EXISTS retention_runs;
DROP FUNCTION IF EXISTS retention_append_only();

COMMIT;
