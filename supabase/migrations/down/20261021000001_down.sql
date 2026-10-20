-- Down migration for 20261021000001_team_invites.sql
-- Atomic: either the whole rollback lands or none of it does.
--
-- Refuses while any login is deactivated (removing the functions would
-- leave them banned with no way back in the app), and while member events
-- exist (the restored event list would reject them, and the audit history
-- is not a migration's to delete).

BEGIN;

DO $$
DECLARE
  deactivated INTEGER;
  member_events INTEGER;
BEGIN
  SELECT count(*) INTO deactivated FROM auth.users WHERE raw_app_meta_data ? 'deactivated_at';
  SELECT count(*) INTO member_events FROM clinic_onboarding_events WHERE event IN ('member_deactivated', 'member_reactivated');
  IF deactivated > 0 OR member_events > 0 THEN
    RAISE EXCEPTION 'Cannot roll back 20261021000001: % deactivated login(s), % member event(s)', deactivated, member_events;
  END IF;
END $$;

DROP FUNCTION IF EXISTS set_clinic_member_active(uuid, uuid, boolean, uuid);
DROP FUNCTION IF EXISTS clinic_team_members(uuid);

ALTER TABLE clinic_onboarding_events DROP CONSTRAINT IF EXISTS chk_onboarding_events_subject;
ALTER TABLE clinic_onboarding_events DROP CONSTRAINT IF EXISTS chk_onboarding_events_event;
ALTER TABLE clinic_onboarding_events ADD CONSTRAINT chk_onboarding_events_event CHECK (event IN (
  'invite_created', 'invite_revoked', 'invite_resent', 'invite_accepted',
  'submitted', 'approved', 'sent_back', 'self_signup'
));
ALTER TABLE clinic_onboarding_events DROP COLUMN IF EXISTS subject_user_id;

ALTER TABLE onboarding_invites DROP CONSTRAINT IF EXISTS chk_onboarding_invites_invitee_name;
ALTER TABLE onboarding_invites DROP COLUMN IF EXISTS invitee_name;

COMMIT;
