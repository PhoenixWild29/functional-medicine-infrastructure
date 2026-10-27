-- ============================================================
-- Sign-up squatting (security review D-2026-10-24-05, M3) and the ops
-- delete of an unapproved self sign-up
-- ============================================================
--
-- 1. providers.npi_claimed: whether this provider row holds its NPI.
--    Before, providers_npi_number_unique made an NPI unique among every
--    live provider, so a stranger's pending self sign-up could claim a
--    real prescriber's NPI and block it everywhere, and the 409 told anyone
--    which NPIs were customers. Now the NPI is unique among CLAIMED rows
--    only: a provider of an approved clinic. A provider added to a clinic
--    that ops has not approved is unclaimed (several pending sign-ups may
--    name the same NPI); ops approval claims the clinic's providers, and
--    the unique index refuses the claim (so the approval) when an approved
--    clinic already holds the NPI. Pending rows lose to approved ones.
--      - Existing rows: claimed (DEFAULT true), except the providers of a
--        clinic not approved yet, which are set unclaimed below. The rows
--        were unique among all live providers, so the new index holds.
--      - A plain index keeps NPI lookups fast for the unclaimed rows.
-- 2. clinic_onboarding_events: 'signup_deleted', when ops deletes an
--    unapproved self sign-up (its logins and provider rows; the clinic is
--    soft-deleted, because its events are append-only and keep it).
--
-- Down: supabase/migrations/down/20261024000006_down.sql.

BEGIN;

-- ── 1. providers.npi_claimed ─────────────────────────────────
ALTER TABLE providers ADD COLUMN IF NOT EXISTS npi_claimed boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN providers.npi_claimed IS 'True when this row holds its NPI (a provider of an approved clinic). Unique among live claimed rows (providers_npi_number_unique). A provider of a clinic not yet approved is unclaimed until ops approves the clinic.';

UPDATE providers p
   SET npi_claimed = false
  FROM clinics c
 WHERE p.clinic_id = c.clinic_id
   AND c.onboarding_status IS DISTINCT FROM 'approved';

DROP INDEX IF EXISTS providers_npi_number_unique;
CREATE UNIQUE INDEX IF NOT EXISTS providers_npi_number_unique ON providers (npi_number) WHERE deleted_at IS NULL AND npi_claimed;
CREATE INDEX IF NOT EXISTS idx_providers_npi_number_live ON providers (npi_number) WHERE deleted_at IS NULL;

-- ── 2. clinic_onboarding_events: signup_deleted ──────────────
ALTER TABLE clinic_onboarding_events DROP CONSTRAINT IF EXISTS chk_onboarding_events_event;
ALTER TABLE clinic_onboarding_events ADD CONSTRAINT chk_onboarding_events_event CHECK (event IN (
  'invite_created', 'invite_revoked', 'invite_resent', 'invite_accepted',
  'submitted', 'approved', 'sent_back', 'self_signup',
  'member_deactivated', 'member_reactivated',
  'signup_deleted'
));

-- No table is created, but the call stays last so every table keeps the
-- restrictive pharmacy_admin_scope policy.
SELECT apply_pharmacy_admin_scope();

COMMIT;
