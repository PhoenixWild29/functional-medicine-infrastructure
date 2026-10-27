-- Down migration for 20261024000005_member_reactivation_ban.sql
-- Atomic: either the whole rollback lands or none of it does.
--
-- Restores set_clinic_member_active exactly as 20261021000001 defined it
-- (reactivation sets banned_until = NULL). The app_metadata keys the newer
-- version recorded (deactivation_banned_until,
-- banned_until_before_deactivation) are harmless to the older function;
-- they are removed here so no stale record outlives it.

BEGIN;

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

UPDATE auth.users
   SET raw_app_meta_data = raw_app_meta_data - 'deactivation_banned_until' - 'banned_until_before_deactivation'
 WHERE raw_app_meta_data ?| ARRAY['deactivation_banned_until', 'banned_until_before_deactivation'];

SELECT apply_pharmacy_admin_scope();

COMMIT;