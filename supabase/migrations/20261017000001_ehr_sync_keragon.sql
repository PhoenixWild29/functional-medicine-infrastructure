-- ============================================================
-- EHR patient sync via Keragon (Patient Intake v1.1, PR 5b)
-- ============================================================
--
-- A clinic's EHR sends patients to POST /api/integrations/keragon/patients
-- through Keragon. Each request is signed with the clinic's shared secret
-- (HMAC-SHA256, see docs/integrations/keragon.md). Nothing here is used
-- until a clinic admin generates a secret.
--
-- 1. ehr_connections: one per clinic and provider ('keragon'). The shared
--    secret lives in Vault (create_vault_secret, as for pharmacy portal
--    credentials); only its Vault id is kept here. Connected when a
--    secret is set and the connection is not disconnected.
-- 2. patient_external_ids: links a patient to its id in the clinic's EHR,
--    unique per (clinic, system, external id) and one per patient and
--    system. An existing patient can be linked without changing its
--    source; a patient created by sync also has source 'ehr' and
--    external_id (the existing columns and unique index).
-- 3. ehr_sync_events: the sync log. One row per event received, unique per
--    (connection, event id) so a replay is refused. Ids, outcome codes
--    and field names only: never names, dates of birth, contact details
--    or allergies.
-- 4. patient_field_changes: a field sync changed, or did not change
--    because the patient entered it at self-intake (applied = false), with
--    the old and new values, so nothing a patient entered is overwritten
--    without a record. PHI: readable by the clinic's own users only.
-- 5. The Vault helpers (create_vault_secret, rotate_vault_secret,
--    delete_vault_secret, from 20260317000005) are redefined on Vault's own
--    API. They wrote vault.secrets directly; on Supabase Vault 0.3 the
--    nonce column's default is vault._crypto_aead_det_noncegen(), which only
--    Vault's own SECURITY DEFINER functions may run, so the INSERT failed
--    ("permission denied for function _crypto_aead_det_noncegen"), and the
--    encryption happens inside vault.create_secret / vault.update_secret, so
--    a raw UPDATE of the secret would have stored it unencrypted. Same
--    names, arguments and return types (the app's RPC calls are unchanged);
--    SECURITY DEFINER with an empty search_path; still service_role only.
--
-- RLS on every new table, clinic from app_metadata (never user_metadata);
-- only the service role writes; anon has nothing. Additive only. Runs
-- after 20261015000001 and 20261016000001; last,
-- apply_pharmacy_admin_scope() (20261014000001) covers the new tables.

BEGIN;

-- ── 1. ehr_connections ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS ehr_connections (
  connection_id      UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id          UUID        NOT NULL REFERENCES clinics(clinic_id),
  provider           TEXT        NOT NULL DEFAULT 'keragon' CHECK (provider IN ('keragon')),
  secret_vault_id    UUID,
  connected_at       TIMESTAMPTZ,
  secret_rotated_at  TIMESTAMPTZ,
  secret_rotated_by  UUID,
  disconnected_at    TIMESTAMPTZ,
  disconnected_by    UUID,
  last_event_at      TIMESTAMPTZ,
  last_success_at    TIMESTAMPTZ,
  last_error_at      TIMESTAMPTZ,
  last_error_code    TEXT        CHECK (last_error_code IS NULL OR last_error_code ~ '^[a-z_]{1,60}$'),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_ehr_connections_clinic_provider UNIQUE (clinic_id, provider),
  -- Disconnected means no secret.
  CONSTRAINT chk_ehr_connections_disconnected_no_secret CHECK (disconnected_at IS NULL OR secret_vault_id IS NULL)
);

COMMENT ON TABLE ehr_connections IS 'A clinic''s EHR sync connection (Keragon). The shared secret is in Vault; only its id is here.';
COMMENT ON COLUMN ehr_connections.secret_vault_id IS 'Vault secret id of the HMAC shared secret. NULL when not connected.';
COMMENT ON COLUMN ehr_connections.last_error_code IS 'Code only (e.g. bad_signature, invalid_payload); never request content.';

DROP TRIGGER IF EXISTS set_updated_at_ehr_connections ON ehr_connections;
CREATE TRIGGER set_updated_at_ehr_connections
  BEFORE UPDATE ON ehr_connections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 2. patient_external_ids ──────────────────────────────────
CREATE TABLE IF NOT EXISTS patient_external_ids (
  link_id              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id            UUID        NOT NULL REFERENCES clinics(clinic_id),
  patient_id           UUID        NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
  system               TEXT        NOT NULL CHECK (system IN ('keragon')),
  external_patient_id  TEXT        NOT NULL CHECK (length(external_patient_id) BETWEEN 1 AND 128),
  linked_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_synced_at       TIMESTAMPTZ,
  CONSTRAINT uq_patient_external_ids_external UNIQUE (clinic_id, system, external_patient_id),
  CONSTRAINT uq_patient_external_ids_patient UNIQUE (patient_id, system)
);

COMMENT ON TABLE patient_external_ids IS 'A patient''s id in the clinic''s EHR. One per (clinic, system, external id) and per (patient, system).';

-- ── 3. ehr_sync_events (the sync log) ────────────────────────
CREATE TABLE IF NOT EXISTS ehr_sync_events (
  sync_event_id  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  connection_id  UUID        NOT NULL REFERENCES ehr_connections(connection_id),
  clinic_id      UUID        NOT NULL REFERENCES clinics(clinic_id),
  event_id       TEXT        CHECK (event_id IS NULL OR event_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  event_type     TEXT        CHECK (event_type IS NULL OR event_type ~ '^[a-z_.]{1,60}$'),
  status         TEXT        NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'applied', 'skipped', 'flagged', 'error')),
  patient_id     UUID        REFERENCES patients(patient_id) ON DELETE SET NULL,
  -- Codes, counts and field names only: no PHI.
  detail         JSONB       NOT NULL DEFAULT '{}',
  error_code     TEXT        CHECK (error_code IS NULL OR error_code ~ '^[a-z_]{1,60}$'),
  received_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at   TIMESTAMPTZ
);

COMMENT ON TABLE ehr_sync_events IS 'EHR sync log: one row per event received. Ids, outcome codes and field names only; never PHI.';

-- A replayed event id on the same connection is refused.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ehr_sync_events_connection_event
  ON ehr_sync_events (connection_id, event_id) WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ehr_sync_events_clinic_received ON ehr_sync_events (clinic_id, received_at DESC);

-- ── 4. patient_field_changes ─────────────────────────────────
CREATE TABLE IF NOT EXISTS patient_field_changes (
  change_id      UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id      UUID        NOT NULL REFERENCES clinics(clinic_id),
  patient_id     UUID        NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
  field          TEXT        NOT NULL CHECK (field ~ '^[a-z_0-9]{1,60}$'),
  old_value      TEXT,
  new_value      TEXT,
  -- false: the patient entered this field at self-intake, so sync did not
  -- overwrite it; the EHR's value is kept here for staff to review.
  applied        BOOLEAN     NOT NULL,
  source         TEXT        NOT NULL CHECK (source IN ('ehr_sync')),
  sync_event_id  UUID        REFERENCES ehr_sync_events(sync_event_id) ON DELETE SET NULL,
  changed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE patient_field_changes IS 'Patient fields sync changed (applied) or kept because the patient entered them (not applied), with old and new values. PHI.';

CREATE INDEX IF NOT EXISTS idx_patient_field_changes_patient ON patient_field_changes (patient_id, changed_at DESC);

-- ── Row level security ───────────────────────────────────────
ALTER TABLE ehr_connections        ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_external_ids   ENABLE ROW LEVEL SECURITY;
ALTER TABLE ehr_sync_events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_field_changes  ENABLE ROW LEVEL SECURITY;

-- Only the service role writes (the API checks role and clinic first).
REVOKE ALL ON ehr_connections, patient_external_ids, ehr_sync_events, patient_field_changes FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ehr_connections, patient_external_ids, ehr_sync_events, patient_field_changes FROM authenticated;

-- Connection and sync log: the clinic admin of that clinic; ops, every clinic.
DROP POLICY IF EXISTS ehr_connections_clinic_admin_select ON ehr_connections;
CREATE POLICY ehr_connections_clinic_admin_select ON ehr_connections FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'app_role') = 'clinic_admin'
         AND clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID);
DROP POLICY IF EXISTS ehr_connections_ops_admin_select ON ehr_connections;
CREATE POLICY ehr_connections_ops_admin_select ON ehr_connections FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'app_role') = 'ops_admin');

DROP POLICY IF EXISTS ehr_sync_events_clinic_admin_select ON ehr_sync_events;
CREATE POLICY ehr_sync_events_clinic_admin_select ON ehr_sync_events FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'app_role') = 'clinic_admin'
         AND clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID);
DROP POLICY IF EXISTS ehr_sync_events_ops_admin_select ON ehr_sync_events;
CREATE POLICY ehr_sync_events_ops_admin_select ON ehr_sync_events FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'app_role') = 'ops_admin');

-- Patient-linked rows: the clinic's own users, like patients.
DROP POLICY IF EXISTS patient_external_ids_clinic_user_select ON patient_external_ids;
CREATE POLICY patient_external_ids_clinic_user_select ON patient_external_ids FOR SELECT TO authenticated
  USING (clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID);
DROP POLICY IF EXISTS patient_field_changes_clinic_user_select ON patient_field_changes;
CREATE POLICY patient_field_changes_clinic_user_select ON patient_field_changes FOR SELECT TO authenticated
  USING (clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID);

-- ── 5. Vault helpers on Vault's own API ──────────────────────
-- vault.create_secret(secret, name, description) and
-- vault.update_secret(id, secret, name, description) are Vault's
-- documented API: SECURITY DEFINER, they make the nonce and encrypt.
CREATE OR REPLACE FUNCTION create_vault_secret(p_name TEXT, p_secret TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN vault.create_secret(p_secret, p_name);
END;
$$;

CREATE OR REPLACE FUNCTION rotate_vault_secret(p_secret_id UUID, p_new_secret TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE id = p_secret_id) THEN
    RAISE EXCEPTION 'Vault secret % not found', p_secret_id;
  END IF;
  -- Only the secret changes; name and description are kept.
  PERFORM vault.update_secret(p_secret_id, p_new_secret);
END;
$$;

CREATE OR REPLACE FUNCTION delete_vault_secret(p_secret_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM vault.secrets WHERE id = p_secret_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vault secret % not found', p_secret_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION create_vault_secret(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION rotate_vault_secret(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION delete_vault_secret(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_vault_secret(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION rotate_vault_secret(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION delete_vault_secret(UUID) TO service_role;

-- ── pharmacy_admin scope (20261014000001), last ──────────────
SELECT apply_pharmacy_admin_scope();

COMMIT;
