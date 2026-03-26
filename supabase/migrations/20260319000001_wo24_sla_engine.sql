-- ============================================================
-- SLA Deadline Monitoring Engine — WO-24
-- ============================================================
--
-- REQ-SLM-001 through REQ-SLM-018 (FRD 5 v2.0, Sub-Feature 5a)
--
-- Changes:
--   1. sla_type_enum: add V2.0 types ADAPTER_SUBMISSION_ACK + PHARMACY_COMPOUNDING_ACK
--   2. pharmacies: add timezone column for business-hours deadline calculation
--   3. order_sla_deadlines: add last_alerted_at for 15-min re-fire timer (WO-25)
--      and cascade_attempted for ADAPTER_SUBMISSION_ACK cascade audit trail
--   4. Indexes for sla-check hot query path (breach scan every 5 minutes)
--
-- All ALTER TABLE use ADD COLUMN IF NOT EXISTS — idempotent.
-- Enum ADD VALUE is idempotent in Postgres 9.1+.

-- ============================================================
-- 1. SLA TYPE ENUM — V2.0 additions (REQ-SLM-005, REQ-SLM-006)
-- ============================================================
-- ADAPTER_SUBMISSION_ACK: Tier 1/3 = 15 min, Tier 2 = 30 min wall clock
--   Trigger: SUBMISSION_PENDING
--   Resolve: PHARMACY_ACKNOWLEDGED (adapter confirmed)
--   Breach:  cascade-then-escalate (try Tier 4 fax first)
--
-- PHARMACY_COMPOUNDING_ACK: 2 business hours, Tier 1/2/3 only
--   Trigger: PHARMACY_ACKNOWLEDGED
--   Resolve: PHARMACY_COMPOUNDING
--   Breach:  escalate to ops (pharmacy lag alert)

ALTER TYPE sla_type_enum ADD VALUE IF NOT EXISTS 'ADAPTER_SUBMISSION_ACK';
ALTER TYPE sla_type_enum ADD VALUE IF NOT EXISTS 'PHARMACY_COMPOUNDING_ACK';

-- ============================================================
-- 2. PHARMACIES — timezone column
-- ============================================================
-- Business-hours SLAs (PHARMACY_ACKNOWLEDGE, PHARMACY_CONFIRMATION,
-- PHARMACY_COMPOUNDING_ACK, SHIPPING) are calculated in the pharmacy's
-- local timezone. Defaults to Eastern Time.

ALTER TABLE pharmacies
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/New_York';

-- ============================================================
-- 3. ORDER_SLA_DEADLINES — V2.0 columns
-- ============================================================
-- last_alerted_at: timestamp of the most recent Slack alert for this SLA.
--   Used by WO-25 to enforce the 15-minute re-fire timer for
--   unacknowledged Tier 1 alerts before escalating to Tier 2.
--
-- cascade_attempted: true after ADAPTER_SUBMISSION_ACK breach triggers
--   a cascade-to-Tier-4-fax attempt. Prevents duplicate cascade attempts
--   on subsequent sla-check runs before the order status updates.

ALTER TABLE order_sla_deadlines
  ADD COLUMN IF NOT EXISTS last_alerted_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cascade_attempted  BOOLEAN NOT NULL DEFAULT false;

-- ============================================================
-- 4. INDEXES — hot path for sla-check cron (*/5 schedule)
-- ============================================================
-- Primary breach scan: unresolved SLAs past their deadline
CREATE INDEX IF NOT EXISTS idx_sla_breach_scan
  ON order_sla_deadlines (deadline_at)
  WHERE resolved_at IS NULL
    AND is_active = true;

-- Re-fire timer: find recently alerted but unacknowledged SLAs
CREATE INDEX IF NOT EXISTS idx_sla_unacknowledged
  ON order_sla_deadlines (last_alerted_at)
  WHERE acknowledged_at IS NULL
    AND resolved_at IS NULL
    AND escalated = true;
