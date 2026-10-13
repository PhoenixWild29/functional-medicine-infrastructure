-- Down migration for 20261017000001_ehr_sync_keragon.sql
-- Atomic: either the whole rollback lands or none of it does.
--
-- WARNING: drops the EHR connections, the patient-to-EHR links, the sync
-- log and the recorded field changes, with every row. Export
-- patient_field_changes first on any database where sync has run: it
-- holds the values sync changed or kept. Patients created by sync stay
-- (source 'ehr', external_id). Delete each connection's Vault secret
-- (delete_vault_secret) before running this, or it is left orphaned.
-- The Vault helpers redefined in section 5 are kept on purpose: the
-- 20260317000005 versions wrote vault.secrets directly, which Supabase
-- Vault refuses ("permission denied for function _crypto_aead_det_noncegen").

BEGIN;

DROP TABLE IF EXISTS patient_field_changes;
DROP TABLE IF EXISTS ehr_sync_events;
DROP TABLE IF EXISTS patient_external_ids;
DROP TRIGGER IF EXISTS set_updated_at_ehr_connections ON ehr_connections;
DROP TABLE IF EXISTS ehr_connections;

COMMIT;
