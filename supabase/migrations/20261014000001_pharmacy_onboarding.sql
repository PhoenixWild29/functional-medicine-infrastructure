-- ============================================================
-- Pharmacy onboarding portal
-- ============================================================
--
-- Runs after 20261012000001 (C8) and 20261013000001 (clinic onboarding).
--
-- Ops invites a pharmacy (/ops/onboarding/pharmacies). The invitee opens a
-- single-use, expiring link, creates a pharmacy_admin account (role and
-- pharmacy_id in app_metadata), and completes a wizard: details, facility
-- type, state licenses (with documents), how orders reach them, shipping,
-- BAA and terms, catalog. Ops verifies each license and approves.
--
--   1. pharmacies: onboarding details (legal name, DBA, NCPDP, NPI, DEA,
--      shipping) and onboarding_status. A pharmacy being onboarded can
--      never be active (CHECK), so it never reaches the prescription
--      builder or routing, which both require is_active.
--   2. pharmacy_state_licenses: verification_status. A license that is
--      not verified can never be active (CHECK), so the C5 licensure check
--      never counts it. Existing licenses are verified (they are in use).
--   3. pharmacy_invites: only a SHA-256 of the token is stored.
--   4. pharmacy_onboarding_applications: progress, staged catalog, review,
--      and ops' "adapter configured" mark (required to approve an API or
--      portal pharmacy).
--      Secrets never: API keys and portal passwords go to Vault, and only
--      Vault ids are referenced.
--   5. pharmacy_agreement_acceptances (BAA, terms) and
--      pharmacy_onboarding_events (ops and invitee actions): append-only
--      for every role, the service role included.
--   6. Storage: pharmacy-license-documents, private, service role only.
--   7. RLS on every new table. A pharmacy_admin reads only its own
--      pharmacy's rows: own-row SELECT policies on the four pharmacy-owned
--      tables, and one RESTRICTIVE policy (pharmacy_admin_scope) on every
--      RLS table in public, so the existing "any signed-in user may read"
--      policies (catalog, formulations, other pharmacies) do not apply to
--      it. The migration fails if any public table is left without RLS or
--      without that policy.
--   8. sla_notifications_log had no RLS; only the service role reads it.
--   9. Three owner-rights views (no app code reads them) bypassed RLS for
--      every signed-in user; SELECT is revoked from anon and authenticated.
--  10. The Vault helper functions were executable by anon; now the
--      service role only.
--
-- No existing row is deleted or updated.

BEGIN;

-- ── 1. pharmacies ────────────────────────────────────────────
ALTER TABLE pharmacies ADD COLUMN IF NOT EXISTS legal_name TEXT;
ALTER TABLE pharmacies ADD COLUMN IF NOT EXISTS dba_name TEXT;
ALTER TABLE pharmacies ADD COLUMN IF NOT EXISTS ncpdp_id TEXT;
ALTER TABLE pharmacies ADD COLUMN IF NOT EXISTS npi TEXT;
-- Recorded only. Controlled substances stay blocked (C6).
ALTER TABLE pharmacies ADD COLUMN IF NOT EXISTS dea_number TEXT;
ALTER TABLE pharmacies ADD COLUMN IF NOT EXISTS ship_carriers TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE pharmacies ADD COLUMN IF NOT EXISTS ships_cold_chain BOOLEAN;
ALTER TABLE pharmacies ADD COLUMN IF NOT EXISTS ship_to_states TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE pharmacies ADD COLUMN IF NOT EXISTS order_cutoff_local TIME;
-- NULL for pharmacies set up before the portal.
ALTER TABLE pharmacies ADD COLUMN IF NOT EXISTS onboarding_status TEXT;

ALTER TABLE pharmacies DROP CONSTRAINT IF EXISTS chk_pharmacies_ncpdp;
ALTER TABLE pharmacies ADD CONSTRAINT chk_pharmacies_ncpdp CHECK (ncpdp_id IS NULL OR ncpdp_id ~ '^[0-9]{7}$');
ALTER TABLE pharmacies DROP CONSTRAINT IF EXISTS chk_pharmacies_npi;
ALTER TABLE pharmacies ADD CONSTRAINT chk_pharmacies_npi CHECK (npi IS NULL OR npi ~ '^[0-9]{10}$');
ALTER TABLE pharmacies DROP CONSTRAINT IF EXISTS chk_pharmacies_dea;
ALTER TABLE pharmacies ADD CONSTRAINT chk_pharmacies_dea CHECK (dea_number IS NULL OR dea_number ~ '^[A-Z]{2}[0-9]{7}$');
ALTER TABLE pharmacies DROP CONSTRAINT IF EXISTS chk_pharmacies_ship_to_states;
ALTER TABLE pharmacies ADD CONSTRAINT chk_pharmacies_ship_to_states CHECK (array_to_string(ship_to_states, ',') ~ '^([A-Z]{2}(,[A-Z]{2})*)?$');
ALTER TABLE pharmacies DROP CONSTRAINT IF EXISTS chk_pharmacies_onboarding_status;
ALTER TABLE pharmacies ADD CONSTRAINT chk_pharmacies_onboarding_status CHECK (onboarding_status IS NULL OR onboarding_status IN ('onboarding', 'approved'));
-- A pharmacy being onboarded is never active: not in the builder, not routed.
ALTER TABLE pharmacies DROP CONSTRAINT IF EXISTS chk_pharmacies_onboarding_inactive;
ALTER TABLE pharmacies ADD CONSTRAINT chk_pharmacies_onboarding_inactive CHECK (onboarding_status IS DISTINCT FROM 'onboarding' OR is_active = false);

-- ── 2. pharmacy_state_licenses ───────────────────────────────
ALTER TABLE pharmacy_state_licenses ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'verified';
ALTER TABLE pharmacy_state_licenses ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE pharmacy_state_licenses ADD COLUMN IF NOT EXISTS verified_by UUID;
ALTER TABLE pharmacy_state_licenses ADD COLUMN IF NOT EXISTS document_path TEXT;
ALTER TABLE pharmacy_state_licenses ADD COLUMN IF NOT EXISTS verification_note TEXT;

ALTER TABLE pharmacy_state_licenses DROP CONSTRAINT IF EXISTS chk_psl_verification_status;
ALTER TABLE pharmacy_state_licenses ADD CONSTRAINT chk_psl_verification_status CHECK (verification_status IN ('pending', 'verified', 'rejected'));
ALTER TABLE pharmacy_state_licenses DROP CONSTRAINT IF EXISTS chk_psl_verification_note;
ALTER TABLE pharmacy_state_licenses ADD CONSTRAINT chk_psl_verification_note CHECK (verification_note IS NULL OR length(verification_note) <= 1000);
-- A license that is not verified is never active: the C5 check never counts it.
ALTER TABLE pharmacy_state_licenses DROP CONSTRAINT IF EXISTS chk_psl_unverified_inactive;
ALTER TABLE pharmacy_state_licenses ADD CONSTRAINT chk_psl_unverified_inactive CHECK (verification_status = 'verified' OR is_active = false);

-- ── 3. pharmacy_invites ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS pharmacy_invites (
  invite_id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_name    TEXT        NOT NULL CHECK (length(trim(pharmacy_name)) BETWEEN 2 AND 200),
  admin_email      TEXT        NOT NULL CHECK (admin_email = lower(admin_email) AND admin_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  token_hash       TEXT        NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at       TIMESTAMPTZ NOT NULL,
  created_by       UUID        NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_sent_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  send_count       INTEGER     NOT NULL DEFAULT 1 CHECK (send_count >= 1),
  accepted_at      TIMESTAMPTZ,
  accepted_user_id UUID,
  pharmacy_id      UUID        REFERENCES pharmacies(pharmacy_id),
  revoked_at       TIMESTAMPTZ,
  revoked_by       UUID,
  CHECK (accepted_at IS NULL OR revoked_at IS NULL),
  CHECK ((accepted_at IS NULL) = (accepted_user_id IS NULL))
);

-- One open invite per email.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pharmacy_invites_open_email
  ON pharmacy_invites (admin_email) WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- ── 4. pharmacy_onboarding_applications ──────────────────────
CREATE TABLE IF NOT EXISTS pharmacy_onboarding_applications (
  application_id    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id       UUID        NOT NULL UNIQUE REFERENCES pharmacies(pharmacy_id),
  invite_id         UUID        REFERENCES pharmacy_invites(invite_id),
  admin_user_id     UUID        NOT NULL,
  status            TEXT        NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'submitted', 'sent_back', 'approved')),
  steps_completed   TEXT[]      NOT NULL DEFAULT '{}' CHECK (steps_completed <@ ARRAY['details', 'facility', 'licenses', 'ordering', 'shipping', 'agreement', 'catalog']::TEXT[]),
  ordering_method   TEXT        CHECK (ordering_method IN ('api', 'portal', 'fax')),
  -- Non-secret details (URLs, auth type, fax number) and Vault ids only.
  ordering_details  JSONB       NOT NULL DEFAULT '{}',
  catalog_choice    TEXT        CHECK (catalog_choice IN ('uploaded', 'skipped')),
  catalog_rows      JSONB,
  catalog_row_count INTEGER     CHECK (catalog_row_count IS NULL OR catalog_row_count >= 0),
  catalog_warnings  JSONB,
  review_note       TEXT        CHECK (review_note IS NULL OR length(review_note) <= 1000),
  submitted_at      TIMESTAMPTZ,
  reviewed_at       TIMESTAMPTZ,
  reviewed_by       UUID,
  approved_at       TIMESTAMPTZ,
  -- An API or portal pharmacy is approved only after ops marks its adapter
  -- configured (endpoints / portal selectors the pharmacy cannot supply).
  -- Cleared when the pharmacy saves new ordering details.
  adapter_configured_at TIMESTAMPTZ,
  adapter_configured_by UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((adapter_configured_at IS NULL) = (adapter_configured_by IS NULL))
);

DROP TRIGGER IF EXISTS set_updated_at_pharmacy_onboarding_applications ON pharmacy_onboarding_applications;
CREATE TRIGGER set_updated_at_pharmacy_onboarding_applications
  BEFORE UPDATE ON pharmacy_onboarding_applications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_pharmacy_onboarding_applications_status ON pharmacy_onboarding_applications (status, updated_at DESC);

-- ── 5. Append-only records ───────────────────────────────────
CREATE TABLE IF NOT EXISTS pharmacy_agreement_acceptances (
  acceptance_id    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id      UUID        NOT NULL REFERENCES pharmacies(pharmacy_id),
  application_id   UUID        REFERENCES pharmacy_onboarding_applications(application_id),
  user_id          UUID        NOT NULL,
  signer_name      TEXT        NOT NULL CHECK (length(trim(signer_name)) BETWEEN 2 AND 200),
  signer_title     TEXT        NOT NULL CHECK (length(trim(signer_title)) BETWEEN 2 AND 200),
  template_key     TEXT        NOT NULL CHECK (template_key ~ '^[a-z_]{1,60}$'),
  template_version TEXT        NOT NULL CHECK (length(template_version) BETWEEN 1 AND 40),
  text_sha256      TEXT        NOT NULL CHECK (text_sha256 ~ '^[0-9a-f]{64}$'),
  accepted_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pharmacy_agreement_acceptances_pharmacy ON pharmacy_agreement_acceptances (pharmacy_id, accepted_at DESC);

CREATE TABLE IF NOT EXISTS pharmacy_onboarding_events (
  event_id       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_user_id  UUID,
  actor_role     TEXT        NOT NULL CHECK (actor_role ~ '^[a-z_]{1,40}$'),
  action         TEXT        NOT NULL CHECK (action ~ '^[a-z_]{1,60}$'),
  invite_id      UUID,
  pharmacy_id    UUID,
  application_id UUID,
  state_code     TEXT        CHECK (state_code IS NULL OR state_code ~ '^[A-Z]{2}$'),
  -- Codes and counts only, never free text (a send-back note stays on the application).
  detail         JSONB       NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_pharmacy_onboarding_events_pharmacy ON pharmacy_onboarding_events (pharmacy_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_pharmacy_onboarding_events_invite ON pharmacy_onboarding_events (invite_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION pharmacy_onboarding_append_only() RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

REVOKE UPDATE, DELETE, TRUNCATE ON pharmacy_agreement_acceptances FROM anon, authenticated, service_role;
DROP TRIGGER IF EXISTS pharmacy_agreement_acceptances_no_update_delete ON pharmacy_agreement_acceptances;
CREATE TRIGGER pharmacy_agreement_acceptances_no_update_delete
  BEFORE UPDATE OR DELETE ON pharmacy_agreement_acceptances
  FOR EACH ROW EXECUTE FUNCTION pharmacy_onboarding_append_only();
DROP TRIGGER IF EXISTS pharmacy_agreement_acceptances_no_truncate ON pharmacy_agreement_acceptances;
CREATE TRIGGER pharmacy_agreement_acceptances_no_truncate
  BEFORE TRUNCATE ON pharmacy_agreement_acceptances
  FOR EACH STATEMENT EXECUTE FUNCTION pharmacy_onboarding_append_only();

REVOKE UPDATE, DELETE, TRUNCATE ON pharmacy_onboarding_events FROM anon, authenticated, service_role;
DROP TRIGGER IF EXISTS pharmacy_onboarding_events_no_update_delete ON pharmacy_onboarding_events;
CREATE TRIGGER pharmacy_onboarding_events_no_update_delete
  BEFORE UPDATE OR DELETE ON pharmacy_onboarding_events
  FOR EACH ROW EXECUTE FUNCTION pharmacy_onboarding_append_only();
DROP TRIGGER IF EXISTS pharmacy_onboarding_events_no_truncate ON pharmacy_onboarding_events;
CREATE TRIGGER pharmacy_onboarding_events_no_truncate
  BEFORE TRUNCATE ON pharmacy_onboarding_events
  FOR EACH STATEMENT EXECUTE FUNCTION pharmacy_onboarding_append_only();

-- ── 6. License documents: private bucket, service role only ──
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'pharmacy-license-documents',
  'pharmacy-license-documents',
  false,
  10485760,
  ARRAY['application/pdf', 'image/png', 'image/jpeg']
)
ON CONFLICT (id) DO NOTHING;
-- No storage.objects policies: uploads and signed URLs go through the
-- service role in the API, after its own role and pharmacy checks.

-- ── 7. Row level security ────────────────────────────────────
ALTER TABLE pharmacy_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE pharmacy_onboarding_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE pharmacy_agreement_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE pharmacy_onboarding_events ENABLE ROW LEVEL SECURITY;

-- Writes go through the service role (the API checks role and pharmacy).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON pharmacy_invites FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON pharmacy_onboarding_applications FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON pharmacy_agreement_acceptances FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON pharmacy_onboarding_events FROM anon, authenticated;

-- Ops reads everything onboarding.
DROP POLICY IF EXISTS pharmacy_invites_ops_admin_select ON pharmacy_invites;
CREATE POLICY pharmacy_invites_ops_admin_select ON pharmacy_invites FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'app_role') = 'ops_admin');
DROP POLICY IF EXISTS pharmacy_onboarding_applications_ops_admin_select ON pharmacy_onboarding_applications;
CREATE POLICY pharmacy_onboarding_applications_ops_admin_select ON pharmacy_onboarding_applications FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'app_role') = 'ops_admin');
DROP POLICY IF EXISTS pharmacy_agreement_acceptances_ops_admin_select ON pharmacy_agreement_acceptances;
CREATE POLICY pharmacy_agreement_acceptances_ops_admin_select ON pharmacy_agreement_acceptances FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'app_role') = 'ops_admin');
DROP POLICY IF EXISTS pharmacy_onboarding_events_ops_admin_select ON pharmacy_onboarding_events;
CREATE POLICY pharmacy_onboarding_events_ops_admin_select ON pharmacy_onboarding_events FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'app_role') = 'ops_admin');

-- A pharmacy_admin reads its own pharmacy's rows.
DROP POLICY IF EXISTS pharmacies_pharmacy_admin_own ON pharmacies;
CREATE POLICY pharmacies_pharmacy_admin_own ON pharmacies FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'app_role') = 'pharmacy_admin' AND pharmacy_id = (auth.jwt() -> 'app_metadata' ->> 'pharmacy_id')::UUID);
DROP POLICY IF EXISTS pharmacy_state_licenses_pharmacy_admin_own ON pharmacy_state_licenses;
CREATE POLICY pharmacy_state_licenses_pharmacy_admin_own ON pharmacy_state_licenses FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'app_role') = 'pharmacy_admin' AND pharmacy_id = (auth.jwt() -> 'app_metadata' ->> 'pharmacy_id')::UUID);
DROP POLICY IF EXISTS pharmacy_onboarding_applications_pharmacy_admin_own ON pharmacy_onboarding_applications;
CREATE POLICY pharmacy_onboarding_applications_pharmacy_admin_own ON pharmacy_onboarding_applications FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'app_role') = 'pharmacy_admin' AND pharmacy_id = (auth.jwt() -> 'app_metadata' ->> 'pharmacy_id')::UUID);
DROP POLICY IF EXISTS pharmacy_agreement_acceptances_pharmacy_admin_own ON pharmacy_agreement_acceptances;
CREATE POLICY pharmacy_agreement_acceptances_pharmacy_admin_own ON pharmacy_agreement_acceptances FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'app_role') = 'pharmacy_admin' AND pharmacy_id = (auth.jwt() -> 'app_metadata' ->> 'pharmacy_id')::UUID);

-- ── 8. sla_notifications_log: RLS, service role only ─────────
ALTER TABLE sla_notifications_log ENABLE ROW LEVEL SECURITY;

-- ── 9. Owner-rights views: closed to signed-in users ─────────
REVOKE SELECT ON webhook_dead_letter_queue FROM anon, authenticated;
REVOKE SELECT ON pharmacy_webhook_dead_letter_queue FROM anon, authenticated;
REVOKE SELECT ON provider_prescribing_history FROM anon, authenticated;

-- ── 10. Vault helpers: service role only ─────────────────────
-- 20260317000005 revoked these SECURITY DEFINER functions from PUBLIC and
-- authenticated, not anon (Supabase grants function EXECUTE to anon by
-- default), so the anon key could create, rotate or delete Vault secrets
-- through RPC. The portal stores pharmacy credentials with them.
REVOKE ALL ON FUNCTION create_vault_secret(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION rotate_vault_secret(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION delete_vault_secret(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_vault_secret(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION rotate_vault_secret(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION delete_vault_secret(UUID) TO service_role;

-- ── 7b. pharmacy_admin_scope: one restrictive policy per RLS table ──
-- RESTRICTIVE policies are ANDed with the permissive ones, so the
-- existing policies are unchanged for every other role. A pharmacy_admin
-- passes only on its own rows of the four pharmacy-owned tables.
--
-- A function, so it is safe to run again (it drops each policy before it
-- creates it) and so a later migration that adds a table calls it:
--   SELECT apply_pharmacy_admin_scope();
-- (a static test fails any later migration that creates a table without
-- that call). It runs as the migration's owner; nobody else may call it.
CREATE OR REPLACE FUNCTION apply_pharmacy_admin_scope() RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  t   record;
  own constant text[] := ARRAY['pharmacies', 'pharmacy_state_licenses', 'pharmacy_onboarding_applications', 'pharmacy_agreement_acceptances'];
BEGIN
  FOR t IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p')
       AND c.relrowsecurity
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS pharmacy_admin_scope ON public.%I', t.relname);
    IF t.relname::text = ANY (own) THEN
      EXECUTE format(
        'CREATE POLICY pharmacy_admin_scope ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
        'USING ((auth.jwt() -> ''app_metadata'' ->> ''app_role'') IS DISTINCT FROM ''pharmacy_admin'' '
        'OR pharmacy_id = (auth.jwt() -> ''app_metadata'' ->> ''pharmacy_id'')::UUID)', t.relname);
    ELSE
      EXECUTE format(
        'CREATE POLICY pharmacy_admin_scope ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
        'USING ((auth.jwt() -> ''app_metadata'' ->> ''app_role'') IS DISTINCT FROM ''pharmacy_admin'')', t.relname);
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION apply_pharmacy_admin_scope() FROM PUBLIC, anon, authenticated;

-- After every other statement here, so every table that exists now
-- (20261013000001's included) is covered.
SELECT apply_pharmacy_admin_scope();

-- ── Check (last): every public table has RLS and pharmacy_admin_scope ──
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname, c.relrowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p')
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
  LOOP
    IF NOT t.relrowsecurity THEN
      RAISE EXCEPTION 'public table % has no row level security', t.relname;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = t.relname AND p.policyname = 'pharmacy_admin_scope') THEN
      RAISE EXCEPTION 'public table % has no pharmacy_admin_scope policy', t.relname;
    END IF;
  END LOOP;
END $$;

COMMIT;
