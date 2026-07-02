-- ============================================================
-- 24h Ephemeral PHI Debug Payload Table
-- ============================================================
--
-- Follow-up to PR #88 (PHI redaction Option B). The redaction
-- strips PHI from `adapter_submissions.request_payload` at write
-- time, so when an outbound pharmacy adapter call fails ops have
-- only the SHA-256 fingerprint + structural shape to triage with.
-- The PHI policy memo
-- (`docs/audits/phi-policy-adapter-submissions.md`) reserved a
-- carve-out: a side table that holds the FULL pre-redaction
-- payload for 24 hours, then a cron purges anything older.
--
-- TRADE-OFF acknowledged in the memo:
--   - GAIN: ops gets debuggability for the recency window where
--     most triage actually happens (failed submission → 24h to
--     replay or escalate).
--   - COST: 24h of full PHI sitting in a side table.
--
-- Mitigations baked into the schema:
--   1. STRICT RLS — no `TO authenticated` policies are defined.
--      Only `service_role` (which bypasses RLS) can read or
--      write this table. No clinic/provider/ops session has ANY
--      ability to query it. This is intentional and the comment
--      below documents it.
--   2. FK with ON DELETE CASCADE so debug rows disappear if the
--      parent submission is ever (defensively) deleted.
--   3. Indexed on `created_at` so the retention sweep stays cheap
--      as the table grows during steady-state operation.
--
-- Write site:
--   `src/lib/adapters/audit-trail.ts:markSubmitted` writes here
--   AFTER the redacted `adapter_submissions` row INSERT succeeds,
--   gated by env flag `PHI_DEBUG_ENABLED === 'true'`. The debug
--   write is best-effort — failures log + swallow, NEVER fail the
--   primary submission write.
--
-- Retention:
--   `/api/cron/purge-phi-debug` runs daily at 03:00 UTC and
--   deletes rows older than 24h. See `vercel.json`.
--
-- Backfill: NONE. Historical submissions don't get retroactive
-- debug rows. Forward-only from the moment the flag flips.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT
-- EXISTS. Safe to apply twice.
-- ============================================================

CREATE TABLE IF NOT EXISTS adapter_submission_debug_payloads (
  debug_id              UUID         NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  adapter_submission_id UUID         NOT NULL
                                       REFERENCES adapter_submissions(submission_id)
                                       ON DELETE CASCADE,
  raw_payload           JSONB        NOT NULL,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Index for the retention sweep — keeps DELETE WHERE created_at < cutoff fast.
CREATE INDEX IF NOT EXISTS idx_adapter_submission_debug_payloads_created_at
  ON adapter_submission_debug_payloads (created_at);

-- Helper index for "find debug rows for this submission" — small table
-- relative to adapter_submissions (24h retention vs forever), but the
-- FK lookup is the primary access path when ops needs to triage.
CREATE INDEX IF NOT EXISTS idx_adapter_submission_debug_payloads_submission_id
  ON adapter_submission_debug_payloads (adapter_submission_id);

-- ── Strict RLS — service_role only ────────────────────────────
-- RLS is enabled but NO `TO authenticated` policies are created.
-- Under PostgreSQL RLS semantics, that means authenticated sessions
-- match no policy → see no rows and cannot insert / update / delete.
-- `service_role` bypasses RLS entirely (Supabase contract), so the
-- audit-trail writer + the purge cron (both service_role) work
-- normally. This mirrors the intent of the policy memo: NOTHING in
-- a user-facing code path should ever be able to read this table.
ALTER TABLE adapter_submission_debug_payloads ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE adapter_submission_debug_payloads IS
  '24h ephemeral PHI debug retention. Holds the FULL pre-redaction '
  'outbound pharmacy payload for ops triage. Strict service-role-only '
  'access (RLS enabled, ZERO `TO authenticated` policies by design). '
  'Purged daily by /api/cron/purge-phi-debug. Write-gated by '
  'PHI_DEBUG_ENABLED env flag — flip only when ops needs the visibility. '
  'See docs/audits/phi-policy-adapter-submissions.md "Ephemeral debug payloads".';

COMMENT ON COLUMN adapter_submission_debug_payloads.raw_payload IS
  'Full pre-redaction outbound pharmacy payload. PHI. Retained 24h max. '
  'NEVER readable by any authenticated session — service_role only.';
