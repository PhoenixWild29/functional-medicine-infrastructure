-- ============================================================
-- Team invites for approved clinics (Settings > Team)
-- ============================================================
--
-- The clinic admin adds providers, invites medical assistants and other
-- clinic admins, manages pending invites, and deactivates or reactivates
-- team members. Invites reuse onboarding_invites and the #215 accept flow.
--
-- 1. onboarding_invites.invitee_name: the name the admin typed for a
--    medical assistant or clinic admin invite (a provider invite names its
--    provider row). Shown under Pending invites; fills the accept form.
-- 2. clinic_onboarding_events: member_deactivated and member_reactivated
--    (every existing event kept), with subject_user_id, the member the
--    action was done to (required for those two events).
-- 3. clinic_team_members(clinic): the clinic's logins, read from auth.users
--    by app_metadata clinic_id. Service role only.
-- 4. set_clinic_member_active(clinic, user, active, actor): one transaction
--    under a per-clinic advisory lock, so two admins deactivating each
--    other at once cannot leave the clinic without one. Refuses the
--    clinic's last active clinic admin. Deactivating sets deactivated_at
--    and deactivated_by in app_metadata (claims.ts then gives the user no
--    role), bans sign-in, deletes the user's sessions and refresh tokens,
--    marks a provider row inactive, and records the audit event.
--    Reactivating undoes the flags, the ban and the provider row. Nothing
--    is deleted: the user, their orders and their history stay.
--
-- Accepted gap: an access token issued before deactivation stays valid
-- until it expires (at most 1 hour, the JWT lifetime). It cannot be
-- renewed (sessions and refresh tokens are deleted), and the app refuses
-- it on the next request (getUser returns the deactivated app_metadata),
-- but a direct Supabase API call with that token passes RLS until expiry.
--
-- Both functions: SECURITY DEFINER with a fixed search_path, executable by
-- the service role only. apply_pharmacy_admin_scope() last.

BEGIN;

-- ── 1. onboarding_invites.invitee_name ───────────────────────
ALTER TABLE onboarding_invites ADD COLUMN IF NOT EXISTS invitee_name text;
ALTER TABLE onboarding_invites DROP CONSTRAINT IF EXISTS chk_onboarding_invites_invitee_name;
ALTER TABLE onboarding_invites ADD CONSTRAINT chk_onboarding_invites_invitee_name
  CHECK (invitee_name IS NULL OR char_length(btrim(invitee_name)) BETWEEN 1 AND 200);

COMMENT ON COLUMN onboarding_invites.invitee_name IS 'The name the clinic admin typed for a medical assistant or clinic admin invite. NULL for provider invites (the provider row has the name).';

-- ── 2. clinic_onboarding_events ──────────────────────────────
ALTER TABLE clinic_onboarding_events ADD COLUMN IF NOT EXISTS subject_user_id uuid;

ALTER TABLE clinic_onboarding_events DROP CONSTRAINT IF EXISTS chk_onboarding_events_event;
ALTER TABLE clinic_onboarding_events ADD CONSTRAINT chk_onboarding_events_event CHECK (event IN (
  'invite_created', 'invite_revoked', 'invite_resent', 'invite_accepted',
  'submitted', 'approved', 'sent_back', 'self_signup',
  'member_deactivated', 'member_reactivated'
));

ALTER TABLE clinic_onboarding_events DROP CONSTRAINT IF EXISTS chk_onboarding_events_subject;
ALTER TABLE clinic_onboarding_events ADD CONSTRAINT chk_onboarding_events_subject
  CHECK (event NOT IN ('member_deactivated', 'member_reactivated') OR subject_user_id IS NOT NULL);

COMMENT ON COLUMN clinic_onboarding_events.subject_user_id IS 'The team member an action was done to (member_deactivated, member_reactivated).';

-- ── 3. clinic_team_members ───────────────────────────────────
CREATE OR REPLACE FUNCTION clinic_team_members(p_clinic_id uuid)
RETURNS TABLE (user_id uuid, email text, full_name text, role text, deactivated_at timestamptz, last_sign_in_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT u.id,
         u.email::text,
         NULLIF(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
         u.raw_app_meta_data ->> 'app_role',
         NULLIF(u.raw_app_meta_data ->> 'deactivated_at', '')::timestamptz,
         u.last_sign_in_at
    FROM auth.users u
   WHERE u.raw_app_meta_data ->> 'clinic_id' = p_clinic_id::text
     AND u.deleted_at IS NULL
   ORDER BY u.created_at;
$$;

REVOKE EXECUTE ON FUNCTION clinic_team_members(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION clinic_team_members(uuid) TO service_role;

-- ── 4. set_clinic_member_active ──────────────────────────────
CREATE OR REPLACE FUNCTION set_clinic_member_active(
  p_clinic_id uuid,
  p_user_id   uuid,
  p_active    boolean,
  p_actor     uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_meta        jsonb;
  v_deactivated boolean;
  v_admins      integer;
BEGIN
  -- One clinic's team changes one at a time.
  PERFORM pg_advisory_xact_lock(hashtextextended('clinic_team:' || p_clinic_id::text, 0));

  SELECT raw_app_meta_data INTO v_meta
    FROM auth.users WHERE id = p_user_id AND raw_app_meta_data ->> 'clinic_id' = p_clinic_id::text FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  v_deactivated := v_meta ? 'deactivated_at';

  IF NOT p_active THEN
    IF v_deactivated THEN
      RETURN jsonb_build_object('status', 'unchanged');
    END IF;

    IF v_meta ->> 'app_role' = 'clinic_admin' THEN
      SELECT count(*) INTO v_admins
        FROM auth.users
       WHERE raw_app_meta_data ->> 'clinic_id' = p_clinic_id::text
         AND raw_app_meta_data ->> 'app_role' = 'clinic_admin' AND NOT (raw_app_meta_data ? 'deactivated_at') AND deleted_at IS NULL AND id <> p_user_id;
      IF v_admins = 0 THEN
        RETURN jsonb_build_object('status', 'last_admin');
      END IF;
    END IF;

    UPDATE auth.users
       SET raw_app_meta_data = raw_app_meta_data || jsonb_build_object('deactivated_at', now(), 'deactivated_by', p_actor),
           banned_until = now() + interval '100 years',
           updated_at = now()
     WHERE id = p_user_id;
    DELETE FROM auth.refresh_tokens WHERE user_id = p_user_id::text;
    DELETE FROM auth.sessions WHERE user_id = p_user_id;
    UPDATE providers SET is_active = false, updated_at = now() WHERE user_id = p_user_id AND clinic_id = p_clinic_id;
    INSERT INTO clinic_onboarding_events (clinic_id, event, actor_user_id, actor_role, subject_user_id)
      VALUES (p_clinic_id, 'member_deactivated', p_actor, 'clinic_admin', p_user_id);
    RETURN jsonb_build_object('status', 'deactivated');
  END IF;

  IF NOT v_deactivated THEN
    RETURN jsonb_build_object('status', 'unchanged');
  END IF;

  UPDATE auth.users
     SET raw_app_meta_data = raw_app_meta_data - 'deactivated_at' - 'deactivated_by',
         banned_until = NULL,
         updated_at = now()
   WHERE id = p_user_id;
  UPDATE providers SET is_active = true, updated_at = now() WHERE user_id = p_user_id AND clinic_id = p_clinic_id AND deleted_at IS NULL;
  INSERT INTO clinic_onboarding_events (clinic_id, event, actor_user_id, actor_role, subject_user_id)
    VALUES (p_clinic_id, 'member_reactivated', p_actor, 'clinic_admin', p_user_id);
  RETURN jsonb_build_object('status', 'reactivated');
END;
$$;

REVOKE EXECUTE ON FUNCTION set_clinic_member_active(uuid, uuid, boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION set_clinic_member_active(uuid, uuid, boolean, uuid) TO service_role;

-- ── 5. pharmacy_admin scope (20261014000001) ─────────────────
-- No table is created, but the call stays last so every table keeps the
-- restrictive pharmacy_admin_scope policy.
SELECT apply_pharmacy_admin_scope();

COMMIT;
