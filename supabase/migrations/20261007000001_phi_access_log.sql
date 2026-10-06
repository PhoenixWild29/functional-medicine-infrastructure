-- ============================================================
-- PHI access audit log (Compliance C2)
-- ============================================================
--
-- HIPAA audit controls (45 CFR 164.312(b)): for any patient, who viewed or
-- changed their data, when, and from where. One row per request that reads
-- or writes patient-identifying data, written by the app's server helper
-- (src/lib/audit/phi-access.ts logPhiAccess) through the service role.
--
-- No PHI in a row: ids, the actor's role, keyed hashes (HMAC-SHA256 with a
-- server secret) of the actor's email, the IP and the user agent, and
-- constrained codes for action, resource and route. No names, DOB, phone,
-- drug names or free text. No foreign keys: an audit row must never block
-- or be removed by a change to the rows it describes.
--
-- Append-only for everyone: explicit deny policies (like sms_log and
-- order_status_history), the privileges revoked, and a trigger that refuses
-- UPDATE, DELETE and TRUNCATE, because RLS does not bind the service role.
--
-- Only the clinic admin may SELECT, and only their own clinic's rows
-- (Settings, Access log). Providers and medical assistants read nothing.

BEGIN;

CREATE TABLE IF NOT EXISTS phi_access_log (
  id               UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  occurred_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_user_id    UUID        NOT NULL,
  actor_role       TEXT        NOT NULL CHECK (actor_role ~ '^[a-z_]{1,40}$'),
  actor_email_hash TEXT        CHECK (actor_email_hash IS NULL OR actor_email_hash ~ '^[0-9a-f]{64}$'),
  clinic_id        UUID,
  patient_id       UUID,
  order_id         UUID,
  action           TEXT        NOT NULL CHECK (action IN ('view', 'create', 'update', 'export', 'print', 'sign')),
  resource         TEXT        NOT NULL CHECK (resource ~ '^[a-z_]{1,40}$'),
  route            TEXT        NOT NULL CHECK (route ~ '^/[A-Za-z0-9_/\[\]-]{0,200}$'),
  ip_hash          TEXT        CHECK (ip_hash IS NULL OR ip_hash ~ '^[0-9a-f]{64}$'),
  user_agent_hash  TEXT        CHECK (user_agent_hash IS NULL OR user_agent_hash ~ '^[0-9a-f]{64}$')
);

COMMENT ON TABLE phi_access_log IS
  'Compliance C2: who viewed or changed which patient''s data, when, from where. Append-only. No PHI.';
COMMENT ON COLUMN phi_access_log.actor_email_hash IS 'HMAC-SHA256 of the lower-cased email with PHI_ACCESS_LOG_HASH_SECRET; NULL when the secret is not set.';
COMMENT ON COLUMN phi_access_log.ip_hash IS 'HMAC-SHA256 of the client IP (first x-forwarded-for address); NULL when unknown or the secret is not set.';
COMMENT ON COLUMN phi_access_log.route IS 'The route pattern (/api/orders/[orderId]/record), never a URL with ids or a query string.';

CREATE INDEX IF NOT EXISTS idx_phi_access_log_clinic_time  ON phi_access_log (clinic_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_phi_access_log_patient_time ON phi_access_log (patient_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_phi_access_log_actor_time   ON phi_access_log (actor_user_id, occurred_at DESC);

-- ── Row level security ───────────────────────────────────────
ALTER TABLE phi_access_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY phi_access_log_clinic_admin_select ON phi_access_log FOR SELECT TO authenticated
  USING (clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID
         AND (auth.jwt() -> 'user_metadata' ->> 'app_role') = 'clinic_admin');

-- INSERT through the service role only (it bypasses RLS).
CREATE POLICY phi_access_log_deny_insert ON phi_access_log FOR INSERT TO authenticated, anon
  WITH CHECK (false);

-- Explicit DENY on UPDATE/DELETE makes immutability intent unmistakable.
CREATE POLICY phi_access_log_deny_update ON phi_access_log
  FOR UPDATE USING (false);
CREATE POLICY phi_access_log_deny_delete ON phi_access_log
  FOR DELETE USING (false);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON phi_access_log FROM anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON phi_access_log FROM service_role;

-- ── Append-only for every role, the service role included ────
CREATE OR REPLACE FUNCTION phi_access_log_append_only() RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'phi_access_log is append-only';
END;
$$;

DROP TRIGGER IF EXISTS phi_access_log_no_update_delete ON phi_access_log;
CREATE TRIGGER phi_access_log_no_update_delete
  BEFORE UPDATE OR DELETE ON phi_access_log
  FOR EACH ROW EXECUTE FUNCTION phi_access_log_append_only();

DROP TRIGGER IF EXISTS phi_access_log_no_truncate ON phi_access_log;
CREATE TRIGGER phi_access_log_no_truncate
  BEFORE TRUNCATE ON phi_access_log
  FOR EACH STATEMENT EXECUTE FUNCTION phi_access_log_append_only();

COMMIT;
