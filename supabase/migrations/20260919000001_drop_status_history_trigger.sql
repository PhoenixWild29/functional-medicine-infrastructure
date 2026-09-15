-- ============================================================
-- Drop the log_order_status_changes trigger; add
-- record_order_status_change() for manual SQL status changes
-- ============================================================
--
-- Prod: the order timeline showed every status change twice. The
-- AFTER UPDATE trigger log_order_status_changes (migration
-- 20260318000001) inserted a row with changed_by NULL and metadata NULL,
-- because app.current_user is never set, and the application inserted
-- its own row for the same change with an actor and metadata.
--
-- Every application path that writes orders.status now inserts its own
-- order_status_history row with an actor:
--   - casTransition (src/lib/orders/cas-transition.ts), used by all 34
--     call sites in the webhooks, crons, ops actions, routing engine and
--     adapters. Each call passes an actor.
--   - sign-and-send, DRAFT → AWAITING_PAYMENT (actor: provider user id)
--   - cron payment-expiry, → PAYMENT_EXPIRED ('cron:payment-expiry')
--   - ops reroute, → REROUTE_PENDING ('ops:<email>')
--   - scripts/simulate-payment.ts ('script:simulate-payment')
-- casTransitionRpc, which wrote no history, was unused and has been removed.
-- The trigger therefore only produced duplicates.
--
-- Without the trigger, a failed application insert would leave a status
-- change with no audit row at all. Every application insert now goes
-- through insertStatusHistory (src/lib/orders/status-history.ts). It
-- stays non-fatal, but a failure raises a Slack alert naming the order
-- id, transition, actor and time, so the row can be rebuilt with the
-- helper below.
--
-- One thing the trigger also covered: a status changed by hand in SQL.
-- That now needs an explicit history row. Use record_order_status_change(),
-- in the same transaction as the UPDATE, after it:
--
--   BEGIN;
--   UPDATE orders
--      SET status = 'CANCELLED'
--    WHERE order_id = '<order uuid>' AND status = 'AWAITING_PAYMENT'
--   RETURNING order_id, status;
--   SELECT record_order_status_change(
--     '<order uuid>',
--     'AWAITING_PAYMENT',                  -- old status
--     'CANCELLED',                         -- new status
--     'manual_sql:<your name or email>',   -- actor, required
--     '{"reason": "<why>"}'                -- metadata, optional
--   );
--   COMMIT;
--
-- The function raises an exception, which aborts the transaction and so
-- also undoes the UPDATE, when:
--   - the actor is NULL or blank,
--   - the old and new status are the same,
--   - the order does not exist, or
--   - the order's current status is not the new status. This catches a
--     call made before the UPDATE, or an UPDATE that matched no row.
-- It returns the new history_id. Only the owner (postgres) and
-- service_role may execute it. It is not callable through the API as
-- anon or authenticated.
--
-- Existing duplicate rows are left in place. Removing them is a separate,
-- manual cleanup.

BEGIN;

DROP TRIGGER IF EXISTS log_order_status_changes ON orders;
DROP FUNCTION IF EXISTS log_status_change();

CREATE OR REPLACE FUNCTION record_order_status_change(
  p_order_id   UUID,
  p_old_status order_status_enum,
  p_new_status order_status_enum,
  p_actor      TEXT,
  p_metadata   JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_current    order_status_enum;
  v_history_id UUID;
BEGIN
  IF p_actor IS NULL OR btrim(p_actor) = '' THEN
    RAISE EXCEPTION 'record_order_status_change: an actor is required (e.g. ''manual_sql:<name>'')';
  END IF;

  IF p_old_status IS NOT DISTINCT FROM p_new_status THEN
    RAISE EXCEPTION 'record_order_status_change: old and new status are both %', p_new_status;
  END IF;

  SELECT status INTO v_current FROM orders WHERE order_id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'record_order_status_change: order % not found', p_order_id;
  END IF;

  IF v_current IS DISTINCT FROM p_new_status THEN
    RAISE EXCEPTION 'record_order_status_change: order % is %, not %; run the UPDATE first, in the same transaction',
      p_order_id, v_current, p_new_status;
  END IF;

  INSERT INTO order_status_history (order_id, old_status, new_status, changed_by, metadata)
  VALUES (p_order_id, p_old_status, p_new_status, btrim(p_actor), p_metadata)
  RETURNING history_id INTO v_history_id;

  RETURN v_history_id;
END;
$$;

COMMENT ON FUNCTION record_order_status_change(UUID, order_status_enum, order_status_enum, TEXT, JSONB) IS
  'Records an order_status_history row with an explicit actor for a status changed by hand in SQL. Call it after the UPDATE, in the same transaction. The log_order_status_changes trigger was dropped in 20260919000001; the application writes its own history rows. See that migration for usage.';

REVOKE ALL ON FUNCTION record_order_status_change(UUID, order_status_enum, order_status_enum, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION record_order_status_change(UUID, order_status_enum, order_status_enum, TEXT, JSONB) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION record_order_status_change(UUID, order_status_enum, order_status_enum, TEXT, JSONB) TO service_role;

COMMIT;
