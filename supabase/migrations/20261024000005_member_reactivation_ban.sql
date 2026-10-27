-- ============================================================
-- Reactivating a team member clears only the ban deactivation set
-- (Oct 24 security review, L12)
-- ============================================================
--
-- set_clinic_member_active (20261021000001) banned a deactivated member
-- for 100 years and, on reactivation, set banned_until = NULL: that also
-- lifted a ban set for any other reason (by ops, or by Supabase Auth).
--
-- Now deactivation records, in app_metadata:
--   deactivation_banned_until         the ban it set
--   banned_until_before_deactivation  the ban it replaced, if any
-- and reactivation lifts banned_until only while it is still exactly the
-- ban deactivation set. It then restores the earlier ban if that has not
-- expired, else clears it. A ban set by anything else after deactivation
-- is kept.
--
-- Members deactivated before this migration carry no record. Their ban
-- was set in the same statement as deactivated_at (both now()), so it is
-- exactly deactivated_at + 100 years; that ban is recognised as the
-- flow's own. No earlier ban was recorded for them, so none is restored.
--
-- Same signature, return values, locking and grants as before; nothing
-- else changes. Safe to apply twice (CREATE OR REPLACE).

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
  v_banned      timestamptz;
  v_deactivated boolean;
  v_admins      integer;
  v_ours        timestamptz;
  v_before      timestamptz;
  v_ban         timestamptz;
BEGIN
  -- One clinic's team changes one at a time.
  PERFORM pg_advisory_xact_lock(hashtextextended('clinic_team:' || p_clinic_id::text, 0));

  SELECT raw_app_meta_data, banned_until INTO v_meta, v_banned
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

    v_ban := now() + interval '100 years';
    UPDATE auth.users
       SET raw_app_meta_data = raw_app_meta_data
             || jsonb_build_object('deactivated_at', now(), 'deactivated_by', p_actor, 'deactivation_banned_until', v_ban)
             || CASE WHEN v_banned IS NOT NULL AND v_banned > now()
                     THEN jsonb_build_object('banned_until_before_deactivation', v_banned)
                     ELSE '{}'::jsonb END,
           banned_until = v_ban,
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

  -- The ban deactivation set: recorded, or (deactivated before this
  -- migration) deactivated_at + 100 years.
  v_ours := COALESCE(
    NULLIF(v_meta ->> 'deactivation_banned_until', '')::timestamptz,
    NULLIF(v_meta ->> 'deactivated_at', '')::timestamptz + interval '100 years'
  );
  v_before := NULLIF(v_meta ->> 'banned_until_before_deactivation', '')::timestamptz;

  UPDATE auth.users
     SET raw_app_meta_data = raw_app_meta_data - 'deactivated_at' - 'deactivated_by'
                             - 'deactivation_banned_until' - 'banned_until_before_deactivation',
         banned_until = CASE
           WHEN banned_until IS NOT NULL AND banned_until = v_ours
             THEN CASE WHEN v_before > now() THEN v_before ELSE NULL END
           ELSE banned_until
         END,
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

-- No table is created, but the call stays last so every table keeps the
-- restrictive pharmacy_admin_scope policy (20261014000001).
SELECT apply_pharmacy_admin_scope();

COMMIT;
