-- Down migration for 20261020000001_self_serve_signup.sql
--
-- WARNING: forgets which clinics and pharmacies signed up on their own.
-- The 'self_signup' audit events must be removed first: the old event
-- list does not allow them, and the event log is append-only, so on a
-- database where anyone has signed up this down migration fails rather
-- than rewrite the audit log. Keep the columns in that case.

BEGIN;

ALTER TABLE clinic_onboarding_events DROP CONSTRAINT IF EXISTS chk_onboarding_events_event;
ALTER TABLE clinic_onboarding_events ADD CONSTRAINT chk_onboarding_events_event CHECK (event IN (
  'invite_created', 'invite_revoked', 'invite_resent', 'invite_accepted',
  'submitted', 'approved', 'sent_back'
));

ALTER TABLE pharmacy_onboarding_applications DROP CONSTRAINT IF EXISTS chk_pharmacy_applications_signup_source;
ALTER TABLE pharmacy_onboarding_applications DROP COLUMN IF EXISTS signup_source;

ALTER TABLE clinics DROP CONSTRAINT IF EXISTS chk_clinics_signup_kind_self_serve;
ALTER TABLE clinics DROP CONSTRAINT IF EXISTS chk_clinics_signup_kind;
ALTER TABLE clinics DROP CONSTRAINT IF EXISTS chk_clinics_signup_source;
ALTER TABLE clinics DROP COLUMN IF EXISTS signup_kind;
ALTER TABLE clinics DROP COLUMN IF EXISTS signup_source;

COMMIT;
