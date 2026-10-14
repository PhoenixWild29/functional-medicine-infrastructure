-- ============================================================
-- Self sign-up: where a clinic or pharmacy came from
-- ============================================================
--
-- A clinic, a solo provider or a compounding pharmacy can now sign up from
-- /get-started without an invite. Ops reviews and approves them the same
-- way as invited ones; until then nothing can be ordered, signed or
-- received (enforced in the app, server side).
--
-- 1. clinics.signup_source: 'invite' (ops invited them) or 'self_serve'
--    (they signed up). NULL for clinics set up before either existed.
--    clinics.signup_kind: for a self sign-up, 'clinic' or 'solo_provider'.
-- 2. pharmacy_onboarding_applications.signup_source: 'invite' or
--    'self_serve'.
-- 3. clinic_onboarding_events: 'self_signup' joins the allowed events
--    (the audit row written when a clinic signs up on its own).
--
-- Additive: no table created, no row changed. Last,
-- apply_pharmacy_admin_scope() (20261014000001), as every migration ends.

BEGIN;

-- ── 1. clinics ───────────────────────────────────────────────
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS signup_source TEXT;
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS signup_kind TEXT;

ALTER TABLE clinics DROP CONSTRAINT IF EXISTS chk_clinics_signup_source;
ALTER TABLE clinics ADD CONSTRAINT chk_clinics_signup_source
  CHECK (signup_source IS NULL OR signup_source IN ('invite', 'self_serve'));
ALTER TABLE clinics DROP CONSTRAINT IF EXISTS chk_clinics_signup_kind;
ALTER TABLE clinics ADD CONSTRAINT chk_clinics_signup_kind
  CHECK (signup_kind IS NULL OR signup_kind IN ('clinic', 'solo_provider'));
-- A kind only for a self sign-up.
ALTER TABLE clinics DROP CONSTRAINT IF EXISTS chk_clinics_signup_kind_self_serve;
ALTER TABLE clinics ADD CONSTRAINT chk_clinics_signup_kind_self_serve
  CHECK (signup_kind IS NULL OR signup_source = 'self_serve');

COMMENT ON COLUMN clinics.signup_source IS 'invite (ops invited) or self_serve (signed up at /get-started). NULL: set up before either.';
COMMENT ON COLUMN clinics.signup_kind IS 'For a self sign-up: clinic or solo_provider.';

-- ── 2. pharmacy_onboarding_applications ──────────────────────
ALTER TABLE pharmacy_onboarding_applications ADD COLUMN IF NOT EXISTS signup_source TEXT;
ALTER TABLE pharmacy_onboarding_applications DROP CONSTRAINT IF EXISTS chk_pharmacy_applications_signup_source;
ALTER TABLE pharmacy_onboarding_applications ADD CONSTRAINT chk_pharmacy_applications_signup_source
  CHECK (signup_source IS NULL OR signup_source IN ('invite', 'self_serve'));

COMMENT ON COLUMN pharmacy_onboarding_applications.signup_source IS 'invite (ops invited) or self_serve (signed up at /get-started).';

-- ── 3. clinic_onboarding_events: 'self_signup' ───────────────
ALTER TABLE clinic_onboarding_events DROP CONSTRAINT IF EXISTS chk_onboarding_events_event;
ALTER TABLE clinic_onboarding_events ADD CONSTRAINT chk_onboarding_events_event CHECK (event IN (
  'invite_created', 'invite_revoked', 'invite_resent', 'invite_accepted',
  'submitted', 'approved', 'sent_back', 'self_signup'
));

-- ── pharmacy_admin scope (20261014000001), last ──────────────
SELECT apply_pharmacy_admin_scope();

COMMIT;
