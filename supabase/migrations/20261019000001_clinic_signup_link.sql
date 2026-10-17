-- ============================================================
-- Clinic sign-up link and QR code (Patient Intake v1.1, PR 3)
-- ============================================================
--
-- A clinic gets one standing sign-up link (and its printable QR code). A
-- new patient who opens it completes the self-intake flow and is created
-- in that clinic, complete, with source 'signup_link'. The intake
-- duplicate rule flags possible duplicates for staff; nothing is merged.
--
-- 1. clinic_signup_links: only the SHA-256 of the token is stored (the
--    server derives the token from the link id with its secret, so staff
--    can see the link again, but a stolen row cannot open it). Who made it
--    and when, an on/off flag, revoked_at (and who), a use count. One
--    active (not revoked) link per clinic: making a new link revokes the
--    old one. Clinic staff read their own clinic's row (RLS on
--    app_metadata); only the service role writes; anon gets nothing.
-- 2. patients.source gains 'signup_link' (existing values kept), and
--    patients.signup_link_id records the link a patient came from.
-- 3. signup_link_create_patient(...): with the link row locked, refuses a
--    link that is off or revoked, refuses past the daily cap (new patients
--    from this link in the last 24 hours), creates the patient in the
--    LINK's clinic and counts the use. One transaction. Service role only.
-- 4. apply_pharmacy_admin_scope() last (20261014000001).
--
-- Additive. Runs after 20261018000001.

BEGIN;

-- ── 1. clinic_signup_links ───────────────────────────────────
CREATE TABLE IF NOT EXISTS clinic_signup_links (
  link_id      UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id    UUID        NOT NULL REFERENCES clinics(clinic_id),
  token_hash   TEXT        NOT NULL CONSTRAINT chk_signup_links_token_hash CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  enabled      BOOLEAN     NOT NULL DEFAULT true,
  created_by   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at   TIMESTAMPTZ,
  revoked_by   UUID,
  use_count    INTEGER     NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  last_used_at TIMESTAMPTZ
);

COMMENT ON TABLE clinic_signup_links IS 'A clinic''s standing patient sign-up link: SHA-256 of the token only; one active (not revoked) per clinic.';
COMMENT ON COLUMN clinic_signup_links.enabled IS 'Off: patients who open the link are told it is no longer active. The clinic admin can turn it back on.';
COMMENT ON COLUMN clinic_signup_links.revoked_at IS 'Set when the clinic admin made a new link: this one stops working for good.';
COMMENT ON COLUMN clinic_signup_links.use_count IS 'Patients created from this link.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_signup_links_token_hash ON clinic_signup_links (token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS uq_signup_links_one_active_per_clinic ON clinic_signup_links (clinic_id) WHERE revoked_at IS NULL;

ALTER TABLE clinic_signup_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS signup_links_clinic_select ON clinic_signup_links;
CREATE POLICY signup_links_clinic_select ON clinic_signup_links FOR SELECT TO authenticated
  USING (clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID);

-- No INSERT / UPDATE / DELETE policy: the service role writes these rows.
REVOKE ALL ON clinic_signup_links FROM anon;

-- ── 2. patients ──────────────────────────────────────────────
ALTER TABLE patients DROP CONSTRAINT IF EXISTS patients_source_check;
ALTER TABLE patients ADD CONSTRAINT patients_source_check
  CHECK (source IN ('staff', 'self_intake', 'import', 'ehr', 'csv_import', 'signup_link'));

ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS signup_link_id UUID REFERENCES clinic_signup_links(link_id) ON DELETE SET NULL;

COMMENT ON COLUMN patients.signup_link_id IS 'The clinic sign-up link this patient signed up from. NULL otherwise.';

CREATE INDEX IF NOT EXISTS idx_patients_signup_link_created ON patients (signup_link_id, created_at) WHERE signup_link_id IS NOT NULL;

-- ── 3. signup_link_create_patient ────────────────────────────
CREATE OR REPLACE FUNCTION signup_link_create_patient(
  p_link_id   UUID,
  p_daily_cap INTEGER,
  p_patient   JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_link       clinic_signup_links%ROWTYPE;
  v_today      INTEGER;
  v_patient_id UUID;
  v_nkda       BOOLEAN;
BEGIN
  IF p_patient IS NULL OR jsonb_typeof(p_patient) <> 'object' THEN
    RAISE EXCEPTION 'signup_link_create_patient: p_patient must be a JSON object';
  END IF;

  -- The lock serialises sign-ups on one link, so the cap holds under load.
  SELECT * INTO v_link FROM clinic_signup_links WHERE link_id = p_link_id FOR UPDATE;
  IF NOT FOUND OR NOT v_link.enabled OR v_link.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'inactive');
  END IF;

  SELECT count(*) INTO v_today FROM patients
   WHERE signup_link_id = p_link_id AND created_at > now() - interval '24 hours';
  IF v_today >= p_daily_cap THEN
    RETURN jsonb_build_object('status', 'cap');
  END IF;

  v_nkda := COALESCE((p_patient->>'nkda')::BOOLEAN, false);

  INSERT INTO patients (
    clinic_id, first_name, last_name, date_of_birth, sex, phone, phone_e164,
    address_line1, address_line2, city, state, zip,
    nkda, allergies, allergies_updated_at, current_medications,
    sms_opt_in, sms_consent_at, sms_consent_source, sms_consent_text_version,
    privacy_notice_ack_at, privacy_notice_version,
    intake_status, intake_completed_at, source, signup_link_id
  ) VALUES (
    v_link.clinic_id,
    p_patient->>'first_name',
    p_patient->>'last_name',
    (p_patient->>'date_of_birth')::DATE,
    p_patient->>'sex',
    p_patient->>'phone',
    p_patient->>'phone_e164',
    p_patient->>'address_line1',
    NULLIF(p_patient->>'address_line2', ''),
    p_patient->>'city',
    p_patient->>'state',
    p_patient->>'zip',
    v_nkda,
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_patient->'allergies', '[]'::JSONB))),
    now(),
    NULLIF(p_patient->>'current_medications', ''),
    COALESCE((p_patient->>'sms_opt_in')::BOOLEAN, false),
    now(),
    p_patient->>'sms_consent_source',
    NULLIF(p_patient->>'sms_consent_text_version', ''),
    now(),
    p_patient->>'privacy_notice_version',
    'complete',
    now(),
    'signup_link',
    p_link_id
  )
  RETURNING patient_id INTO v_patient_id;

  UPDATE clinic_signup_links SET use_count = use_count + 1, last_used_at = now() WHERE link_id = p_link_id;

  RETURN jsonb_build_object('status', 'created', 'patient_id', v_patient_id, 'clinic_id', v_link.clinic_id);
END;
$$;

REVOKE ALL ON FUNCTION signup_link_create_patient(UUID, INTEGER, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION signup_link_create_patient(UUID, INTEGER, JSONB) TO service_role;

-- ── 4. pharmacy_admin scope (20261014000001) ─────────────────
-- Last, so clinic_signup_links gets the restrictive pharmacy_admin_scope
-- policy like every other table.
SELECT apply_pharmacy_admin_scope();

COMMIT;
