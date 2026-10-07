-- ============================================================
-- Prescriber verification (Compliance C4)
-- ============================================================
--
-- A provider may sign a prescription only when we know they are licensed
-- for it: a verified NPI, and an unexpired license in the patient's
-- shipping state (enforced in lib/orders/batch-sign).
--
-- 1. provider_state_licenses: one license per provider per state, with
--    its number, expiry, and who verified it, when, and from what source.
-- 2. provider_npi_verifications: the current NPPES check of a provider's
--    NPI (one row per provider, replaced on each check): the NPI checked,
--    the result, the name match, the taxonomy.
-- 3. RLS: clinic users read their own clinic's providers' credentials;
--    only the clinic admin writes them. The app writes through the
--    service role after the same check.
-- 4. Demo: the demo clinics' providers get demo licenses in the states of
--    the demo patients, and a demo NPI record, so the demo keeps signing.
--    Marked source 'demo_seed'; inserted only where those providers exist.
--
-- No PHI: provider credentials only. providers.license_state and
-- license_number stay as they are (no expiry there, so not used to sign).

BEGIN;

-- ── 1. Licenses ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS provider_state_licenses (
  license_id     UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  provider_id    UUID        NOT NULL REFERENCES providers(provider_id) ON DELETE CASCADE,
  state          CHAR(2)     NOT NULL CHECK (state ~ '^[A-Z]{2}$'),
  license_number TEXT        NOT NULL CHECK (license_number ~ '^[A-Za-z0-9][A-Za-z0-9 ./-]{0,39}$'),
  expires_on     DATE        NOT NULL,
  verified_at    TIMESTAMPTZ,
  verified_by    UUID,
  source         TEXT        NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'state_board', 'import', 'demo_seed')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_provider_state_license UNIQUE (provider_id, state)
);

COMMENT ON TABLE provider_state_licenses IS
  'Compliance C4: a provider''s license to prescribe in a state. Signing needs one, unexpired, in the patient''s shipping state.';
COMMENT ON COLUMN provider_state_licenses.verified_by IS 'auth.users id of whoever recorded or verified it (the clinic admin); NULL for a seed.';

CREATE INDEX IF NOT EXISTS idx_provider_state_licenses_expiry ON provider_state_licenses (expires_on);

DROP TRIGGER IF EXISTS set_updated_at_provider_state_licenses ON provider_state_licenses;
CREATE TRIGGER set_updated_at_provider_state_licenses
  BEFORE UPDATE ON provider_state_licenses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 2. NPI verification ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS provider_npi_verifications (
  provider_id         UUID        NOT NULL PRIMARY KEY REFERENCES providers(provider_id) ON DELETE CASCADE,
  npi                 TEXT        NOT NULL CHECK (npi ~ '^[0-9]{10}$'),
  status              TEXT        NOT NULL CHECK (status IN ('verified', 'mismatch', 'not_found', 'unverified', 'invalid')),
  name_match          BOOLEAN,
  enumeration_type    TEXT        CHECK (enumeration_type IS NULL OR enumeration_type IN ('NPI-1', 'NPI-2')),
  taxonomy_code       TEXT        CHECK (taxonomy_code IS NULL OR taxonomy_code ~ '^[0-9A-Z]{10}$'),
  taxonomy_desc       TEXT,
  registry_first_name TEXT,
  registry_last_name  TEXT,
  reason              TEXT,
  checked_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  checked_by          UUID,
  verified_at         TIMESTAMPTZ,
  source              TEXT        NOT NULL DEFAULT 'nppes' CHECK (source IN ('nppes', 'demo_seed')),
  CONSTRAINT chk_npi_verified_at CHECK ((status = 'verified') = (verified_at IS NOT NULL))
);

COMMENT ON TABLE provider_npi_verifications IS
  'Compliance C4: the latest NPPES registry check of a provider''s NPI. Signing needs status verified for the NPI the provider has now.';

-- ── 3. Row level security ────────────────────────────────────
ALTER TABLE provider_state_licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_npi_verifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS provider_state_licenses_clinic_select ON provider_state_licenses;
CREATE POLICY provider_state_licenses_clinic_select ON provider_state_licenses FOR SELECT TO authenticated
  USING (provider_id IN (SELECT provider_id FROM providers WHERE clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID));
DROP POLICY IF EXISTS provider_state_licenses_admin_write ON provider_state_licenses;
CREATE POLICY provider_state_licenses_admin_write ON provider_state_licenses FOR ALL TO authenticated
  USING ((auth.jwt() -> 'user_metadata' ->> 'app_role') = 'clinic_admin'
         AND provider_id IN (SELECT provider_id FROM providers WHERE clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID))
  WITH CHECK ((auth.jwt() -> 'user_metadata' ->> 'app_role') = 'clinic_admin'
         AND provider_id IN (SELECT provider_id FROM providers WHERE clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID));

DROP POLICY IF EXISTS provider_npi_verifications_clinic_select ON provider_npi_verifications;
CREATE POLICY provider_npi_verifications_clinic_select ON provider_npi_verifications FOR SELECT TO authenticated
  USING (provider_id IN (SELECT provider_id FROM providers WHERE clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID));
DROP POLICY IF EXISTS provider_npi_verifications_admin_write ON provider_npi_verifications;
CREATE POLICY provider_npi_verifications_admin_write ON provider_npi_verifications FOR ALL TO authenticated
  USING ((auth.jwt() -> 'user_metadata' ->> 'app_role') = 'clinic_admin'
         AND provider_id IN (SELECT provider_id FROM providers WHERE clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID))
  WITH CHECK ((auth.jwt() -> 'user_metadata' ->> 'app_role') = 'clinic_admin'
         AND provider_id IN (SELECT provider_id FROM providers WHERE clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID));

-- ── 4. Demo credentials ──────────────────────────────────────
-- Sunrise Functional Medicine (a1…01): Chen, Patel, Rodriguez, Fletcher,
-- licensed in every Sunrise demo patient's state. Blue Cedar Integrative
-- Health (a1…03): Osei, in NM. Expiring 2027-12-31. The demo NPIs are
-- fictional, so their record is a demo record, not an NPPES result.
INSERT INTO provider_state_licenses (provider_id, state, license_number, expires_on, verified_at, source)
SELECT p.provider_id, s.state, 'DEMO-' || s.state || '-' || right(p.provider_id::text, 4), DATE '2027-12-31', now(), 'demo_seed'
  FROM providers p
  JOIN (VALUES
    ('a2000000-0000-0000-0000-000000000001'::UUID), ('a2000000-0000-0000-0000-000000000003'::UUID),
    ('a2000000-0000-0000-0000-000000000004'::UUID), ('a2000000-0000-0000-0000-000000000005'::UUID)
  ) AS demo(provider_id) ON demo.provider_id = p.provider_id
  CROSS JOIN (VALUES ('TX'), ('CA'), ('NY'), ('FL'), ('WA'), ('CO'), ('AZ'), ('IL'), ('GA')) AS s(state)
 WHERE p.clinic_id = 'a1000000-0000-0000-0000-000000000001'
ON CONFLICT (provider_id, state) DO NOTHING;

INSERT INTO provider_state_licenses (provider_id, state, license_number, expires_on, verified_at, source)
SELECT p.provider_id, 'NM', 'DEMO-NM-' || right(p.provider_id::text, 4), DATE '2027-12-31', now(), 'demo_seed'
  FROM providers p
 WHERE p.provider_id = 'a2000000-0000-0000-0000-000000000006'
   AND p.clinic_id = 'a1000000-0000-0000-0000-000000000003'
ON CONFLICT (provider_id, state) DO NOTHING;

INSERT INTO provider_npi_verifications (provider_id, npi, status, name_match, enumeration_type, reason, checked_at, verified_at, source)
SELECT p.provider_id, p.npi_number, 'verified', true, 'NPI-1', 'Demo provider: fictional NPI, not checked against NPPES.', now(), now(), 'demo_seed'
  FROM providers p
 WHERE (p.provider_id, p.clinic_id) IN (
         ('a2000000-0000-0000-0000-000000000001'::UUID, 'a1000000-0000-0000-0000-000000000001'::UUID),
         ('a2000000-0000-0000-0000-000000000003'::UUID, 'a1000000-0000-0000-0000-000000000001'::UUID),
         ('a2000000-0000-0000-0000-000000000004'::UUID, 'a1000000-0000-0000-0000-000000000001'::UUID),
         ('a2000000-0000-0000-0000-000000000005'::UUID, 'a1000000-0000-0000-0000-000000000001'::UUID),
         ('a2000000-0000-0000-0000-000000000006'::UUID, 'a1000000-0000-0000-0000-000000000003'::UUID))
   AND p.npi_number ~ '^[0-9]{10}$'
ON CONFLICT (provider_id) DO NOTHING;

COMMIT;
