-- DOWN: 20260319000012_wo37_catalog_upload_history.sql
-- Removes catalog upload history table and related columns.

ALTER TABLE catalog DROP COLUMN IF EXISTS upload_history_id;
ALTER TABLE pharmacies DROP COLUMN IF EXISTS catalog_last_synced_at;
DROP TABLE IF EXISTS catalog_upload_history CASCADE;
