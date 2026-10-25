-- Down for 20261024000006_npi_claimed_signup_deleted.sql
--
-- Refuses (nothing changed) while it cannot be undone safely:
--   - two live providers share an NPI (allowed now while unclaimed; the old
--     index would not hold);
--   - a 'signup_deleted' event exists (append-only; the old CHECK would
--     not hold).

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM providers WHERE deleted_at IS NULL GROUP BY npi_number HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'down 20261024000006: live providers share an NPI; resolve them before going back to one provider per NPI';
  END IF;
  IF EXISTS (SELECT 1 FROM clinic_onboarding_events WHERE event = 'signup_deleted') THEN
    RAISE EXCEPTION 'down 20261024000006: signup_deleted events exist (append-only); they cannot be removed';
  END IF;
END $$;

ALTER TABLE clinic_onboarding_events DROP CONSTRAINT IF EXISTS chk_onboarding_events_event;
ALTER TABLE clinic_onboarding_events ADD CONSTRAINT chk_onboarding_events_event CHECK (event IN (
  'invite_created', 'invite_revoked', 'invite_resent', 'invite_accepted',
  'submitted', 'approved', 'sent_back', 'self_signup',
  'member_deactivated', 'member_reactivated'
));

DROP INDEX IF EXISTS idx_providers_npi_number_live;
DROP INDEX IF EXISTS providers_npi_number_unique;
CREATE UNIQUE INDEX providers_npi_number_unique ON providers (npi_number) WHERE deleted_at IS NULL;
ALTER TABLE providers DROP COLUMN IF EXISTS npi_claimed;

SELECT apply_pharmacy_admin_scope();

COMMIT;
