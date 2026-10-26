-- Issue Log 72: ops open inbound faxes from Documo on demand
-- (GET /api/ops/fax/[faxId]/pdf). Each view writes one phi_access_log row;
-- this column records which fax (inbound_fax_queue.fax_id).
--
-- Additive and safe to apply twice. No foreign key on purpose: the audit
-- log is append-only and outlives the queue row (a deleted or archived fax
-- must not take its access history with it, or block the delete).

BEGIN;

ALTER TABLE phi_access_log ADD COLUMN IF NOT EXISTS fax_id uuid;

CREATE INDEX IF NOT EXISTS idx_phi_access_log_fax_time
  ON phi_access_log (fax_id, occurred_at DESC)
  WHERE fax_id IS NOT NULL;

COMMENT ON COLUMN phi_access_log.fax_id IS
  'The inbound fax viewed (inbound_fax_queue.fax_id), when the resource is inbound_fax. No FK: the log outlives the queue row.';

COMMIT;
