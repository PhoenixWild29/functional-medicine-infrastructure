-- ============================================================
-- PR #7a (cowork round-3): GIN index on adapter_submissions.metadata
-- ============================================================
--
-- The POC demo-data refresh path (src/lib/poc/refresh-demo-data.ts)
-- identifies seed rows by metadata->>'poc_seed' = 'true' and uses
-- `.contains('metadata', { poc_seed: true })` on both count and
-- delete queries. Without a GIN index, those queries scan the full
-- adapter_submissions table.
--
-- At POC scale (~200 seed rows) this is negligible, but the cron
-- runs daily and the "Refresh Demo Data" button runs ad hoc. As the
-- underlying adapter_submissions table grows past ~10k real rows
-- (expected once a handful of clinics onboard), the unindexed scan
-- becomes O(n) per cron tick. Adding the index now is cheap future
-- insurance — the production code already uses metadata for
-- cascade_reason / ops_override / retry context (WO-46 migration
-- 20260318000009), which would benefit from the same index as those
-- lookup patterns emerge.
--
-- `jsonb_path_ops` opclass is chosen over the default `jsonb_ops`
-- because we only use the @> containment operator, not the richer
-- ? / ?| / ?& key-existence operators. jsonb_path_ops produces a
-- smaller, faster index at the cost of supporting fewer operators —
-- a strict improvement for this workload.

CREATE INDEX IF NOT EXISTS adapter_submissions_metadata_gin
  ON adapter_submissions
  USING GIN (metadata jsonb_path_ops);
