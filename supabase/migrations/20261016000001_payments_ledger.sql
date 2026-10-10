-- ============================================================
-- Payment and Order Flow v1.1, build steps 2 and 3: the payments ledger
-- ============================================================
--
-- Record-only. Nothing here moves money; Stripe stays the system of
-- record for that. It adds:
--
--   1. ledger_entries: every money split of each paid order or payment
--      group, one line per party and type (charge, platform_fee,
--      clinic_transfer, pharmacy_payable, refund, dispute, reversal),
--      amounts in minor units from the frozen wholesale / retail /
--      shipping snapshots. Idempotent on (source_event_id, line_key): a
--      Stripe redelivery writes nothing twice. Append-only for every
--      role, the service role included.
--   2. pharmacy_payables: what each pharmacy is owed per order (wholesale
--      + shipping): owed, scheduled, paid, or void after a full refund.
--      reversed_cents tracks refunds against it. The only table here
--      that is updated; every ops change is logged in payable_events.
--   3. payable_events: the audit log of payable changes (who, what,
--      reference, date). Append-only.
--   4. reconciliation_runs: one row per daily Stripe reconciliation (the
--      day, the totals, the mismatches as Stripe IDs and amounts).
--      Append-only.
--
-- Reads: ops_admin only, from app_metadata (the JWT claim only the
-- service role can set). No write policies: the service role writes.
-- No patient data in any of these tables: IDs and amounts only.
--
-- Ordered after 20261015000001 (A). Ends by applying the pharmacy admin
-- scope (B's apply_pharmacy_admin_scope(), 20261014000001) when that
-- function exists; when it does not yet, B's migration covers these
-- tables when it runs, as it scopes every public table.

BEGIN;

CREATE OR REPLACE FUNCTION payments_append_only() RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

-- ── 1. ledger_entries ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ledger_entries (
  entry_id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          UUID        REFERENCES orders (order_id) ON DELETE RESTRICT,
  payment_group_id  UUID        REFERENCES payment_groups (group_id) ON DELETE RESTRICT,
  clinic_id         UUID,
  pharmacy_id       UUID,
  party             TEXT        NOT NULL CHECK (party IN ('platform', 'clinic', 'pharmacy')),
  entry_type        TEXT        NOT NULL CHECK (entry_type IN ('charge', 'platform_fee', 'clinic_transfer', 'pharmacy_payable', 'refund', 'dispute', 'reversal')),
  amount_cents      BIGINT      NOT NULL,
  currency          TEXT        NOT NULL DEFAULT 'usd' CHECK (currency ~ '^[a-z]{3}$'),
  stripe_object_id  TEXT        CHECK (stripe_object_id IS NULL OR stripe_object_id ~ '^[A-Za-z0-9_]{3,255}$'),
  status            TEXT        NOT NULL CHECK (status IN ('succeeded', 'pending', 'open', 'won', 'lost', 'failed')),
  source_event_id   TEXT        NOT NULL CHECK (length(source_event_id) BETWEEN 1 AND 255),
  line_key          TEXT        NOT NULL CHECK (length(line_key) BETWEEN 1 AND 255),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ledger_entries_idempotent UNIQUE (source_event_id, line_key),
  CHECK (order_id IS NOT NULL OR payment_group_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_ledger_entries_order ON ledger_entries (order_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_group ON ledger_entries (payment_group_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_stripe ON ledger_entries (stripe_object_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_created ON ledger_entries (created_at);

ALTER TABLE ledger_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ledger_entries_ops_read ON ledger_entries;
CREATE POLICY ledger_entries_ops_read ON ledger_entries FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'app_role') = 'ops_admin');
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ledger_entries FROM anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON ledger_entries FROM service_role;

DROP TRIGGER IF EXISTS ledger_entries_no_update_delete ON ledger_entries;
CREATE TRIGGER ledger_entries_no_update_delete
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION payments_append_only();
DROP TRIGGER IF EXISTS ledger_entries_no_truncate ON ledger_entries;
CREATE TRIGGER ledger_entries_no_truncate
  BEFORE TRUNCATE ON ledger_entries
  FOR EACH STATEMENT EXECUTE FUNCTION payments_append_only();

-- ── 2. pharmacy_payables ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS pharmacy_payables (
  payable_id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          UUID NOT NULL UNIQUE REFERENCES orders (order_id) ON DELETE RESTRICT,
  payment_group_id  UUID        REFERENCES payment_groups (group_id) ON DELETE RESTRICT,
  pharmacy_id       UUID        NOT NULL REFERENCES pharmacies (pharmacy_id) ON DELETE RESTRICT,
  clinic_id         UUID        NOT NULL,
  wholesale_cents   BIGINT      NOT NULL CHECK (wholesale_cents >= 0),
  shipping_cents    BIGINT      NOT NULL CHECK (shipping_cents >= 0),
  amount_cents      BIGINT      NOT NULL CHECK (amount_cents = wholesale_cents + shipping_cents),
  reversed_cents    BIGINT      NOT NULL DEFAULT 0 CHECK (reversed_cents >= 0 AND reversed_cents <= amount_cents),
  currency          TEXT        NOT NULL DEFAULT 'usd' CHECK (currency ~ '^[a-z]{3}$'),
  status            TEXT        NOT NULL DEFAULT 'owed' CHECK (status IN ('owed', 'scheduled', 'paid', 'void')),
  paid_on           DATE,
  paid_reference    TEXT        CHECK (paid_reference IS NULL OR length(paid_reference) BETWEEN 1 AND 120),
  paid_by           UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status <> 'paid' OR (paid_on IS NOT NULL AND paid_reference IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_pharmacy_payables_pharmacy ON pharmacy_payables (pharmacy_id, status);
CREATE INDEX IF NOT EXISTS idx_pharmacy_payables_paid_on ON pharmacy_payables (pharmacy_id, paid_on);

ALTER TABLE pharmacy_payables ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pharmacy_payables_ops_read ON pharmacy_payables;
CREATE POLICY pharmacy_payables_ops_read ON pharmacy_payables FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'app_role') = 'ops_admin');
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON pharmacy_payables FROM anon, authenticated;
-- A payable is voided, never deleted.
REVOKE DELETE, TRUNCATE ON pharmacy_payables FROM service_role;

-- ── 3. payable_events ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payable_events (
  event_id       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  payable_id     UUID        NOT NULL REFERENCES pharmacy_payables (payable_id) ON DELETE RESTRICT,
  action         TEXT        NOT NULL CHECK (action IN ('marked_scheduled', 'marked_paid')),
  actor_user_id  UUID        NOT NULL,
  reference      TEXT        CHECK (reference IS NULL OR length(reference) BETWEEN 1 AND 120),
  paid_on        DATE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payable_events_payable ON payable_events (payable_id, created_at);

ALTER TABLE payable_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payable_events_ops_read ON payable_events;
CREATE POLICY payable_events_ops_read ON payable_events FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'app_role') = 'ops_admin');
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON payable_events FROM anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON payable_events FROM service_role;

DROP TRIGGER IF EXISTS payable_events_no_update_delete ON payable_events;
CREATE TRIGGER payable_events_no_update_delete
  BEFORE UPDATE OR DELETE ON payable_events
  FOR EACH ROW EXECUTE FUNCTION payments_append_only();
DROP TRIGGER IF EXISTS payable_events_no_truncate ON payable_events;
CREATE TRIGGER payable_events_no_truncate
  BEFORE TRUNCATE ON payable_events
  FOR EACH STATEMENT EXECUTE FUNCTION payments_append_only();

-- ── 4. reconciliation_runs ───────────────────────────────────
CREATE TABLE IF NOT EXISTS reconciliation_runs (
  run_id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  recon_date      DATE        NOT NULL,
  status          TEXT        NOT NULL CHECK (status IN ('matched', 'mismatch', 'error')),
  ledger_cents    BIGINT      NOT NULL DEFAULT 0,
  stripe_cents    BIGINT      NOT NULL DEFAULT 0,
  stripe_count    INTEGER     NOT NULL DEFAULT 0 CHECK (stripe_count >= 0),
  mismatch_count  INTEGER     NOT NULL DEFAULT 0 CHECK (mismatch_count >= 0),
  -- [{stripe_object_id, kind, ledger_cents, stripe_cents}]: IDs and amounts only.
  details         JSONB       NOT NULL DEFAULT '[]'::jsonb,
  error           TEXT        CHECK (error IS NULL OR length(error) <= 500),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_runs_date ON reconciliation_runs (recon_date, created_at DESC);

ALTER TABLE reconciliation_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reconciliation_runs_ops_read ON reconciliation_runs;
CREATE POLICY reconciliation_runs_ops_read ON reconciliation_runs FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'app_role') = 'ops_admin');
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON reconciliation_runs FROM anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON reconciliation_runs FROM service_role;

DROP TRIGGER IF EXISTS reconciliation_runs_no_update_delete ON reconciliation_runs;
CREATE TRIGGER reconciliation_runs_no_update_delete
  BEFORE UPDATE OR DELETE ON reconciliation_runs
  FOR EACH ROW EXECUTE FUNCTION payments_append_only();
DROP TRIGGER IF EXISTS reconciliation_runs_no_truncate ON reconciliation_runs;
CREATE TRIGGER reconciliation_runs_no_truncate
  BEFORE TRUNCATE ON reconciliation_runs
  FOR EACH STATEMENT EXECUTE FUNCTION payments_append_only();

-- ── 5. Pharmacy admin scope (B) ──────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('apply_pharmacy_admin_scope()') IS NOT NULL THEN
    PERFORM apply_pharmacy_admin_scope();
  ELSE
    RAISE NOTICE 'apply_pharmacy_admin_scope() not present yet; its migration scopes these tables when it runs';
  END IF;
END $$;

COMMIT;
