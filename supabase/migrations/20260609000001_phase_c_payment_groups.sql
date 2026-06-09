-- ============================================================
-- Phase C Stage 1: payment_groups table + orders.payment_group_id
-- ============================================================
--
-- A payment_group bundles N orders for ONE patient at ONE clinic
-- from ONE provider into a single Stripe PaymentIntent. The patient
-- pays once for all N prescriptions; the webhook handler atomically
-- transitions all N orders from AWAITING_PAYMENT → PAID.
--
-- Constraints enforced at the application layer (POST /api/checkout/
-- payment-group), not all in the DB, because the validation needs
-- access to order snapshots:
--   - All N orders share the same clinic_id, provider_id, patient_id
--   - All N orders are in AWAITING_PAYMENT
--   - The calling auth user is the provider (provider.user_id =
--     session.user.id) — F-2 + F-3 carryover
--   - Each order is included in AT MOST ONE active group at a time
--     (enforced via the partial unique index below)
--
-- Solo-order path (orders.payment_group_id IS NULL) continues to
-- work unchanged via the existing /api/checkout/payment-intent route
-- and orders.stripe_payment_intent_id column. Patients with a single
-- prescription do not pay through the group flow.
--
-- Status enum kept as TEXT + CHECK for forward-compatibility — adding
-- a value later does not require a separate migration to alter the
-- enum type.
--
-- This is Stage 1 of Phase C (schema only). Subsequent stages:
--   Stage 2: POST /api/checkout/payment-group endpoint
--   Stage 3: webhook update for atomic N-order paid transition
--   Stage 4: clinic-side "Combine and Send" UI in order drawer
--   Stage 5: patient-side multi-line-item checkout UI

-- ── Table ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payment_groups (
  group_id                  UUID         NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id                 UUID         NOT NULL REFERENCES clinics(clinic_id),
  patient_id                UUID         NOT NULL REFERENCES patients(patient_id),
  provider_id               UUID         NOT NULL REFERENCES providers(provider_id),
  stripe_payment_intent_id  TEXT,        -- nullable until the PaymentIntent is created
  total_cents               INTEGER      NOT NULL CHECK (total_cents > 0),
  status                    TEXT         NOT NULL DEFAULT 'AWAITING_PAYMENT'
    CHECK (status IN ('AWAITING_PAYMENT','PAID','EXPIRED','CANCELLED')),
  created_at                TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ  NOT NULL DEFAULT now(),
  deleted_at                TIMESTAMPTZ,
  is_active                 BOOLEAN      NOT NULL DEFAULT true
);

COMMENT ON TABLE payment_groups IS
  'Phase C: bundles N orders into one Stripe PaymentIntent so a patient pays once for multiple prescriptions. All N orders must share clinic + patient + provider (enforced at the application layer). Solo-order checkouts continue via orders.stripe_payment_intent_id; this table is opt-in for the multi-Rx flow.';

COMMENT ON COLUMN payment_groups.stripe_payment_intent_id IS
  'Set once the application creates the bundled PaymentIntent. Nullable to allow group-row creation before Stripe call (transient state).';

CREATE INDEX IF NOT EXISTS idx_payment_groups_clinic_id
  ON payment_groups (clinic_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_payment_groups_patient_id
  ON payment_groups (patient_id)
  WHERE deleted_at IS NULL;

-- Idempotency: at most one Stripe PaymentIntent per group, among non-deleted.
CREATE UNIQUE INDEX IF NOT EXISTS payment_groups_stripe_pi_unique
  ON payment_groups (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE payment_groups ENABLE ROW LEVEL SECURITY;

-- ── orders.payment_group_id ──────────────────────────────────

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS payment_group_id UUID REFERENCES payment_groups(group_id) ON DELETE SET NULL;

COMMENT ON COLUMN orders.payment_group_id IS
  'Phase C: optional link to a payment_group. NULL = solo-order checkout (legacy single-PaymentIntent path via orders.stripe_payment_intent_id). Set to a group_id when the order joins a bundled checkout.';

-- An order may be in at most one ACTIVE group at any time. This guards
-- against a patient regenerating a solo link while an unpaid group link
-- is already in flight, OR an order being added to two different groups.
CREATE UNIQUE INDEX IF NOT EXISTS orders_payment_group_unique
  ON orders (order_id)
  WHERE payment_group_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_orders_payment_group_id
  ON orders (payment_group_id)
  WHERE payment_group_id IS NOT NULL AND deleted_at IS NULL;

-- ── RLS ──────────────────────────────────────────────────────
-- Same scope as existing orders / patients policies: clinic users
-- see their own clinic's groups; service role bypasses (used by
-- webhook handlers + ops surfaces). Mirrors the pattern in
-- 20260317000004_create_rls_and_triggers.sql.

DROP POLICY IF EXISTS payment_groups_clinic_user_select ON payment_groups;
CREATE POLICY payment_groups_clinic_user_select ON payment_groups
  FOR SELECT TO authenticated
  USING (clinic_id = (auth.jwt() ->> 'clinic_id')::UUID);

DROP POLICY IF EXISTS payment_groups_clinic_user_insert ON payment_groups;
CREATE POLICY payment_groups_clinic_user_insert ON payment_groups
  FOR INSERT TO authenticated
  WITH CHECK (clinic_id = (auth.jwt() ->> 'clinic_id')::UUID);

DROP POLICY IF EXISTS payment_groups_clinic_user_update ON payment_groups
  ;
CREATE POLICY payment_groups_clinic_user_update ON payment_groups
  FOR UPDATE TO authenticated
  USING (clinic_id = (auth.jwt() ->> 'clinic_id')::UUID);

DROP POLICY IF EXISTS payment_groups_service_role_all ON payment_groups;
CREATE POLICY payment_groups_service_role_all ON payment_groups
  FOR ALL TO service_role
  USING (true);

-- ── updated_at trigger (matches the project's existing pattern) ──

DROP TRIGGER IF EXISTS set_updated_at_payment_groups ON payment_groups;
CREATE TRIGGER set_updated_at_payment_groups
  BEFORE UPDATE ON payment_groups
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
