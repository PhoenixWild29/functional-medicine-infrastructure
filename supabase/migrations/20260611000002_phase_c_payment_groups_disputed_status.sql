-- ============================================================
-- Phase C Stage 6: add 'DISPUTED' to payment_groups.status CHECK
-- ============================================================
--
-- The original Phase C Stage 1 migration (20260609000001) enforces
-- status IN ('AWAITING_PAYMENT','PAID','EXPIRED','CANCELLED') via a
-- TEXT CHECK constraint. The new group dispute handler
-- (src/app/api/webhooks/stripe/handle-group-dispute.ts) needs to mark
-- payment_groups.status = 'DISPUTED' when Stripe sends a
-- charge.dispute.created event whose PaymentIntent maps to a group.
--
-- We swap the CHECK constraint to allow the new value. Going via TEXT
-- + CHECK (vs. a proper enum type) keeps the migration trivial and
-- matches the forward-compatibility note in 20260609000001.
--
-- Idempotent: the DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT pattern
-- is safe to re-run.

ALTER TABLE payment_groups
  DROP CONSTRAINT IF EXISTS payment_groups_status_check;

ALTER TABLE payment_groups
  ADD CONSTRAINT payment_groups_status_check
  CHECK (status IN ('AWAITING_PAYMENT','PAID','EXPIRED','CANCELLED','DISPUTED'));
