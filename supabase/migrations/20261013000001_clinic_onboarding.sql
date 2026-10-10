-- ============================================================
-- Clinic onboarding portal
-- ============================================================
--
-- Ops invites a clinic (a clinic admin's email); the admin creates their
-- account from a single-use link and walks a wizard (practice, providers,
-- staff, BAA, terms, payouts, review); ops approves or sends it back.
-- Until approved, the clinic is inactive and cannot sign or send orders
-- (enforced in batch-sign).
--
-- 1. clinics: onboarding status and review fields, practice details.
--    Existing clinics are approved (default), so nothing changes for them.
-- 2. onboarding_invites: clinic admin, provider and medical assistant
--    invites. Only a SHA-256 hash of the token is stored; the link holds
--    the token. Single use (accepted_at), 7-day expiry, revocable.
-- 3. clinic_onboarding_steps: the wizard's progress, one row per step.
-- 4. agreement_acceptances: BAA and terms acceptance (signer, user,
--    template version, SHA-256 of the exact text). Append-only.
-- 5. clinic_onboarding_events: audit log of invites, submissions and ops
--    approvals / send-backs. Append-only.
--
-- RLS on every new table; policies read role and clinic from
-- auth.jwt() -> 'app_metadata' (migration 20261010000001). All writes go
-- through the API with the service role. No patient data in any of these.

-- ── 1. clinics ─────────────────────────────────────────────────
ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS onboarding_status text NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS legal_name text,
  ADD COLUMN IF NOT EXISTS dba_name text,
  ADD COLUMN IF NOT EXISTS address_line1 text,
  ADD COLUMN IF NOT EXISTS address_line2 text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS postal_code text,
  ADD COLUMN IF NOT EXISTS practice_npi text,
  ADD COLUMN IF NOT EXISTS tax_id_last4 text,
  ADD COLUMN IF NOT EXISTS onboarding_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS onboarding_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS onboarding_reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS onboarding_review_note text;

ALTER TABLE clinics DROP CONSTRAINT IF EXISTS chk_clinics_onboarding_status;
ALTER TABLE clinics ADD CONSTRAINT chk_clinics_onboarding_status
  CHECK (onboarding_status IN ('invited', 'in_progress', 'submitted', 'changes_requested', 'approved'));
ALTER TABLE clinics DROP CONSTRAINT IF EXISTS chk_clinics_tax_id_last4;
ALTER TABLE clinics ADD CONSTRAINT chk_clinics_tax_id_last4
  CHECK (tax_id_last4 IS NULL OR tax_id_last4 ~ '^\d{4}$');
ALTER TABLE clinics DROP CONSTRAINT IF EXISTS chk_clinics_practice_npi;
ALTER TABLE clinics ADD CONSTRAINT chk_clinics_practice_npi
  CHECK (practice_npi IS NULL OR practice_npi ~ '^\d{10}$');
ALTER TABLE clinics DROP CONSTRAINT IF EXISTS chk_clinics_state;
ALTER TABLE clinics ADD CONSTRAINT chk_clinics_state
  CHECK (state IS NULL OR state ~ '^[A-Z]{2}$');
ALTER TABLE clinics DROP CONSTRAINT IF EXISTS chk_clinics_review_note;
ALTER TABLE clinics ADD CONSTRAINT chk_clinics_review_note
  CHECK (onboarding_review_note IS NULL OR char_length(onboarding_review_note) <= 2000);

-- ── 2. onboarding_invites ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS onboarding_invites (
  invite_id        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  kind             text        NOT NULL,
  clinic_id        uuid        NOT NULL REFERENCES clinics(clinic_id) ON DELETE CASCADE,
  email            text        NOT NULL,
  provider_id      uuid        REFERENCES providers(provider_id) ON DELETE SET NULL,
  token_hash       text        NOT NULL,
  expires_at       timestamptz NOT NULL,
  created_by       uuid        NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  sent_count       integer     NOT NULL DEFAULT 1,
  last_sent_at     timestamptz NOT NULL DEFAULT now(),
  accepted_at      timestamptz,
  accepted_user_id uuid,
  revoked_at       timestamptz,
  revoked_by       uuid,
  CONSTRAINT chk_onboarding_invites_kind CHECK (kind IN ('clinic_admin', 'provider', 'medical_assistant')),
  CONSTRAINT chk_onboarding_invites_email CHECK (email = lower(email) AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  CONSTRAINT chk_onboarding_invites_token_hash CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  -- Only a provider invite names a provider row (set when it is created;
  -- it goes NULL only if that provider row is deleted).
  CONSTRAINT chk_onboarding_invites_provider CHECK (kind = 'provider' OR provider_id IS NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_onboarding_invites_token_hash ON onboarding_invites (token_hash);
CREATE INDEX IF NOT EXISTS idx_onboarding_invites_clinic ON onboarding_invites (clinic_id, created_at DESC);

ALTER TABLE onboarding_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS onboarding_invites_ops_select ON onboarding_invites;
CREATE POLICY onboarding_invites_ops_select ON onboarding_invites FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'app_role') = 'ops_admin');

DROP POLICY IF EXISTS onboarding_invites_clinic_admin_select ON onboarding_invites;
CREATE POLICY onboarding_invites_clinic_admin_select ON onboarding_invites FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'app_role') = 'clinic_admin'
         AND clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::uuid);

-- ── 3. clinic_onboarding_steps ─────────────────────────────────
CREATE TABLE IF NOT EXISTS clinic_onboarding_steps (
  clinic_id  uuid        NOT NULL REFERENCES clinics(clinic_id) ON DELETE CASCADE,
  step       text        NOT NULL,
  status     text        NOT NULL DEFAULT 'not_started',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  PRIMARY KEY (clinic_id, step),
  CONSTRAINT chk_onboarding_steps_step CHECK (step IN ('practice', 'providers', 'staff', 'baa', 'terms', 'payouts', 'review')),
  CONSTRAINT chk_onboarding_steps_status CHECK (status IN ('not_started', 'in_progress', 'complete'))
);

ALTER TABLE clinic_onboarding_steps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clinic_onboarding_steps_clinic_select ON clinic_onboarding_steps;
CREATE POLICY clinic_onboarding_steps_clinic_select ON clinic_onboarding_steps FOR SELECT TO authenticated
  USING (clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::uuid);

DROP POLICY IF EXISTS clinic_onboarding_steps_ops_select ON clinic_onboarding_steps;
CREATE POLICY clinic_onboarding_steps_ops_select ON clinic_onboarding_steps FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'app_role') = 'ops_admin');

-- ── 4. agreement_acceptances (append-only) ─────────────────────
CREATE TABLE IF NOT EXISTS agreement_acceptances (
  acceptance_id    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id        uuid        NOT NULL REFERENCES clinics(clinic_id),
  agreement        text        NOT NULL,
  template_version text        NOT NULL,
  text_sha256      text        NOT NULL,
  signer_name      text        NOT NULL,
  signer_title     text        NOT NULL,
  user_id          uuid        NOT NULL,
  accepted_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_agreement_acceptances_agreement CHECK (agreement IN ('baa', 'terms')),
  CONSTRAINT chk_agreement_acceptances_hash CHECK (text_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT chk_agreement_acceptances_signer CHECK (char_length(signer_name) BETWEEN 1 AND 200 AND char_length(signer_title) BETWEEN 1 AND 200),
  CONSTRAINT chk_agreement_acceptances_version CHECK (template_version ~ '^[a-z0-9.-]{1,64}$')
);

CREATE INDEX IF NOT EXISTS idx_agreement_acceptances_clinic ON agreement_acceptances (clinic_id, agreement, accepted_at DESC);

ALTER TABLE agreement_acceptances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agreement_acceptances_clinic_select ON agreement_acceptances;
CREATE POLICY agreement_acceptances_clinic_select ON agreement_acceptances FOR SELECT TO authenticated
  USING (clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::uuid);

DROP POLICY IF EXISTS agreement_acceptances_ops_select ON agreement_acceptances;
CREATE POLICY agreement_acceptances_ops_select ON agreement_acceptances FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'app_role') = 'ops_admin');

-- ── 5. clinic_onboarding_events (append-only audit log) ────────
CREATE TABLE IF NOT EXISTS clinic_onboarding_events (
  event_id      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     uuid        NOT NULL REFERENCES clinics(clinic_id),
  event         text        NOT NULL,
  actor_user_id uuid,
  actor_role    text,
  invite_id     uuid,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_onboarding_events_event CHECK (event IN (
    'invite_created', 'invite_revoked', 'invite_resent', 'invite_accepted',
    'submitted', 'approved', 'sent_back'
  )),
  CONSTRAINT chk_onboarding_events_note CHECK (note IS NULL OR char_length(note) <= 2000)
);

CREATE INDEX IF NOT EXISTS idx_onboarding_events_clinic ON clinic_onboarding_events (clinic_id, created_at DESC);

ALTER TABLE clinic_onboarding_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clinic_onboarding_events_ops_select ON clinic_onboarding_events;
CREATE POLICY clinic_onboarding_events_ops_select ON clinic_onboarding_events FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'app_role') = 'ops_admin');

DROP POLICY IF EXISTS clinic_onboarding_events_clinic_admin_select ON clinic_onboarding_events;
CREATE POLICY clinic_onboarding_events_clinic_admin_select ON clinic_onboarding_events FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'app_role') = 'clinic_admin'
         AND clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::uuid);

-- ── Append-only: acceptances and the audit log ─────────────────
CREATE OR REPLACE FUNCTION onboarding_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS trg_agreement_acceptances_append_only ON agreement_acceptances;
CREATE TRIGGER trg_agreement_acceptances_append_only BEFORE UPDATE OR DELETE ON agreement_acceptances
  FOR EACH ROW EXECUTE FUNCTION onboarding_append_only();

DROP TRIGGER IF EXISTS trg_clinic_onboarding_events_append_only ON clinic_onboarding_events;
CREATE TRIGGER trg_clinic_onboarding_events_append_only BEFORE UPDATE OR DELETE ON clinic_onboarding_events
  FOR EACH ROW EXECUTE FUNCTION onboarding_append_only();
