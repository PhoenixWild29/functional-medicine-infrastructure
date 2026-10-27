-- ============================================================
-- Indexes for the hot reads on orders (C-2026-10-25-11)
-- ============================================================
--
-- orders had no index on clinic_id, provider_id, status or created_at,
-- and only a DRAFT-only partial index on updated_at
-- (idx_orders_draft_updated_at). Every read below filtered or sorted the
-- whole table. Each index is partial on deleted_at IS NULL, as every one
-- of these reads is, and names the query it serves:
--
--   idx_orders_clinic_updated (clinic_id, updated_at DESC)
--     The clinic dashboard order list: dashboard/page.tsx (server render)
--     and orders-dashboard.tsx (the 30-second poll), clinic_id = $1,
--     ORDER BY updated_at DESC. Also the ops pipeline filtered by clinic
--     (lib/ops/pipeline-query.ts), and the clinic_id predicate of the
--     clinic RLS policies on orders.
--
--   idx_orders_clinic_created (clinic_id, created_at)
--     The Practice dashboard's period read (lib/practice/load.ts,
--     clinic_id = $1 AND created_at >= $from AND created_at < $to), the
--     dashboard's prior-year totals (dashboard/page.tsx, the same shape)
--     and the needs-attention list (lib/practice/attention.ts, clinic_id
--     and status, ORDER BY created_at).
--
--   idx_orders_provider_created (provider_id, created_at DESC)
--     Frequently used favorites (api/favorites/frequent on
--     favorites-frequent: provider_id = $1, created_at >= now - 90 days,
--     ORDER BY created_at DESC) and api/favorites/recent on main (the
--     same shape with no window). Flagged in the 2026-10-25 high-risk
--     review.
--
--   idx_orders_status_updated (status, updated_at)
--     The crons that scan by status: submit-paid-orders (status =
--     'PAID_PROCESSING', updated_at window, ORDER BY updated_at),
--     refund-retry (status = 'REFUND_PENDING'), payment-expiry (status =
--     'AWAITING_PAYMENT', then locked_at), the ops SLA page (status), and
--     the ops pipeline's status filter.
--
--   idx_orders_updated (updated_at DESC)
--     The ops pipeline's default view (lib/ops/pipeline-query.ts with no
--     filter: ORDER BY updated_at DESC LIMIT 500), the ops landing page.
--
-- Not CONCURRENTLY: supabase db push (CI and deploy) runs each migration
-- file in a transaction, and CREATE INDEX CONCURRENTLY cannot run in one.
-- A plain CREATE INDEX takes a SHARE lock on orders: reads go on, writes
-- wait for the build, which on today's demo-sized table takes
-- milliseconds. IF NOT EXISTS makes a re-run a no-op.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_orders_clinic_updated
  ON orders (clinic_id, updated_at DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_orders_clinic_created
  ON orders (clinic_id, created_at) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_orders_provider_created
  ON orders (provider_id, created_at DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_orders_status_updated
  ON orders (status, updated_at) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_orders_updated
  ON orders (updated_at DESC) WHERE deleted_at IS NULL;

COMMIT;
