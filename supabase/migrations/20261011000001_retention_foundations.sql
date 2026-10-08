-- ============================================================
-- Compliance C10, retention PR 1: foundations
-- ============================================================
--
-- The database side of the retention plan. Nothing here deletes, updates
-- or truncates data; the retention cron (/api/cron/retention) only counts
-- in this PR. It adds:
--
--   1. retention_runs: one row per retention policy per run (counts,
--      cutoff, mode). Append-only for every role, the service role
--      included, like phi_access_log. No row contents, no patient ids.
--   2. legal_holds: a clinic or a patient exempt from every retention
--      job. A hold is released (released_at, released_by), never edited
--      or deleted, so the record of it stays.
--   3. epcs_audit_log becomes append-only (it said "Immutable" but had no
--      protection). The one change let through is the ON DELETE SET NULL
--      of order_id, which runs when an unsigned draft is deleted. New
--      rows carry keyed hashes of the IP and user agent (ip_hash,
--      user_agent_hash, HMAC-SHA256 hex like phi_access_log); the raw
--      columns stay for rows already written and are no longer filled.
--   4. A signed order (locked_at set) cannot be deleted by any role, and
--      orders cannot be truncated. prevent_snapshot_mutation already
--      refuses changes to a signed order's snapshot; this closes delete.
--   5. Indexes for the retention age scans.
--
-- phi_access_log is not touched: its retention (6 years) ends no earlier
-- than October 2032, and pruning it will need its own reviewed migration.

BEGIN;

-- ── 1. retention_runs ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS retention_runs (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        UUID        NOT NULL,
  policy        TEXT        NOT NULL CHECK (policy ~ '^[a-z0-9_]{1,60}$'),
  mode          TEXT        NOT NULL CHECK (mode IN ('dry_run', 'live')),
  cutoff        TIMESTAMPTZ NOT NULL,
  rows_matched  INTEGER     NOT NULL CHECK (rows_matched >= 0),
  rows_affected INTEGER     NOT NULL DEFAULT 0 CHECK (rows_affected >= 0),
  oldest_at     TIMESTAMPTZ,
  newest_at     TIMESTAMPTZ,
  error         TEXT        CHECK (error IS NULL OR length(error) <= 500),
  started_at    TIMESTAMPTZ NOT NULL,
  finished_at   TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (mode = 'live' OR rows_affected = 0)
);

CREATE INDEX IF NOT EXISTS idx_retention_runs_policy ON retention_runs (policy, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_retention_runs_run ON retention_runs (run_id);

ALTER TABLE retention_runs ENABLE ROW LEVEL SECURITY;
-- No policies: the service role (which bypasses RLS) writes and reads.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON retention_runs FROM anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON retention_runs FROM service_role;

CREATE OR REPLACE FUNCTION retention_append_only() RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS retention_runs_no_update_delete ON retention_runs;
CREATE TRIGGER retention_runs_no_update_delete
  BEFORE UPDATE OR DELETE ON retention_runs
  FOR EACH ROW EXECUTE FUNCTION retention_append_only();

DROP TRIGGER IF EXISTS retention_runs_no_truncate ON retention_runs;
CREATE TRIGGER retention_runs_no_truncate
  BEFORE TRUNCATE ON retention_runs
  FOR EACH STATEMENT EXECUTE FUNCTION retention_append_only();

-- ── 2. legal_holds ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS legal_holds (
  hold_id     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  scope       TEXT        NOT NULL CHECK (scope IN ('clinic', 'patient')),
  target_id   UUID        NOT NULL,
  reason      TEXT        NOT NULL CHECK (length(trim(reason)) > 0),
  set_by      TEXT        NOT NULL,
  set_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at TIMESTAMPTZ,
  released_by TEXT,
  CHECK ((released_at IS NULL) = (released_by IS NULL))
);

-- No foreign key on target_id: a hold must outlive anything it holds.
CREATE INDEX IF NOT EXISTS idx_legal_holds_active ON legal_holds (scope, target_id) WHERE released_at IS NULL;

ALTER TABLE legal_holds ENABLE ROW LEVEL SECURITY;
-- No policies: set and released by the service role (ops), read by the
-- retention cron.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON legal_holds FROM anon, authenticated;
REVOKE DELETE, TRUNCATE ON legal_holds FROM service_role;

CREATE OR REPLACE FUNCTION legal_holds_release_only() RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'a legal hold is released, never deleted';
  END IF;
  -- The only change: releasing a hold that is still active.
  IF OLD.released_at IS NULL
     AND NEW.released_at IS NOT NULL
     AND (to_jsonb(NEW) - 'released_at' - 'released_by') = (to_jsonb(OLD) - 'released_at' - 'released_by') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'a legal hold can only be released, once';
END;
$$;

DROP TRIGGER IF EXISTS legal_holds_release_only ON legal_holds;
CREATE TRIGGER legal_holds_release_only
  BEFORE UPDATE OR DELETE ON legal_holds
  FOR EACH ROW EXECUTE FUNCTION legal_holds_release_only();

DROP TRIGGER IF EXISTS legal_holds_no_truncate ON legal_holds;
CREATE TRIGGER legal_holds_no_truncate
  BEFORE TRUNCATE ON legal_holds
  FOR EACH STATEMENT EXECUTE FUNCTION retention_append_only();

-- ── 3. epcs_audit_log: append-only, hashed IP and user agent ─
ALTER TABLE epcs_audit_log ADD COLUMN IF NOT EXISTS ip_hash TEXT;
ALTER TABLE epcs_audit_log ADD COLUMN IF NOT EXISTS user_agent_hash TEXT;

ALTER TABLE epcs_audit_log DROP CONSTRAINT IF EXISTS chk_epcs_audit_ip_hash;
ALTER TABLE epcs_audit_log ADD CONSTRAINT chk_epcs_audit_ip_hash
  CHECK (ip_hash IS NULL OR ip_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE epcs_audit_log DROP CONSTRAINT IF EXISTS chk_epcs_audit_user_agent_hash;
ALTER TABLE epcs_audit_log ADD CONSTRAINT chk_epcs_audit_user_agent_hash
  CHECK (user_agent_hash IS NULL OR user_agent_hash ~ '^[0-9a-f]{64}$');

COMMENT ON COLUMN epcs_audit_log.ip_address IS 'Raw client IP on rows written before 2026-10-11; new rows store ip_hash instead.';
COMMENT ON COLUMN epcs_audit_log.user_agent IS 'Raw user agent on rows written before 2026-10-11; new rows store user_agent_hash instead.';

REVOKE UPDATE, DELETE, TRUNCATE ON epcs_audit_log FROM anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION epcs_audit_log_append_only() RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- The one change let through: ON DELETE SET NULL of order_id, when an
  -- unsigned draft the row points at is deleted. Every other column is
  -- unchanged.
  IF TG_OP = 'UPDATE'
     AND OLD.order_id IS NOT NULL AND NEW.order_id IS NULL
     AND (to_jsonb(NEW) - 'order_id') = (to_jsonb(OLD) - 'order_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'epcs_audit_log is append-only';
END;
$$;

DROP TRIGGER IF EXISTS epcs_audit_log_no_update_delete ON epcs_audit_log;
CREATE TRIGGER epcs_audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON epcs_audit_log
  FOR EACH ROW EXECUTE FUNCTION epcs_audit_log_append_only();

DROP TRIGGER IF EXISTS epcs_audit_log_no_truncate ON epcs_audit_log;
CREATE TRIGGER epcs_audit_log_no_truncate
  BEFORE TRUNCATE ON epcs_audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION epcs_audit_log_append_only();

-- ── 4. A signed order is never deleted ───────────────────────
CREATE OR REPLACE FUNCTION orders_refuse_signed_delete() RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'a signed order cannot be deleted, and orders cannot be truncated';
  END IF;
  RAISE EXCEPTION 'a signed order cannot be deleted (order %)', OLD.order_id;
END;
$$;

DROP TRIGGER IF EXISTS orders_no_delete_signed ON orders;
CREATE TRIGGER orders_no_delete_signed
  BEFORE DELETE ON orders
  FOR EACH ROW WHEN (OLD.locked_at IS NOT NULL)
  EXECUTE FUNCTION orders_refuse_signed_delete();

DROP TRIGGER IF EXISTS orders_no_truncate ON orders;
CREATE TRIGGER orders_no_truncate
  BEFORE TRUNCATE ON orders
  FOR EACH STATEMENT EXECUTE FUNCTION orders_refuse_signed_delete();

-- ── 5. Indexes for the age scans ─────────────────────────────
-- (adapter_submissions (created_at) and ops_alert_queue (created_at)
-- already exist.)
CREATE INDEX IF NOT EXISTS idx_webhook_events_processed_at ON webhook_events (processed_at);
CREATE INDEX IF NOT EXISTS idx_pharmacy_webhook_events_processed_at ON pharmacy_webhook_events (processed_at);
CREATE INDEX IF NOT EXISTS idx_sms_log_created_at ON sms_log (created_at);
CREATE INDEX IF NOT EXISTS idx_orders_draft_updated_at ON orders (updated_at)
  WHERE status = 'DRAFT' AND locked_at IS NULL;

COMMIT;
