-- ============================================================
-- WO-37: Catalog Management — catalog_upload_history table
-- ============================================================
-- Tracks per-pharmacy CSV upload versions with delta summaries.
-- This is upload-level history (one row per upload/sync event),
-- distinct from the item-level catalog_history table.
--
-- REQ-CTM-003: Version tracking with delta summaries
-- REQ-CTM-008: Catalog rollback (via is_active flag)

CREATE TABLE IF NOT EXISTS catalog_upload_history (
  history_id       UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pharmacy_id      UUID        NOT NULL REFERENCES pharmacies(pharmacy_id),
  uploader         TEXT        NOT NULL,   -- ops user email / system
  upload_source    TEXT        NOT NULL DEFAULT 'CSV_UPLOAD'
                               CHECK (upload_source IN ('CSV_UPLOAD', 'PHARMACY_API', 'MANUAL_ENTRY')),
  version_number   INTEGER     NOT NULL,
  row_count        INTEGER     NOT NULL DEFAULT 0,
  delta_summary    JSONB       NOT NULL DEFAULT '{"added":0,"modified":0,"removed":0}',
  is_active        BOOLEAN     NOT NULL DEFAULT true,   -- false = rolled back
  uploaded_at      TIMESTAMPTZ NOT NULL DEFAULT now(),  -- BLK-08: spec uses upload_timestamp; uploaded_at is canonical here
  notes            TEXT
);

ALTER TABLE catalog_upload_history ENABLE ROW LEVEL SECURITY;

-- Only ops_admin (service role) may read/write upload history
CREATE POLICY "catalog_upload_history_service_only"
  ON catalog_upload_history
  FOR ALL
  USING (false)   -- no direct client access; service role bypasses RLS
  WITH CHECK (false);

-- Unique constraint: version numbers must be monotonically increasing per pharmacy
CREATE UNIQUE INDEX IF NOT EXISTS catalog_upload_history_pharmacy_version_unique
  ON catalog_upload_history (pharmacy_id, version_number);

-- Track last API sync timestamp on pharmacies table
ALTER TABLE pharmacies
  ADD COLUMN IF NOT EXISTS catalog_last_synced_at TIMESTAMPTZ;

-- BLK-02: Add upload_history_id FK to catalog for reliable rollback.
-- Items stamped with the history_id of the upload that created them,
-- enabling exact version restoration without fragile timestamp windows.
ALTER TABLE catalog
  ADD COLUMN IF NOT EXISTS upload_history_id UUID REFERENCES catalog_upload_history(history_id);
