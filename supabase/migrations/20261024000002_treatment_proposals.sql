-- ============================================================
-- Patient protocol choice, PR 1: the data model
-- ============================================================
--
-- docs/design/patient-protocol-choice.md (approved by Sam 2026-10-24).
-- A provider sends a patient a treatment proposal: one or more options,
-- each a set of ordinary DRAFT orders tagged to it, some marked required.
-- The patient chooses on their phone; the provider then signs only the
-- chosen lines. No order status is added: a "Proposed" order is a DRAFT
-- with proposal_option_id set.
--
--   1. treatment_proposals: one per proposal sent to a patient. Only the
--      SHA-256 of the plan link token is stored (unique), with its 7-day
--      expiry, the date-of-birth failures and the lock.
--   2. treatment_proposal_options: Option A, Option B... with the label
--      the provider types (at most 80 characters) and the protocol it
--      came from, if any.
--   3. orders.proposal_option_id and orders.proposal_required.
--   4. proposal_choice_items: which items the patient kept, one row per
--      item per choice (choice_no counts re-choices). Append-only.
--   5. treatment_proposal_events: append-only audit, no PHI. Includes how
--      the link reached the patient: link_copied, qr_shown or sms_sent
--      (the link never depends on texting; there is no Twilio account).
--
-- RLS on every new table, from app_metadata only (src/lib/auth/claims):
-- clinic users of the proposal's clinic read; ops_admin reads; the
-- service role writes (no write policy). A proposal is never deleted,
-- and none of these tables is a retention target. Ends with
-- apply_pharmacy_admin_scope() (20261014000001) as the last statement
-- before COMMIT.

BEGIN;

-- ── 1. treatment_proposals ───────────────────────────────────
CREATE TABLE IF NOT EXISTS treatment_proposals (
  proposal_id      UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id        UUID        NOT NULL REFERENCES clinics(clinic_id),
  patient_id       UUID        NOT NULL REFERENCES patients(patient_id),
  provider_id      UUID        NOT NULL REFERENCES providers(provider_id),
  created_by       UUID,
  status           TEXT        NOT NULL DEFAULT 'draft'
                   CONSTRAINT chk_treatment_proposals_status CHECK (status IN ('draft', 'sent', 'chosen', 'signed', 'declined', 'expired', 'cancelled')),
  token_hash       TEXT        CONSTRAINT chk_treatment_proposals_token_hash CHECK (token_hash IS NULL OR token_hash ~ '^[0-9a-f]{64}$'),
  expires_at       TIMESTAMPTZ,
  sent_at          TIMESTAMPTZ,
  first_viewed_at  TIMESTAMPTZ,
  chosen_option_id UUID,
  chosen_at        TIMESTAMPTZ,
  signed_at        TIMESTAMPTZ,
  declined_at      TIMESTAMPTZ,
  cancelled_at     TIMESTAMPTZ,
  dob_failures     INTEGER     NOT NULL DEFAULT 0 CONSTRAINT chk_treatment_proposals_dob_failures CHECK (dob_failures >= 0),
  locked_at        TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A sent proposal has a link and its expiry; a draft has neither.
  CONSTRAINT chk_treatment_proposals_link CHECK (status = 'draft' OR (sent_at IS NOT NULL AND expires_at IS NOT NULL)),
  CONSTRAINT chk_treatment_proposals_chosen CHECK (status NOT IN ('chosen', 'signed') OR (chosen_option_id IS NOT NULL AND chosen_at IS NOT NULL))
);

COMMENT ON TABLE treatment_proposals IS 'Patient protocol choice: a proposal sent to a patient. SHA-256 of the plan link token only; 7-day link.';
COMMENT ON COLUMN treatment_proposals.created_by IS 'The auth user who created the proposal (provider, or a clinic admin on their behalf).';
COMMENT ON COLUMN treatment_proposals.token_hash IS 'SHA-256 (hex) of the current plan link token. Re-sending replaces it, so the old link stops working.';
COMMENT ON COLUMN treatment_proposals.dob_failures IS 'Wrong dates of birth on the plan link; 5 lock it (locked_at).';

CREATE UNIQUE INDEX IF NOT EXISTS uq_treatment_proposals_token_hash ON treatment_proposals (token_hash) WHERE token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_treatment_proposals_clinic_status ON treatment_proposals (clinic_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_treatment_proposals_patient ON treatment_proposals (patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_treatment_proposals_expiry ON treatment_proposals (expires_at) WHERE status = 'sent';

DROP TRIGGER IF EXISTS treatment_proposals_set_updated_at ON treatment_proposals;
CREATE TRIGGER treatment_proposals_set_updated_at
  BEFORE UPDATE ON treatment_proposals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE treatment_proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS treatment_proposals_clinic_read ON treatment_proposals;
CREATE POLICY treatment_proposals_clinic_read ON treatment_proposals FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'app_role') IN ('clinic_admin', 'provider', 'medical_assistant')
         AND clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID);
DROP POLICY IF EXISTS treatment_proposals_ops_read ON treatment_proposals;
CREATE POLICY treatment_proposals_ops_read ON treatment_proposals FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'app_role') = 'ops_admin');
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON treatment_proposals FROM anon, authenticated;
REVOKE DELETE, TRUNCATE ON treatment_proposals FROM service_role;

-- ── 2. treatment_proposal_options ────────────────────────────
CREATE TABLE IF NOT EXISTS treatment_proposal_options (
  option_id   UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  proposal_id UUID        NOT NULL REFERENCES treatment_proposals(proposal_id),
  label       TEXT        NOT NULL CONSTRAINT chk_proposal_options_label CHECK (char_length(label) BETWEEN 1 AND 80),
  position    INTEGER     NOT NULL CONSTRAINT chk_proposal_options_position CHECK (position >= 0),
  protocol_id UUID        REFERENCES protocol_templates(protocol_id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (proposal_id, position)
);

COMMENT ON TABLE treatment_proposal_options IS 'Patient protocol choice: Option A, Option B... of a proposal, with the patient-facing label.';

CREATE INDEX IF NOT EXISTS idx_proposal_options_proposal ON treatment_proposal_options (proposal_id);

ALTER TABLE treatment_proposals DROP CONSTRAINT IF EXISTS fk_treatment_proposals_chosen_option;
ALTER TABLE treatment_proposals ADD CONSTRAINT fk_treatment_proposals_chosen_option
  FOREIGN KEY (chosen_option_id) REFERENCES treatment_proposal_options(option_id);

ALTER TABLE treatment_proposal_options ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS proposal_options_clinic_read ON treatment_proposal_options;
CREATE POLICY proposal_options_clinic_read ON treatment_proposal_options FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'app_role') IN ('clinic_admin', 'provider', 'medical_assistant')
         AND EXISTS (SELECT 1 FROM treatment_proposals p WHERE p.proposal_id = treatment_proposal_options.proposal_id
                       AND p.clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID));
DROP POLICY IF EXISTS proposal_options_ops_read ON treatment_proposal_options;
CREATE POLICY proposal_options_ops_read ON treatment_proposal_options FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'app_role') = 'ops_admin');
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON treatment_proposal_options FROM anon, authenticated;

-- ── 3. orders: the option a DRAFT line belongs to ────────────
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS proposal_option_id UUID REFERENCES treatment_proposal_options(option_id),
  ADD COLUMN IF NOT EXISTS proposal_required BOOLEAN;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_orders_proposal_pair;
ALTER TABLE orders ADD CONSTRAINT chk_orders_proposal_pair CHECK ((proposal_option_id IS NULL) = (proposal_required IS NULL));

COMMENT ON COLUMN orders.proposal_option_id IS 'Patient protocol choice: the proposal option this DRAFT line belongs to (NULL for ordinary orders).';
COMMENT ON COLUMN orders.proposal_required IS 'Patient protocol choice: the provider marked this line required (the patient cannot untick it). Set with proposal_option_id.';

CREATE INDEX IF NOT EXISTS idx_orders_proposal_option ON orders (proposal_option_id) WHERE proposal_option_id IS NOT NULL;

-- ── 4. Append-only guard for the choice items and events ────
CREATE OR REPLACE FUNCTION proposals_append_only() RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

-- ── 5. proposal_choice_items ─────────────────────────────────
CREATE TABLE IF NOT EXISTS proposal_choice_items (
  choice_item_id UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  proposal_id    UUID        NOT NULL REFERENCES treatment_proposals(proposal_id),
  option_id      UUID        NOT NULL REFERENCES treatment_proposal_options(option_id),
  order_id       UUID        NOT NULL REFERENCES orders(order_id),
  choice_no      INTEGER     NOT NULL CONSTRAINT chk_proposal_choice_items_choice_no CHECK (choice_no >= 1),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (proposal_id, choice_no, order_id)
);

COMMENT ON TABLE proposal_choice_items IS 'Patient protocol choice: the items the patient kept, per choice (choice_no counts re-choices). Append-only.';

CREATE INDEX IF NOT EXISTS idx_proposal_choice_items_proposal ON proposal_choice_items (proposal_id, choice_no DESC);

ALTER TABLE proposal_choice_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS proposal_choice_items_clinic_read ON proposal_choice_items;
CREATE POLICY proposal_choice_items_clinic_read ON proposal_choice_items FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'app_role') IN ('clinic_admin', 'provider', 'medical_assistant')
         AND EXISTS (SELECT 1 FROM treatment_proposals p WHERE p.proposal_id = proposal_choice_items.proposal_id
                       AND p.clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID));
DROP POLICY IF EXISTS proposal_choice_items_ops_read ON proposal_choice_items;
CREATE POLICY proposal_choice_items_ops_read ON proposal_choice_items FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'app_role') = 'ops_admin');
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON proposal_choice_items FROM anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON proposal_choice_items FROM service_role;

DROP TRIGGER IF EXISTS proposal_choice_items_no_update_delete ON proposal_choice_items;
CREATE TRIGGER proposal_choice_items_no_update_delete
  BEFORE UPDATE OR DELETE ON proposal_choice_items
  FOR EACH ROW EXECUTE FUNCTION proposals_append_only();
DROP TRIGGER IF EXISTS proposal_choice_items_no_truncate ON proposal_choice_items;
CREATE TRIGGER proposal_choice_items_no_truncate
  BEFORE TRUNCATE ON proposal_choice_items
  FOR EACH STATEMENT EXECUTE FUNCTION proposals_append_only();

-- ── 6. treatment_proposal_events ─────────────────────────────
CREATE TABLE IF NOT EXISTS treatment_proposal_events (
  event_id      UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  proposal_id   UUID        NOT NULL REFERENCES treatment_proposals(proposal_id),
  event         TEXT        NOT NULL
                CONSTRAINT chk_treatment_proposal_events_event CHECK (event IN (
                  'created', 'sent', 'resent', 'link_copied', 'qr_shown', 'sms_sent', 'reminder_sent',
                  'viewed', 'dob_failed', 'locked', 'chosen', 'rechosen', 'declined', 'signed', 'expired', 'cancelled'
                )),
  actor         TEXT        NOT NULL
                CONSTRAINT chk_treatment_proposal_events_actor CHECK (actor IN ('provider', 'clinic_staff', 'patient', 'system', 'ops')),
  actor_user_id UUID,
  option_id     UUID        REFERENCES treatment_proposal_options(option_id),
  item_count    INTEGER     CONSTRAINT chk_treatment_proposal_events_item_count CHECK (item_count IS NULL OR item_count >= 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE treatment_proposal_events IS 'Patient protocol choice: append-only audit of each step (no PHI). link_copied / qr_shown / sms_sent record how the link reached the patient.';
COMMENT ON COLUMN treatment_proposal_events.actor_user_id IS 'The auth user for provider / clinic_staff / ops events; NULL for the patient and the system.';

CREATE INDEX IF NOT EXISTS idx_treatment_proposal_events_proposal ON treatment_proposal_events (proposal_id, created_at);

ALTER TABLE treatment_proposal_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS treatment_proposal_events_clinic_read ON treatment_proposal_events;
CREATE POLICY treatment_proposal_events_clinic_read ON treatment_proposal_events FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'app_role') IN ('clinic_admin', 'provider', 'medical_assistant')
         AND EXISTS (SELECT 1 FROM treatment_proposals p WHERE p.proposal_id = treatment_proposal_events.proposal_id
                       AND p.clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID));
DROP POLICY IF EXISTS treatment_proposal_events_ops_read ON treatment_proposal_events;
CREATE POLICY treatment_proposal_events_ops_read ON treatment_proposal_events FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'app_role') = 'ops_admin');
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON treatment_proposal_events FROM anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON treatment_proposal_events FROM service_role;

DROP TRIGGER IF EXISTS treatment_proposal_events_no_update_delete ON treatment_proposal_events;
CREATE TRIGGER treatment_proposal_events_no_update_delete
  BEFORE UPDATE OR DELETE ON treatment_proposal_events
  FOR EACH ROW EXECUTE FUNCTION proposals_append_only();
DROP TRIGGER IF EXISTS treatment_proposal_events_no_truncate ON treatment_proposal_events;
CREATE TRIGGER treatment_proposal_events_no_truncate
  BEFORE TRUNCATE ON treatment_proposal_events
  FOR EACH STATEMENT EXECUTE FUNCTION proposals_append_only();

-- ── 7. Pharmacy admin scope (last statement before COMMIT) ──
SELECT apply_pharmacy_admin_scope();

COMMIT;
