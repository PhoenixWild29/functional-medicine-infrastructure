-- ============================================================
-- WO-22: Tier 4 Fax Fallback — Schema Additions
-- ============================================================
--
-- 1. orders.fax_attempt_count — tracks how many fax sends have
--    been issued for this order (1 = initial send, 2/3 = retries).
--    Used by the fax-retry cron to avoid re-triggering in-progress
--    retries and to apply correct delay (5 min after attempt 1,
--    15 min after attempt 2).
--
-- 2. storage.buckets — prescription-pdfs bucket for ephemeral
--    PDF storage (fax upload → Documo signed URL → delete TTL).
--
-- All changes are idempotent (IF NOT EXISTS / ON CONFLICT).

-- ============================================================
-- 1. FAX_ATTEMPT_COUNT on orders
-- ============================================================

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS fax_attempt_count INTEGER NOT NULL DEFAULT 0;

-- Partial index for fax-retry cron: only FAX_QUEUED orders with
-- 1 or 2 sends recorded (pending retry eligibility check).
CREATE INDEX IF NOT EXISTS idx_orders_fax_retry_candidates
  ON orders (order_id, fax_attempt_count)
  WHERE status = 'FAX_QUEUED' AND fax_attempt_count BETWEEN 1 AND 2;

-- ============================================================
-- 2. PRESCRIPTION-PDFS STORAGE BUCKET
-- ============================================================
-- Non-public bucket — accessible only via service_role signed URLs.
-- PDFs are ephemeral: generated on-demand, uploaded, Documo
-- downloads via 1-hour signed URL, then the path is reused on retry.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'prescription-pdfs',
  'prescription-pdfs',
  false,
  5242880,               -- 5 MB max per PDF
  '{application/pdf}'
)
ON CONFLICT (id) DO NOTHING;
