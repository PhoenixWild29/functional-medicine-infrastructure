-- ============================================================
-- State-Compliance Pharmacy Search — WO-27
-- ============================================================
--
-- REQ-SCS-011: DEA-scheduled substance check.
-- Adds dea_schedule column to catalog to support per-item DEA
-- scheduling (0 = non-scheduled, 2/3/4/5 = controlled substance
-- schedule II–V per 21 U.S.C. § 812).
--
-- UI behavior:
--   dea_schedule = 0 or NULL → standard routing (all tiers allowed)
--   dea_schedule >= 2         → flag in search UI, restrict to Tier 4 fax
--                               (REQ-SCS-011 — no Tier 1/2/3 submission)
--
-- Also adds a text search index on catalog.medication_name for fast
-- autocomplete (REQ-SCS-001: 3+ character trigger).

-- 1. DEA schedule on catalog
-- Schedule 1 excluded from CHECK — Schedule I substances are not compounded or prescribed.
ALTER TABLE catalog
  ADD COLUMN IF NOT EXISTS dea_schedule SMALLINT NOT NULL DEFAULT 0
    CHECK (dea_schedule IN (0, 2, 3, 4, 5));

COMMENT ON COLUMN catalog.dea_schedule IS
  '0 = non-scheduled; 2–5 = DEA controlled substance schedule (II–V). '
  'Schedule 1 is excluded (not prescribable). '
  'Schedule >= 2 restricts routing to Tier 4 fax only (REQ-SCS-011).';

-- 2. Pharmacy status for REQ-SCS-005 SUSPENDED/BANNED enforcement
-- 'ACTIVE'    = fully operational
-- 'SUSPENDED' = temporarily restricted — flag in search UI, still visible
-- 'BANNED'    = permanently excluded — never shown in search results
ALTER TABLE pharmacies
  ADD COLUMN IF NOT EXISTS pharmacy_status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (pharmacy_status IN ('ACTIVE', 'SUSPENDED', 'BANNED'));

COMMENT ON COLUMN pharmacies.pharmacy_status IS
  'REQ-SCS-005: BANNED pharmacies are excluded from search results. '
  'SUSPENDED pharmacies appear with a warning badge. '
  'is_active = false is used for soft-delete; pharmacy_status controls compliance visibility.';

-- 3. Medication name text search index (trigram for ILIKE '%query%')
-- Requires pg_trgm extension (available on Supabase by default).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_catalog_medication_name_trgm
  ON catalog USING gin (medication_name gin_trgm_ops)
  WHERE deleted_at IS NULL AND is_active = true;

-- 4. Compliance search index — fast lookup of state-licensed active pharmacies
CREATE INDEX IF NOT EXISTS idx_pharmacy_state_licenses_lookup
  ON pharmacy_state_licenses (state_code, pharmacy_id)
  WHERE is_active = true;

-- 5. Staleness indicator index (catalog updated_at for API-sync freshness check)
CREATE INDEX IF NOT EXISTS idx_catalog_updated_at
  ON catalog (updated_at DESC)
  WHERE deleted_at IS NULL AND is_active = true;
