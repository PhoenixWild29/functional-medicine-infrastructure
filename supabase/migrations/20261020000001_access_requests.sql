-- ============================================================
-- Request access: a front door for clinics and pharmacies
-- ============================================================
--
-- /request-access (public, linked from /login) lets a clinic or a
-- compounding pharmacy ask for an account. Ops reviews each request in
-- Clinic onboarding / Pharmacy onboarding and either sends the existing
-- invite (status 'invited') or declines it with a note. Onboarding stays
-- invite-only: a request creates no account and sends nothing.
--
-- access_requests holds business contacts only (organization, contact
-- name, work email and phone, states, providers or 503A/503B, a note):
-- no patient data.
--
-- RLS on and no policy at all: anon and authenticated get nothing. The
-- service role writes (the public route, after its validation, rate limit
-- and duplicate check) and ops reads through ops routes only.
--
-- Last, apply_pharmacy_admin_scope() (20261014000001) gives the new table
-- the restrictive pharmacy_admin_scope policy like every other table.

BEGIN;

CREATE TABLE IF NOT EXISTS access_requests (
  request_id         UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  request_type       TEXT        NOT NULL CHECK (request_type IN ('clinic', 'pharmacy')),
  organization_name  TEXT        NOT NULL CHECK (length(trim(organization_name)) BETWEEN 2 AND 200),
  contact_name       TEXT        NOT NULL CHECK (length(trim(contact_name)) BETWEEN 2 AND 200),
  work_email         TEXT        NOT NULL CHECK (work_email = lower(work_email) AND length(work_email) <= 254 AND work_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  phone              TEXT        NOT NULL CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  states             TEXT[]      NOT NULL CHECK (cardinality(states) BETWEEN 1 AND 60 AND array_to_string(states, ',') ~ '^[A-Z]{2}(,[A-Z]{2})*$'),
  provider_count     INTEGER     CHECK (provider_count IS NULL OR provider_count BETWEEN 1 AND 10000),
  facility_type      TEXT        CHECK (facility_type IS NULL OR facility_type IN ('503A', '503B')),
  note               TEXT        CHECK (note IS NULL OR length(note) <= 1000),
  status             TEXT        NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'invited', 'declined')),
  decline_note       TEXT        CHECK (decline_note IS NULL OR length(trim(decline_note)) BETWEEN 2 AND 500),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  handled_by         UUID,
  handled_at         TIMESTAMPTZ,
  -- Clinic fields for clinics, pharmacy fields for pharmacies.
  CONSTRAINT chk_access_requests_clinic_fields   CHECK ((request_type = 'clinic') = (provider_count IS NOT NULL)),
  CONSTRAINT chk_access_requests_pharmacy_fields CHECK ((request_type = 'pharmacy') = (facility_type IS NOT NULL)),
  -- Who changed the status and when, once it is not new.
  CONSTRAINT chk_access_requests_handled CHECK ((status = 'new') = (handled_at IS NULL AND handled_by IS NULL)),
  CONSTRAINT chk_access_requests_decline_note CHECK (status <> 'declined' OR decline_note IS NOT NULL)
);

COMMENT ON TABLE access_requests IS 'Requests for a clinic or pharmacy account from /request-access. Business contacts only, no PHI. Service role only.';
COMMENT ON COLUMN access_requests.handled_by IS 'The ops user (auth user id) who invited or declined.';

CREATE INDEX IF NOT EXISTS idx_access_requests_type_status_created ON access_requests (request_type, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_requests_email_created ON access_requests (work_email, created_at DESC);

ALTER TABLE access_requests ENABLE ROW LEVEL SECURITY;

-- No policy: only the service role (which bypasses RLS) reads or writes.
REVOKE ALL ON access_requests FROM anon, authenticated;

-- ── pharmacy_admin scope (20261014000001), last ──────────────
SELECT apply_pharmacy_admin_scope();

COMMIT;
