# Prod SQL runbook and merge checklist, 2026-10-25

AI-facing (task A-2026-10-25-12). The orchestrator hands Sam one block at a time, at its moment. Nothing here was run against any database while writing it.

- **Part 1:** each migration in merge order: the SQL to paste, one read-only verification query, whether it is safe before its PR merges, and the down SQL.
- **Part 2:** the merge checklist for every PR, in order.

## How to use the blocks

- **Where:** the Supabase SQL editor of the **production** project. Confirm the project name in the dashboard header before pasting. `current_database()` returns `postgres` on every project, so it identifies nothing.
- **One block per run:** paste the whole "Apply" block and run it once. Each file is one `BEGIN; … COMMIT;` transaction. Either all of it lands or none of it does, so a failed run changes nothing.
- **The ledger:** the editor does **not** write `supabase_migrations.schema_migrations`, which `supabase db push` does.
  - The ledger on prod is not a reliable record anyway (see the 2026-09-22 note on prod's ledger).
  - So confirm each migration by its objects, using its verification query, not by the ledger.
- **Expected results:**
  - Each verification query returns one row whose columns end in `_expect_<value>`; every column should show that value.
  - An apply block that ends with `SELECT apply_pharmacy_admin_scope();` shows that call's result row before `COMMIT`. That is expected.
- **Down blocks are for emergencies only,** and only on the orchestrator's instruction.
- **Reading the expected values:**
  - Column names come back lower case; the value after `_expect_` is what the cell shows. `_expect_yes` shows `YES`, and `_expect_boolean_no_true` shows `boolean NO true`.
  - Where a value is longer, the line under the query spells it out.
- **Checked before handing over:** every verification query was run on PGlite with all 89 migrations applied, and each returned its expected values.
  - For 000009 and 000010 (added 2026-10-26), the run had 91 migrations: the 89, plus those two from signed-order-freeze 798508ad, which contains clinical-difference-saved d21721a0. Supabase's default table grants were set before any migration ran, so the privilege checks test the REVOKEs.
  - Each of the two was also run without its migration, and fails there.
  - For 000004 the run first granted Supabase's default table privileges, since PGlite has none, so the "still readable" and "service role" counts are meaningful.
  - Each apply block below was checked to be byte-for-byte the branch file.

Source commits (each branch's origin head at the time of writing):

| Migration | Branch | Head SHA |
|---|---|---|
| 20261024000003 | ops-fax-viewer-documo | da99864b |
| 20261024000004 | rls-user-write-lockdown-v2 | 9611fd23 |
| 20261024000005 | security-followups-2 | e53ec166 |
| 20261024000006 | signup-squatting | 9e139268 |
| 20261024000007 | rate-limit-db | 3c4791cf |
| 20261024000008 | perf-indexes | 228c147b |
| 20261024000009 | clinical-difference-saved | d21721a0 (added 2026-10-26) |
| 20261024000010 | signed-order-freeze | 798508ad (added 2026-10-26) |
| read-only check | state-machine-enforcement | b0bd60f8 |

If a branch moves after this was written, re-copy from its new head before running.

---

# Part 1: migrations

## 20261024000003: phi_access_log.fax_id (ops-fax-viewer-documo)

**Editor notes:** none. Additive and idempotent (`IF NOT EXISTS`).

**Apply** (verbatim, `supabase/migrations/20261024000003_phi_access_log_fax_id.sql` at da99864b):

```sql
-- Issue Log 72: ops open inbound faxes from Documo on demand
-- (GET /api/ops/fax/[faxId]/pdf). Each view writes one phi_access_log row;
-- this column records which fax (inbound_fax_queue.fax_id).
--
-- Additive and safe to apply twice. No foreign key on purpose: the audit
-- log is append-only and outlives the queue row (a deleted or archived fax
-- must not take its access history with it, or block the delete).

BEGIN;

ALTER TABLE phi_access_log ADD COLUMN IF NOT EXISTS fax_id uuid;

CREATE INDEX IF NOT EXISTS idx_phi_access_log_fax_time
  ON phi_access_log (fax_id, occurred_at DESC)
  WHERE fax_id IS NOT NULL;

COMMENT ON COLUMN phi_access_log.fax_id IS
  'The inbound fax viewed (inbound_fax_queue.fax_id), when the resource is inbound_fax. No FK: the log outlives the queue row.';

COMMIT;
```

**Verify** (read only):

```sql
SELECT
  (SELECT data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'phi_access_log' AND column_name = 'fax_id')
                                                             AS fax_id_type_expect_uuid,
  (SELECT is_nullable FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'phi_access_log' AND column_name = 'fax_id')
                                                             AS fax_id_nullable_expect_yes,
  (SELECT pg_get_indexdef(i.indexrelid) LIKE '%(fax_id, occurred_at DESC)%WHERE (fax_id IS NOT NULL)%'
     FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname = 'idx_phi_access_log_fax_time')         AS fax_index_expect_true,
  (SELECT count(*) FROM pg_constraint
    WHERE conrelid = 'public.phi_access_log'::regclass AND contype = 'f'
      AND conkey @> ARRAY[(SELECT attnum FROM pg_attribute
                            WHERE attrelid = 'public.phi_access_log'::regclass AND attname = 'fax_id')])
                                                             AS fax_id_foreign_keys_expect_0,
  col_description('public.phi_access_log'::regclass,
    (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.phi_access_log'::regclass AND attname = 'fax_id')) IS NOT NULL
                                                             AS fax_id_comment_expect_true;
```

**Safe before its PR merges: yes.**
- It adds a nullable column with no default and a partial index.
- Main's code never names `fax_id`. Its `phi_access_log` inserts list their columns, so the new NULL column is invisible to them.
- **It must run before** ops-fax-viewer-documo is deployed: that branch's fax view writes `fax_id`.

**Down** (emergency only; verbatim, `supabase/migrations/down/20261024000003_down.sql`):

```sql
-- Down migration for 20261024000003_phi_access_log_fax_id.sql
-- Atomic: either the whole rollback lands or none of it does.
--
-- Refuses while any fax view is recorded: dropping the column would erase
-- which fax was viewed, and the audit history is not a migration's to delete.

BEGIN;

DO $$
DECLARE
  fax_views INTEGER;
BEGIN
  SELECT count(*) INTO fax_views FROM phi_access_log WHERE fax_id IS NOT NULL;
  IF fax_views > 0 THEN
    RAISE EXCEPTION 'Cannot roll back 20261024000003: % fax view(s) recorded in phi_access_log', fax_views;
  END IF;
END $$;

DROP INDEX IF EXISTS idx_phi_access_log_fax_time;
ALTER TABLE phi_access_log DROP COLUMN IF EXISTS fax_id;

COMMIT;
```

## 20261024000004: no user-JWT writes on clinic data (rls-user-write-lockdown-v2)

**Editor notes:** none. Idempotent (`DROP POLICY IF EXISTS`; repeating a REVOKE is harmless).

**Apply** (verbatim, `supabase/migrations/20261024000004_rls_user_write_lockdown.sql` at 9611fd23):

```sql
-- ============================================================
-- Security review L5: no writes with a user's JWT on clinic data
-- ============================================================
--
-- The tables below kept user write policies from before the app moved
-- every write behind its API routes. With the public anon key and a
-- clinic user's JWT (since self sign-up, any visitor's, for their own new
-- clinic) PostgREST accepted inserts and updates that skip the API's
-- approval guard and signing checks: orders (status, prices), patients,
-- providers, payment groups, provider NPI verifications and state licenses.
--
-- Every app write to these tables uses the service role, which bypasses
-- RLS and these grants (traced writer by writer on Oct 24: routes, crons,
-- webhooks, and every library that takes a client parameter, back to
-- createServiceClient; browser clients only read). So nothing in the app
-- changes. Every SELECT policy stays; the two *_admin_write policies were
-- FOR ALL, and reads stay covered by the *_clinic_select policies.
--
-- ops_admin_update_orders is left as it is: without the UPDATE grant it
-- no longer applies to authenticated; ops writes orders through the
-- service role.

BEGIN;

-- ── orders ───────────────────────────────────────────────────
DROP POLICY IF EXISTS orders_clinic_user_insert ON public.orders;
DROP POLICY IF EXISTS orders_clinic_user_update ON public.orders;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.orders FROM anon, authenticated;

-- ── patients ─────────────────────────────────────────────────
DROP POLICY IF EXISTS patients_clinic_user_insert ON public.patients;
DROP POLICY IF EXISTS patients_clinic_user_update ON public.patients;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.patients FROM anon, authenticated;

-- ── providers ────────────────────────────────────────────────
DROP POLICY IF EXISTS providers_clinic_user_insert ON public.providers;
DROP POLICY IF EXISTS providers_clinic_user_update ON public.providers;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.providers FROM anon, authenticated;

-- ── payment_groups ───────────────────────────────────────────
DROP POLICY IF EXISTS payment_groups_clinic_user_insert ON public.payment_groups;
DROP POLICY IF EXISTS payment_groups_clinic_user_update ON public.payment_groups;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.payment_groups FROM anon, authenticated;

-- ── provider_npi_verifications ───────────────────────────────
DROP POLICY IF EXISTS provider_npi_verifications_admin_write ON public.provider_npi_verifications;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.provider_npi_verifications FROM anon, authenticated;

-- ── provider_state_licenses ──────────────────────────────────
DROP POLICY IF EXISTS provider_state_licenses_admin_write ON public.provider_state_licenses;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.provider_state_licenses FROM anon, authenticated;

-- No table is created, but the call stays last so every table keeps the
-- restrictive pharmacy_admin_scope policy.
SELECT apply_pharmacy_admin_scope();

COMMIT;
```

**Verify** (read only):

```sql
WITH t(n) AS (VALUES ('orders'), ('patients'), ('providers'), ('payment_groups'),
                     ('provider_npi_verifications'), ('provider_state_licenses'))
SELECT
  (SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public' AND policyname IN (
      'orders_clinic_user_insert', 'orders_clinic_user_update',
      'patients_clinic_user_insert', 'patients_clinic_user_update',
      'providers_clinic_user_insert', 'providers_clinic_user_update',
      'payment_groups_clinic_user_insert', 'payment_groups_clinic_user_update',
      'provider_npi_verifications_admin_write', 'provider_state_licenses_admin_write'))
                                                             AS dropped_policies_left_expect_0,
  (SELECT count(*) FROM t
     CROSS JOIN unnest(ARRAY['anon', 'authenticated']) AS r(role)
     CROSS JOIN unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) AS p(priv)
    WHERE has_table_privilege(r.role, 'public.' || t.n, p.priv))
                                                             AS user_write_grants_left_expect_0,
  (SELECT count(*) FROM t
    WHERE has_table_privilege('authenticated', 'public.' || t.n, 'SELECT'))
                                                             AS tables_still_readable_expect_6,
  (SELECT count(DISTINCT tablename) FROM pg_policies
    WHERE schemaname = 'public' AND cmd = 'SELECT' AND tablename IN (SELECT n FROM t))
                                                             AS tables_with_select_policy_expect_6,
  (SELECT count(*) FROM t
    WHERE has_table_privilege('service_role', 'public.' || t.n, 'INSERT')
      AND has_table_privilege('service_role', 'public.' || t.n, 'UPDATE'))
                                                             AS service_role_writes_kept_expect_6;
```

**Safe before its PR merges: yes.**
- It only removes write access for `anon` and `authenticated` on orders, patients, providers, payment_groups, provider_npi_verifications and provider_state_licenses.
- Checked on main (2696ff24): every write to these tables in `src/` goes through `createServiceClient()`.
  - The routes: `api/orders`, `api/orders/[orderId]`, `api/orders/[orderId]/reassign-to-me`, `api/ops/orders/[orderId]/action`, `api/patients`, `api/patients/[patientId]/allergies`, `api/patients/[patientId]/duplicate-flag`, `api/providers` and `api/epcs`.
  - The service role bypasses RLS and these grants.
  - No browser or user-session client writes them; the clinic dashboard only reads.
- Every SELECT policy stays, so reads are unchanged.
- The PR itself changes only tests and this migration, so the order does not matter. It runs anyway before the PR.

**Down** (emergency only; it restores the user write policies and grants, which reopens security finding L5; verbatim, `supabase/migrations/down/20261024000004_down.sql`):

```sql
-- Down migration for 20261024000004_rls_user_write_lockdown.sql
-- Atomic: either the whole rollback lands or none of it does.
--
-- Restores the ten user write policies exactly as they stood (pg_policies
-- on a database built from every migration up to 20261024000003) and the
-- default write grants. Rolling back reopens the PostgREST write path the
-- up migration describes.

BEGIN;

-- ── orders ───────────────────────────────────────────────────
DROP POLICY IF EXISTS orders_clinic_user_insert ON public.orders;
CREATE POLICY orders_clinic_user_insert ON public.orders FOR INSERT TO authenticated
  WITH CHECK (clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID);
DROP POLICY IF EXISTS orders_clinic_user_update ON public.orders;
CREATE POLICY orders_clinic_user_update ON public.orders FOR UPDATE TO authenticated
  USING (clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID);
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.orders TO anon, authenticated;

-- ── patients ─────────────────────────────────────────────────
DROP POLICY IF EXISTS patients_clinic_user_insert ON public.patients;
CREATE POLICY patients_clinic_user_insert ON public.patients FOR INSERT TO authenticated
  WITH CHECK (clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID);
DROP POLICY IF EXISTS patients_clinic_user_update ON public.patients;
CREATE POLICY patients_clinic_user_update ON public.patients FOR UPDATE TO authenticated
  USING (clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID);
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.patients TO anon, authenticated;

-- ── providers ────────────────────────────────────────────────
-- providers_clinic_user_insert read the top-level clinic_id claim (it was
-- never moved to app_metadata); restored as it was.
DROP POLICY IF EXISTS providers_clinic_user_insert ON public.providers;
CREATE POLICY providers_clinic_user_insert ON public.providers FOR INSERT TO authenticated
  WITH CHECK (clinic_id = (auth.jwt() ->> 'clinic_id')::UUID);
DROP POLICY IF EXISTS providers_clinic_user_update ON public.providers;
CREATE POLICY providers_clinic_user_update ON public.providers FOR UPDATE TO authenticated
  USING (clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID);
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.providers TO anon, authenticated;

-- ── payment_groups ───────────────────────────────────────────
DROP POLICY IF EXISTS payment_groups_clinic_user_insert ON public.payment_groups;
CREATE POLICY payment_groups_clinic_user_insert ON public.payment_groups FOR INSERT TO authenticated
  WITH CHECK (clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID);
DROP POLICY IF EXISTS payment_groups_clinic_user_update ON public.payment_groups;
CREATE POLICY payment_groups_clinic_user_update ON public.payment_groups FOR UPDATE TO authenticated
  USING (clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID);
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.payment_groups TO anon, authenticated;

-- ── provider_npi_verifications ───────────────────────────────
DROP POLICY IF EXISTS provider_npi_verifications_admin_write ON public.provider_npi_verifications;
CREATE POLICY provider_npi_verifications_admin_write ON public.provider_npi_verifications FOR ALL TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'app_role') = 'clinic_admin'
    AND provider_id IN (SELECT providers.provider_id FROM providers WHERE providers.clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID)
  )
  WITH CHECK (
    (auth.jwt() -> 'app_metadata' ->> 'app_role') = 'clinic_admin'
    AND provider_id IN (SELECT providers.provider_id FROM providers WHERE providers.clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID)
  );
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.provider_npi_verifications TO anon, authenticated;

-- ── provider_state_licenses ──────────────────────────────────
DROP POLICY IF EXISTS provider_state_licenses_admin_write ON public.provider_state_licenses;
CREATE POLICY provider_state_licenses_admin_write ON public.provider_state_licenses FOR ALL TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'app_role') = 'clinic_admin'
    AND provider_id IN (SELECT providers.provider_id FROM providers WHERE providers.clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID)
  )
  WITH CHECK (
    (auth.jwt() -> 'app_metadata' ->> 'app_role') = 'clinic_admin'
    AND provider_id IN (SELECT providers.provider_id FROM providers WHERE providers.clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID)
  );
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.provider_state_licenses TO anon, authenticated;

SELECT apply_pharmacy_admin_scope();

COMMIT;
```

## 20261024000005: reactivation clears only its own ban (security-followups-2)

**Editor notes:** one `CREATE OR REPLACE FUNCTION` with a `$$` body. Paste and run the whole block at once (the editor handles the dollar quoting). Idempotent.

**Apply** (verbatim, `supabase/migrations/20261024000005_member_reactivation_ban.sql` at e53ec166):

```sql
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
```

**Verify** (read only):

```sql
SELECT
  (SELECT count(*) FROM pg_proc WHERE proname = 'set_clinic_member_active' AND pronamespace = 'public'::regnamespace)
                                                             AS function_overloads_expect_1,
  (SELECT prosrc LIKE '%deactivation_banned_until%' AND prosrc LIKE '%banned_until_before_deactivation%'
     FROM pg_proc WHERE oid = 'public.set_clinic_member_active(uuid, uuid, boolean, uuid)'::regprocedure)
                                                             AS new_body_expect_true,
  (SELECT prosecdef FROM pg_proc WHERE oid = 'public.set_clinic_member_active(uuid, uuid, boolean, uuid)'::regprocedure)
                                                             AS security_definer_expect_true,
  (SELECT array_to_string(proconfig, ',') FROM pg_proc
    WHERE oid = 'public.set_clinic_member_active(uuid, uuid, boolean, uuid)'::regprocedure)
                                                             AS config_expect_search_path_public_pg_catalog,
  has_function_privilege('anon', 'public.set_clinic_member_active(uuid, uuid, boolean, uuid)', 'EXECUTE')
                                                             AS anon_execute_expect_false,
  has_function_privilege('authenticated', 'public.set_clinic_member_active(uuid, uuid, boolean, uuid)', 'EXECUTE')
                                                             AS authenticated_execute_expect_false,
  has_function_privilege('service_role', 'public.set_clinic_member_active(uuid, uuid, boolean, uuid)', 'EXECUTE')
                                                             AS service_role_execute_expect_true;
```

`config_expect_search_path_public_pg_catalog` should read `search_path=public, pg_catalog`.

**Safe before its PR merges: yes.**
- Same name, arguments, return shape, locking and grants as main's function from 20261021000001.
- Main calls it in one place, `api/team/members/[userId]/route.ts`, with `{ p_clinic_id, p_user_id, p_active, p_actor }`, and reads only `status`.
- Only reactivation behaves differently: it keeps a ban that was set for another reason.

**Down** (emergency only; restores the 20261021000001 body; verbatim, `supabase/migrations/down/20261024000005_down.sql`):

```sql
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
```

## 20261024000006: NPI claimed only by approved clinics; signup_deleted event (signup-squatting)

**Editor notes:** none. It contains one data `UPDATE` (providers of not-approved clinics become unclaimed), inside the transaction.

**Apply** (verbatim, `supabase/migrations/20261024000006_npi_claimed_signup_deleted.sql` at 9e139268):

```sql
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
```

**Verify** (read only):

```sql
SELECT
  (SELECT data_type || ' ' || is_nullable || ' ' || column_default FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'providers' AND column_name = 'npi_claimed')
                                                             AS npi_claimed_expect_boolean_no_true,
  (SELECT pg_get_indexdef(i.indexrelid) LIKE 'CREATE UNIQUE INDEX%(npi_number)%WHERE ((deleted_at IS NULL) AND npi_claimed)%'
     FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname = 'providers_npi_number_unique')         AS unique_on_claimed_expect_true,
  (SELECT count(*) FROM pg_class WHERE relname = 'idx_providers_npi_number_live' AND relkind = 'i')
                                                             AS live_npi_index_expect_1,
  (SELECT pg_get_constraintdef(oid) LIKE '%signup_deleted%' FROM pg_constraint
    WHERE conname = 'chk_onboarding_events_event' AND conrelid = 'public.clinic_onboarding_events'::regclass)
                                                             AS event_check_has_signup_deleted_expect_true,
  (SELECT count(*) FROM providers p JOIN clinics c ON c.clinic_id = p.clinic_id
    WHERE c.onboarding_status IS DISTINCT FROM 'approved' AND p.npi_claimed)
                                                             AS claimed_in_unapproved_clinics_expect_0,
  (SELECT count(*) FROM providers p JOIN clinics c ON c.clinic_id = p.clinic_id
    WHERE c.onboarding_status = 'approved' AND p.deleted_at IS NULL AND NOT p.npi_claimed)
                                                             AS unclaimed_in_approved_clinics_expect_0;
```

**Safe before its PR merges: yes, but run it immediately before merging signup-squatting.**

- **Why it is safe:**
  - Main's code never names `npi_claimed`.
  - New provider rows get the default `true`, so on main a duplicate NPI among claimed rows is still refused by the unique index, as today.
  - The new CHECK value only widens what is allowed.
- **The window it leaves:**
  - Main's ops approval (`api/ops/onboarding/clinics/[clinicId]`, which sets `onboarding_status: 'approved'`) does **not** claim the clinic's providers; only signup-squatting's code does.
  - So a clinic approved after this SQL runs and before signup-squatting deploys keeps unclaimed providers, whose NPI is no longer protected by the unique index.
  - Keep that gap to minutes. After the PR deploys, re-run the verification and check `unclaimed_in_approved_clinics_expect_0`.
  - The same goes the other way: a self sign-up made in the gap inserts its provider with the default `true` (main does not set it). `claimed_in_unapproved_clinics_expect_0` can then read 1 or more. Those rows behave exactly as they do on main today, and signup-squatting's code only creates unclaimed rows from its deploy on. Report the count; leave the rows as they are.
- **If that count is not 0** (a clinic was approved in the gap): this claims them, as the PR's approval would have. Run it only on the orchestrator's go-ahead. A unique-violation error means another approved clinic already holds that NPI, which is a real squatting case for ops, so stop and report.

  ```sql
  UPDATE providers p SET npi_claimed = true, updated_at = now()
    FROM clinics c
   WHERE p.clinic_id = c.clinic_id AND c.onboarding_status = 'approved'
     AND p.deleted_at IS NULL AND NOT p.npi_claimed;
  ```

**Down** (emergency only; verbatim, `supabase/migrations/down/20261024000006_down.sql`):

```sql
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
```

## 20261024000007: shared rate-limit counts (rate-limit-db)

**Editor notes:** one table, one index and one `$$` function. Paste and run as one block. Idempotent (`IF NOT EXISTS`, `CREATE OR REPLACE`).

**Apply** (verbatim, `supabase/migrations/20261024000007_rate_limit_hits.sql` at 3c4791cf):

```sql
-- ============================================================
-- Shared rate-limit counts (security review L7)
-- ============================================================
--
-- The in-memory limiter (src/lib/security/rate-limit.ts) counts per
-- Vercel instance, so N warm instances allow N times each limit. There is
-- no Redis; this keeps one fixed-window count per (bucket, key, window)
-- in Postgres, shared by every instance. The app keeps the in-memory
-- limiter as the first, cheap layer and calls rate_limit_hit() after it
-- (src/lib/security/shared-rate-limit.ts); if this call fails the app
-- fails open.
--
--   1. rate_limit_hits: bucket (a short code such as 'signup'), key_hash
--      (HMAC-SHA256 hex of the key under the audit secret: never a raw IP,
--      email or token), window_start, hit_count. No PHI.
--   2. rate_limit_hit(bucket, key_hash, window_seconds): one atomic
--      upsert-increment (INSERT ... ON CONFLICT DO UPDATE, so concurrent
--      calls never lose a hit) returning the window's count and start.
--      It also prunes the bucket's rows older than the previous window,
--      so the table stays small without a cron.
--
-- RLS on with no policies; anon and authenticated have no table grants
-- and cannot execute the function. Only service_role calls it. SECURITY
-- DEFINER with search_path pg_catalog first. Ends with
-- apply_pharmacy_admin_scope() (20261014000001) as the last statement
-- before COMMIT.

BEGIN;

-- 1. rate_limit_hits
CREATE TABLE IF NOT EXISTS rate_limit_hits (
  bucket       TEXT        NOT NULL CONSTRAINT chk_rate_limit_hits_bucket CHECK (bucket ~ '^[a-z_]{1,40}$'),
  key_hash     TEXT        NOT NULL CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  window_start TIMESTAMPTZ NOT NULL,
  hit_count    INTEGER     NOT NULL DEFAULT 1 CONSTRAINT chk_rate_limit_hits_count CHECK (hit_count >= 1),
  PRIMARY KEY (bucket, key_hash, window_start)
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_hits_prune ON rate_limit_hits (bucket, window_start);

ALTER TABLE rate_limit_hits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON rate_limit_hits FROM PUBLIC, anon, authenticated;

-- 2. rate_limit_hit
CREATE OR REPLACE FUNCTION rate_limit_hit(p_bucket TEXT, p_key_hash TEXT, p_window_seconds INTEGER)
RETURNS TABLE (hits INTEGER, window_started TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  v_window TIMESTAMPTZ;
BEGIN
  IF p_bucket IS NULL OR p_bucket !~ '^[a-z_]{1,40}$' THEN
    RAISE EXCEPTION 'rate_limit_hit: bad bucket' USING ERRCODE = '22023';
  END IF;
  IF p_key_hash IS NULL OR p_key_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'rate_limit_hit: bad key hash' USING ERRCODE = '22023';
  END IF;
  IF p_window_seconds IS NULL OR p_window_seconds < 1 OR p_window_seconds > 86400 THEN
    RAISE EXCEPTION 'rate_limit_hit: bad window' USING ERRCODE = '22023';
  END IF;

  v_window := to_timestamp(floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds);

  RETURN QUERY
  INSERT INTO public.rate_limit_hits AS h (bucket, key_hash, window_start, hit_count)
  VALUES (p_bucket, p_key_hash, v_window, 1)
  ON CONFLICT (bucket, key_hash, window_start) DO UPDATE SET hit_count = h.hit_count + 1
  RETURNING h.hit_count, h.window_start;

  -- Prune this bucket's finished windows (anything before the previous one).
  DELETE FROM public.rate_limit_hits
  WHERE bucket = p_bucket
    AND window_start < v_window - make_interval(secs => p_window_seconds);
END;
$$;

REVOKE EXECUTE ON FUNCTION rate_limit_hit(TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION rate_limit_hit(TEXT, TEXT, INTEGER) TO service_role;

-- 3. Pharmacy admin scope (last statement before COMMIT)
SELECT apply_pharmacy_admin_scope();

COMMIT;
```

**Verify** (read only):

```sql
SELECT
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.rate_limit_hits'::regclass)
                                                             AS rls_on_expect_true,
  (SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'rate_limit_hits' AND permissive = 'PERMISSIVE')
                                                             AS permissive_policies_expect_0,
  (SELECT count(*) FROM unnest(ARRAY['anon', 'authenticated']) r(role)
     CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p(priv)
    WHERE has_table_privilege(r.role, 'public.rate_limit_hits', p.priv))
                                                             AS user_table_grants_expect_0,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
    WHERE conrelid = 'public.rate_limit_hits'::regclass AND contype = 'p')
                                                             AS pk_expect_bucket_key_hash_window_start,
  (SELECT count(*) FROM pg_class WHERE relname = 'idx_rate_limit_hits_prune' AND relkind = 'i')
                                                             AS prune_index_expect_1,
  (SELECT prosecdef FROM pg_proc WHERE oid = 'public.rate_limit_hit(text, text, integer)'::regprocedure)
                                                             AS function_security_definer_expect_true,
  (SELECT array_to_string(proconfig, ',') FROM pg_proc WHERE oid = 'public.rate_limit_hit(text, text, integer)'::regprocedure)
                                                             AS config_expect_search_path_pg_catalog_public,
  has_function_privilege('anon', 'public.rate_limit_hit(text, text, integer)', 'EXECUTE')
                                                             AS anon_execute_expect_false,
  has_function_privilege('authenticated', 'public.rate_limit_hit(text, text, integer)', 'EXECUTE')
                                                             AS authenticated_execute_expect_false,
  has_function_privilege('service_role', 'public.rate_limit_hit(text, text, integer)', 'EXECUTE')
                                                             AS service_role_execute_expect_true;
```

- `pk_expect_bucket_key_hash_window_start` should read `PRIMARY KEY (bucket, key_hash, window_start)`.
- `config_expect_search_path_pg_catalog_public` should read `search_path=pg_catalog, public`.
- The only policy is apply_pharmacy_admin_scope's RESTRICTIVE `pharmacy_admin_scope`, which is why the permissive count is 0.

**Safe before its PR merges: yes.**
- It creates a new table and function. Main's code names neither.
- rate-limit-db's code fails open if the function is missing (it logs a warning and the in-memory limit applies), so the order relative to the PR does not matter. Running it first means the shared limit works from the first deploy.
- The function writes only `rate_limit_hits`.

**Down** (emergency only; drops the counts table; the app then fails open; verbatim, `supabase/migrations/down/20261024000007_down.sql`):

```sql
-- Down migration for 20261024000007_rate_limit_hits.sql
-- Atomic: either the whole rollback lands or none of it does.
--
-- The rows are short-lived counters (no PHI, no record), so they are
-- dropped with the table. The app fails open without the function.

BEGIN;

DROP FUNCTION IF EXISTS rate_limit_hit(TEXT, TEXT, INTEGER);
DROP INDEX IF EXISTS idx_rate_limit_hits_prune;
DROP TABLE IF EXISTS rate_limit_hits;

COMMIT;
```

## 20261024000008: indexes on orders (perf-indexes)

**Editor notes:**
- The file uses plain `CREATE INDEX` inside `BEGIN; … COMMIT;`, deliberately not `CONCURRENTLY`, because `supabase db push` runs each file in a transaction.
- A plain build takes a SHARE lock on `orders`: reads continue, but writes (sign, pay, status changes) wait until the five builds finish. On today's table size that is milliseconds.
- Use the block as is.
- **Only if `orders` has grown large** (say over 100k rows: `SELECT count(*) FROM orders;`): skip the `BEGIN;`/`COMMIT;` form. Run each `CREATE INDEX CONCURRENTLY IF NOT EXISTS …` below **as its own run**, one statement per execution, because the editor runs a multi-statement script in one transaction, which CONCURRENTLY refuses. They build without blocking writes.

  ```sql
  CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_clinic_updated   ON orders (clinic_id, updated_at DESC) WHERE deleted_at IS NULL;
  ```
  ```sql
  CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_clinic_created   ON orders (clinic_id, created_at) WHERE deleted_at IS NULL;
  ```
  ```sql
  CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_provider_created ON orders (provider_id, created_at DESC) WHERE deleted_at IS NULL;
  ```
  ```sql
  CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_status_updated   ON orders (status, updated_at) WHERE deleted_at IS NULL;
  ```
  ```sql
  CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_updated          ON orders (updated_at DESC) WHERE deleted_at IS NULL;
  ```

**Apply** (verbatim, `supabase/migrations/20261024000008_perf_indexes.sql` at 228c147b):

```sql
-- ============================================================
-- Indexes for the hot reads on orders (C-2026-10-25-11)
-- ============================================================
--
-- orders had no index on clinic_id, provider_id, status or created_at,
-- and only a DRAFT-only partial index on updated_at
-- (idx_orders_draft_updated_at). Every read below filtered or sorted the
-- whole table. Each index is partial on deleted_at IS NULL, as every one
-- of these reads is, and names the query it serves:
--
--   idx_orders_clinic_updated (clinic_id, updated_at DESC)
--     The clinic dashboard order list: dashboard/page.tsx (server render)
--     and orders-dashboard.tsx (the 30-second poll), clinic_id = $1,
--     ORDER BY updated_at DESC. Also the ops pipeline filtered by clinic
--     (lib/ops/pipeline-query.ts), and the clinic_id predicate of the
--     clinic RLS policies on orders.
--
--   idx_orders_clinic_created (clinic_id, created_at)
--     The Practice dashboard's period read (lib/practice/load.ts,
--     clinic_id = $1 AND created_at >= $from AND created_at < $to), the
--     dashboard's prior-year totals (dashboard/page.tsx, the same shape)
--     and the needs-attention list (lib/practice/attention.ts, clinic_id
--     and status, ORDER BY created_at).
--
--   idx_orders_provider_created (provider_id, created_at DESC)
--     Frequently used favorites (api/favorites/frequent on
--     favorites-frequent: provider_id = $1, created_at >= now - 90 days,
--     ORDER BY created_at DESC) and api/favorites/recent on main (the
--     same shape with no window). Flagged in the 2026-10-25 high-risk
--     review.
--
--   idx_orders_status_updated (status, updated_at)
--     The crons that scan by status: submit-paid-orders (status =
--     'PAID_PROCESSING', updated_at window, ORDER BY updated_at),
--     refund-retry (status = 'REFUND_PENDING'), payment-expiry (status =
--     'AWAITING_PAYMENT', then locked_at), the ops SLA page (status), and
--     the ops pipeline's status filter.
--
--   idx_orders_updated (updated_at DESC)
--     The ops pipeline's default view (lib/ops/pipeline-query.ts with no
--     filter: ORDER BY updated_at DESC LIMIT 500), the ops landing page.
--
-- Not CONCURRENTLY: supabase db push (CI and deploy) runs each migration
-- file in a transaction, and CREATE INDEX CONCURRENTLY cannot run in one.
-- A plain CREATE INDEX takes a SHARE lock on orders: reads go on, writes
-- wait for the build, which on today's demo-sized table takes
-- milliseconds. IF NOT EXISTS makes a re-run a no-op.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_orders_clinic_updated
  ON orders (clinic_id, updated_at DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_orders_clinic_created
  ON orders (clinic_id, created_at) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_orders_provider_created
  ON orders (provider_id, created_at DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_orders_status_updated
  ON orders (status, updated_at) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_orders_updated
  ON orders (updated_at DESC) WHERE deleted_at IS NULL;

COMMIT;
```

**Verify** (read only; `indisvalid` also catches a CONCURRENTLY build that failed halfway):

```sql
SELECT
  (SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname IN ('idx_orders_clinic_updated', 'idx_orders_clinic_created', 'idx_orders_provider_created',
                        'idx_orders_status_updated', 'idx_orders_updated')
      AND i.indrelid = 'public.orders'::regclass AND i.indisvalid
      AND pg_get_indexdef(i.indexrelid) LIKE '%WHERE (deleted_at IS NULL)%')
                                                             AS valid_partial_indexes_expect_5,
  (SELECT pg_get_indexdef('public.idx_orders_clinic_updated'::regclass) LIKE '%(clinic_id, updated_at DESC)%')
                                                             AS clinic_updated_cols_expect_true,
  (SELECT pg_get_indexdef('public.idx_orders_clinic_created'::regclass) LIKE '%(clinic_id, created_at)%')
                                                             AS clinic_created_cols_expect_true,
  (SELECT pg_get_indexdef('public.idx_orders_provider_created'::regclass) LIKE '%(provider_id, created_at DESC)%')
                                                             AS provider_created_cols_expect_true,
  (SELECT pg_get_indexdef('public.idx_orders_status_updated'::regclass) LIKE '%(status, updated_at)%')
                                                             AS status_updated_cols_expect_true,
  (SELECT pg_get_indexdef('public.idx_orders_updated'::regclass) LIKE '%(updated_at DESC)%')
                                                             AS updated_cols_expect_true;
```

**Safe before its PR merges: yes.** Indexes only; no code reads or names them. The one effect is the brief write lock described above.

**Down** (emergency only; verbatim, `supabase/migrations/down/20261024000008_down.sql`):

```sql
-- Down migration for 20261024000008_perf_indexes.sql
-- Atomic: either the whole rollback lands or none of it does.
--
-- Indexes only: dropping them changes no data, only how fast the reads
-- named in the up migration run.

BEGIN;

DROP INDEX IF EXISTS idx_orders_clinic_updated;
DROP INDEX IF EXISTS idx_orders_clinic_created;
DROP INDEX IF EXISTS idx_orders_provider_created;
DROP INDEX IF EXISTS idx_orders_status_updated;
DROP INDEX IF EXISTS idx_orders_updated;

COMMIT;
```

## 20261024000009: saved clinical difference statements (clinical-difference-saved)

**Editor notes:** none. Idempotent (`IF NOT EXISTS`, `DROP POLICY IF EXISTS`). It ends with `SELECT apply_pharmacy_admin_scope();`, so the editor shows that call's result row before `COMMIT`. That is expected.

**Apply** (verbatim, `supabase/migrations/20261024000009_saved_clinical_statements.sql` at d21721a0):

```sql
-- ============================================================
-- Saved clinical difference statements (coverage gap 6)
-- ============================================================
--
-- A provider types a patient-specific clinical difference statement
-- ("Glycine added to help maintain muscle mass") under "Other
-- (describe)". This table lets the clinic save it for that formulation,
-- for the practice (patient_id NULL) or for one patient, and pick it next
-- time. Nothing is pre-selected; the chosen text is copied into
-- orders.clinical_difference as before, so the Rx and fax are unchanged.
--
-- Why a table, not an existing column: provider_favorites is a drug +
-- pharmacy + doses card (a statement has no pharmacy or dose), and
-- formulations.clinical_difference_options is catalog-wide (not per
-- clinic, not per patient).
--
-- RLS from app_metadata only (src/lib/auth/claims): the clinic's users
-- read their clinic's rows; ops_admin reads; the service role writes
-- (no write policy, as treatment_proposals 20261024000002). Rows are soft
-- deleted (deleted_at). Ends with apply_pharmacy_admin_scope()
-- (20261014000001) as the last statement before COMMIT.
--
-- PREPARED: merges after 20261024000008 (perf-indexes).

BEGIN;

CREATE TABLE IF NOT EXISTS saved_clinical_statements (
  statement_id   UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id      UUID        NOT NULL REFERENCES clinics(clinic_id),
  formulation_id UUID        NOT NULL REFERENCES formulations(formulation_id),
  patient_id     UUID        REFERENCES patients(patient_id),
  statement      TEXT        NOT NULL
                 CONSTRAINT chk_saved_clinical_statements_length CHECK (char_length(statement) BETWEEN 20 AND 500),
  created_by     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ
);

COMMENT ON TABLE saved_clinical_statements IS 'Coverage gap 6: clinical difference statements a clinic saved for a formulation, for the practice (patient_id NULL) or one patient. Picked, never pre-selected.';

-- The picker's read: a clinic's live statements for one formulation.
CREATE INDEX IF NOT EXISTS idx_saved_clinical_statements_lookup
  ON saved_clinical_statements (clinic_id, formulation_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- One live copy of a statement per clinic, formulation and scope.
CREATE UNIQUE INDEX IF NOT EXISTS uq_saved_clinical_statements_scope
  ON saved_clinical_statements (clinic_id, formulation_id, COALESCE(patient_id, '00000000-0000-0000-0000-000000000000'::UUID), lower(statement))
  WHERE deleted_at IS NULL;

ALTER TABLE saved_clinical_statements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS saved_clinical_statements_clinic_read ON saved_clinical_statements;
CREATE POLICY saved_clinical_statements_clinic_read ON saved_clinical_statements FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'app_role') IN ('clinic_admin', 'provider', 'medical_assistant')
         AND clinic_id = (auth.jwt() -> 'app_metadata' ->> 'clinic_id')::UUID);

DROP POLICY IF EXISTS saved_clinical_statements_ops_read ON saved_clinical_statements;
CREATE POLICY saved_clinical_statements_ops_read ON saved_clinical_statements FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'app_role') = 'ops_admin');

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON saved_clinical_statements FROM anon, authenticated;
REVOKE DELETE, TRUNCATE ON saved_clinical_statements FROM service_role;

-- Pharmacy admin scope (last statement before COMMIT)
SELECT apply_pharmacy_admin_scope();

COMMIT;
```

**Verify** (read only; before the migration this query errors with `relation "public.saved_clinical_statements" does not exist`):

```sql
SELECT
  (to_regclass('public.saved_clinical_statements') IS NOT NULL)                AS table_exists_expect_true,
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.saved_clinical_statements'::regclass)
                                                                               AS rls_enabled_expect_true,
  (SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'saved_clinical_statements'
      AND permissive = 'PERMISSIVE' AND cmd = 'SELECT'
      AND policyname IN ('saved_clinical_statements_clinic_read', 'saved_clinical_statements_ops_read'))
                                                                               AS read_policies_expect_2,
  (SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'saved_clinical_statements'
      AND permissive = 'PERMISSIVE' AND cmd <> 'SELECT')                       AS write_policies_expect_0,
  (SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'saved_clinical_statements'
      AND permissive = 'RESTRICTIVE')                                          AS pharmacy_scope_policies_expect_1,
  (has_table_privilege('authenticated', 'public.saved_clinical_statements', 'INSERT')
   OR has_table_privilege('authenticated', 'public.saved_clinical_statements', 'UPDATE')
   OR has_table_privilege('authenticated', 'public.saved_clinical_statements', 'DELETE')
   OR has_table_privilege('anon', 'public.saved_clinical_statements', 'INSERT')
   OR has_table_privilege('anon', 'public.saved_clinical_statements', 'UPDATE')
   OR has_table_privilege('anon', 'public.saved_clinical_statements', 'DELETE'))
                                                                               AS user_writes_expect_false,
  (has_table_privilege('service_role', 'public.saved_clinical_statements', 'INSERT')
   AND has_table_privilege('service_role', 'public.saved_clinical_statements', 'UPDATE'))
                                                                               AS service_insert_update_expect_true,
  (has_table_privilege('service_role', 'public.saved_clinical_statements', 'DELETE')
   OR has_table_privilege('service_role', 'public.saved_clinical_statements', 'TRUNCATE'))
                                                                               AS service_delete_expect_false,
  (SELECT count(*) FROM pg_constraint
    WHERE conrelid = 'public.saved_clinical_statements'::regclass
      AND conname = 'chk_saved_clinical_statements_length'
      AND pg_get_constraintdef(oid) LIKE '%char_length(statement)%20%500%')   AS length_check_expect_1,
  (SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE i.indrelid = 'public.saved_clinical_statements'::regclass AND i.indisvalid
      AND ((c.relname = 'idx_saved_clinical_statements_lookup' AND NOT i.indisunique)
        OR (c.relname = 'uq_saved_clinical_statements_scope' AND i.indisunique))
      AND pg_get_indexdef(i.indexrelid) LIKE '%WHERE (deleted_at IS NULL)%')  AS partial_indexes_expect_2;
```

The four privilege columns depend on Supabase's default table grants, which PGlite does not have. The check run first granted them (`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role`, before any migration), so `user_writes_expect_false` and `service_delete_expect_false` prove the REVOKEs, not an empty grant list.

**Safe before its PR merges: yes.**
- It creates a new table with no data. Nothing else changes.
- The code on main at that point (everything through perf-indexes) never names `saved_clinical_statements`. Searched on bundle-hipaa 1ea42cc7, the newest code that is on main by then: no reference.
- **It must run before** clinical-difference-saved is deployed. That branch's `/api/clinical-statements` reads and writes the table, and the Review step's clinical difference field (`rx-details-row.tsx`) calls it. Without the table, the read answers 500, and the field shows no saved statements, with no error. Saving one shows "The statement could not be saved." Typing a statement and prescribing still work, because the order keeps `orders.clinical_difference` as before.

**Down** (emergency only; verbatim, `supabase/migrations/down/20261024000009_down.sql`):

```sql
-- Down migration for 20261024000009_saved_clinical_statements.sql
-- Atomic: either the whole rollback lands or none of it does.
--
-- Refuses while any live statement exists: they are the clinic's saved
-- prescribing text (patient-scoped ones are part of a patient's record).

BEGIN;

DO $$
DECLARE
  live INTEGER;
BEGIN
  SELECT count(*) INTO live FROM saved_clinical_statements WHERE deleted_at IS NULL;
  IF live > 0 THEN
    RAISE EXCEPTION 'Cannot roll back 20261024000009: % saved clinical statement(s) exist', live;
  END IF;
END $$;

DROP TABLE IF EXISTS saved_clinical_statements;

COMMIT;
```

## 20261024000010: freeze every signed clinical column (signed-order-freeze)

**Editor notes:**
- It only replaces the function `prevent_snapshot_mutation()`. The trigger on `orders` (20260317000004) already calls it and is not touched. `CREATE OR REPLACE` makes a re-run a no-op.
- It affects only UPDATEs of rows whose `locked_at` is already set (signed orders). Existing rows are not rewritten, so it runs instantly at any table size.
- **Head used: 798508ad (2026-10-25 20:41).** A's order-transmission-integrity fixes (e2d293e1, 2026-10-25 23:27) add migration 20261024000011 with `orders.patient_snapshot` and `orders.prescriber_snapshot`. Its header says the 000010 freeze covers them, but the 000010 at 798508ad does not list them (38 columns, see Verify). **If signed-order-freeze moves to add them, re-copy this block and the verify count from the new head before running.**

**Apply** (verbatim, `supabase/migrations/20261024000010_signed_order_freeze.sql` at 798508ad):

```sql
-- ============================================================
-- Signed-order freeze: every signed clinical column (HIPAA B5)
-- ============================================================
--
-- prevent_snapshot_mutation (BEFORE UPDATE on orders, last redefined in
-- 20261012000001) froze 16 snapshot columns once locked_at is set, but
-- not sig_text, quantity, refills, dispense, days supply and the other
-- clinical columns the provider signed. This replaces the function so a
-- signed order's whole signed content is frozen:
--
--   - the clinical columns the signature binding covers
--     (SIGNED_CONTENT_COLUMNS, src/lib/orders/signature-binding.ts):
--     patient, provider NPI, pharmacy snapshot, medication snapshot, sig
--     and titration / cycling, quantity, dispense, days supply, refills,
--     package, syringes, substitution, shipping type, clinical
--     difference, diagnosis and special instructions;
--   - the signature record: provider_signature_hash_snapshot, locked_at;
--   - prices and where it ships: the price snapshots, shipping_fee and
--     the shipping address snapshot;
--   - who prescribed what: provider_id, formulation_id, catalog_item_id.
--
-- The list is FROZEN_ORDER_COLUMNS in src/lib/orders/signed-order-freeze.ts;
-- src/lib/orders/__tests__/signed-order-freeze.test.ts fails if this
-- array and that list differ.
--
-- One exception, read from the code: the ops reroute
-- (api/ops/orders/[orderId]/action, 'reroute') moves an order from
-- SUBMISSION_FAILED, FAX_FAILED or PHARMACY_REJECTED to REROUTE_PENDING,
-- adds 1 to reroute_count and may change pharmacy_id, in one CAS update.
-- pharmacy_id may change only in exactly that update. The pharmacy the
-- provider signed for stays in pharmacy_snapshot (frozen, and bound by
-- the signature). No other code path writes a frozen column on a signed
-- order (the static scan in the same test).
--
-- Status, tracking, payment and transfer ids, the payment group, fax ids
-- and attempt counts, ops assignee, protocol and proposal links,
-- reroute_count, notes and timestamps stay updatable.
--
-- The message names the column (a column name, never a value: no PHI).
-- Columns are compared through to_jsonb so one array is the whole list.
-- Only the function is replaced; the trigger (20260317000004) stays.
--
-- PREPARED: merges after 20261024000008 (perf-indexes) and
-- 20261024000009 (clinical-difference-saved).

BEGIN;

CREATE OR REPLACE FUNCTION prevent_snapshot_mutation()
RETURNS TRIGGER AS $$
DECLARE
  frozen CONSTANT text[] := ARRAY[
    -- the signed clinical content (SIGNED_CONTENT_COLUMNS)
    'patient_id', 'provider_npi_snapshot', 'pharmacy_snapshot', 'medication_snapshot',
    'sig_mode', 'sig_text', 'titration_steps', 'cycle_on_days', 'cycle_off_days',
    'quantity', 'dispense_quantity', 'dispense_unit', 'days_supply', 'refills',
    'package_id', 'package_label', 'package_count', 'syringe_option', 'substitution_allowed',
    'shipping_type', 'clinical_difference', 'diagnosis_code', 'diagnosis_text', 'special_instructions',
    -- the signature record
    'provider_signature_hash_snapshot', 'locked_at',
    -- prices and where it ships
    'wholesale_price_snapshot', 'retail_price_snapshot', 'shipping_fee', 'shipping_state_snapshot',
    'shipping_address_line1_snapshot', 'shipping_address_line2_snapshot', 'shipping_city_snapshot',
    'shipping_zip_snapshot', 'shipping_address_snapshot_at',
    -- who prescribed what
    'provider_id', 'formulation_id', 'catalog_item_id'
  ];
  old_row jsonb;
  new_row jsonb;
  col     text;
BEGIN
  IF OLD.locked_at IS NOT NULL THEN
    old_row := to_jsonb(OLD);
    new_row := to_jsonb(NEW);
    FOREACH col IN ARRAY frozen LOOP
      IF new_row -> col IS DISTINCT FROM old_row -> col THEN
        RAISE EXCEPTION 'Cannot modify signed clinical or snapshot fields after order is locked: %', col
          USING HINT = 'A signed order is frozen (HIPAA B5). Cancel it and prescribe again instead.';
      END IF;
    END LOOP;

    -- pharmacy_id: only the ops reroute, in its own CAS update.
    IF NEW.pharmacy_id IS DISTINCT FROM OLD.pharmacy_id AND NOT (
      OLD.status::text IN ('SUBMISSION_FAILED', 'FAX_FAILED', 'PHARMACY_REJECTED')
      AND NEW.status::text = 'REROUTE_PENDING'
      AND NEW.reroute_count = OLD.reroute_count + 1
    ) THEN
      RAISE EXCEPTION 'Cannot modify signed clinical or snapshot fields after order is locked: %', 'pharmacy_id'
        USING HINT = 'The pharmacy of a signed order changes only through the ops reroute.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
```

**Verify** (read only):

```sql
WITH f AS (
  SELECT pg_get_functiondef('public.prevent_snapshot_mutation()'::regprocedure) AS def
), frozen AS (
  SELECT m[1] AS col
    FROM f, regexp_matches(substring(f.def from 'ARRAY\[(.*?)\];'), '''([a-z0-9_]+)''', 'g') AS m
)
SELECT
  (SELECT count(*) FROM frozen)                                                AS frozen_columns_expect_38,
  (SELECT count(*) FROM frozen
    WHERE col NOT IN (SELECT column_name FROM information_schema.columns
                       WHERE table_schema = 'public' AND table_name = 'orders'))
                                                                               AS frozen_not_on_orders_expect_0,
  (SELECT count(*) FROM frozen WHERE col IN ('sig_text', 'quantity', 'refills', 'days_supply', 'dispense_quantity', 'patient_id', 'provider_id'))
                                                                               AS newly_frozen_sample_expect_7,
  (SELECT def LIKE '%REROUTE_PENDING%' AND def LIKE '%reroute_count + 1%' FROM f)
                                                                               AS reroute_exception_expect_true,
  (SELECT count(*) FROM pg_trigger t
    WHERE t.tgrelid = 'public.orders'::regclass AND NOT t.tgisinternal
      AND t.tgfoid = 'public.prevent_snapshot_mutation()'::regprocedure)       AS triggers_using_it_expect_1;
```

`frozen_not_on_orders_expect_0` catches a misspelt column name: a name that is not a column of `orders` would never be compared, so it would freeze nothing. Before the migration, the old function has no array: the first and third columns show `0` and the fourth `false` (checked on PGlite without 000010).

**Safe before its PR merges: yes.**
- It changes nothing until an UPDATE touches a signed order (`locked_at` set), and then only refuses an UPDATE that changes one of the 38 columns (or `pharmacy_id` outside the reroute).
- **Checked against the code on main at that point** (everything through clinical-difference-saved): the freeze test's static scan (every `.from('orders') … .update({…})` that is not limited to `status = 'DRAFT'`, and every `casTransition` patch), run as a standalone script on bundle-hipaa 1ea42cc7, clinical-difference-saved d21721a0 and main 2696ff24.
  - It finds no update that writes a frozen column on a signed order.
  - The only `pharmacy_id` write is the ops reroute (`api/ops/orders/[orderId]/action`). Its single `casTransition` patch is exactly the exception: from SUBMISSION_FAILED, FAX_FAILED or PHARMACY_REJECTED to REROUTE_PENDING, `reroute_count + 1` and the new `pharmacy_id`.
  - No SQL function in the 91 migrations updates a frozen column of `orders`.
  - The E2E specs that update orders directly (`e2e/clinic-app.spec.ts`) update drafts only, which the freeze does not touch.
- **Run it before** signed-order-freeze is deployed. Its code does not depend on it, but the HIPAA B5 claim does.

**Down** (emergency only; verbatim, `supabase/migrations/down/20261024000010_down.sql`; restores the function exactly as 20261012000001 left it, 16 columns):

```sql
-- Down migration for 20261024000010_signed_order_freeze.sql
-- Atomic: either the whole rollback lands or none of it does.
--
-- Restores prevent_snapshot_mutation exactly as 20261012000001 left it:
-- the 16 snapshot columns frozen, and sig_text, quantity, refills,
-- dispense and the other clinical columns editable after signing again.
-- Nothing else changed, so nothing else is restored.

BEGIN;

CREATE OR REPLACE FUNCTION prevent_snapshot_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.locked_at IS NOT NULL THEN
    IF (
      NEW.wholesale_price_snapshot         IS DISTINCT FROM OLD.wholesale_price_snapshot         OR
      NEW.retail_price_snapshot            IS DISTINCT FROM OLD.retail_price_snapshot            OR
      NEW.medication_snapshot              IS DISTINCT FROM OLD.medication_snapshot              OR
      NEW.shipping_state_snapshot          IS DISTINCT FROM OLD.shipping_state_snapshot          OR
      NEW.shipping_address_line1_snapshot  IS DISTINCT FROM OLD.shipping_address_line1_snapshot  OR
      NEW.shipping_address_line2_snapshot  IS DISTINCT FROM OLD.shipping_address_line2_snapshot  OR
      NEW.shipping_city_snapshot           IS DISTINCT FROM OLD.shipping_city_snapshot           OR
      NEW.shipping_zip_snapshot            IS DISTINCT FROM OLD.shipping_zip_snapshot            OR
      NEW.shipping_address_snapshot_at     IS DISTINCT FROM OLD.shipping_address_snapshot_at     OR
      NEW.provider_npi_snapshot            IS DISTINCT FROM OLD.provider_npi_snapshot            OR
      NEW.provider_signature_hash_snapshot IS DISTINCT FROM OLD.provider_signature_hash_snapshot OR
      NEW.pharmacy_snapshot                IS DISTINCT FROM OLD.pharmacy_snapshot                OR
      NEW.clinical_difference              IS DISTINCT FROM OLD.clinical_difference              OR
      NEW.diagnosis_code                   IS DISTINCT FROM OLD.diagnosis_code                   OR
      NEW.diagnosis_text                   IS DISTINCT FROM OLD.diagnosis_text                   OR
      NEW.locked_at                        IS DISTINCT FROM OLD.locked_at
    ) THEN
      RAISE EXCEPTION 'Cannot modify snapshot fields after order is locked';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
```

## Pre-merge check for bundle-features: drafts missing a snapshot (read only)

Run **before** bundle-features merges. It brings state-machine-enforcement, after which batch sign refuses a DRAFT missing any of the six snapshots.

- It is a `READ ONLY` transaction that is rolled back.
- **No rows:** nothing to do.
- **Rows:** those drafts cannot be signed after the merge. The file's own advice is to remove them and prescribe them again; the orchestrator decides with Sam.

Verbatim, `scripts/checks/2026-10-25-drafts-missing-snapshots.sql` at b0bd60f8:

```sql
-- ============================================================
-- READ ONLY: DRAFT orders that batch sign will now refuse, 2026-10-25
-- ============================================================
--
-- Since state-machine-enforcement (B-2026-10-25-06), batch sign refuses a
-- draft missing any snapshot that DRAFT -> AWAITING_PAYMENT requires
-- (problem 'missing_snapshot'): wholesale_price_snapshot,
-- retail_price_snapshot, medication_snapshot, shipping_state_snapshot,
-- provider_npi_snapshot, pharmacy_snapshot. Every draft created by
-- POST /api/orders has all six; this finds any that do not (older drafts,
-- or rows written by hand).
--
-- Counts the drafts batch sign would read (active, not deleted), per
-- clinic, with how many lack each field. For Sunrise
-- (a1000000-0000-0000-0000-000000000001) it also lists the order ids.
-- Such a draft cannot be signed: remove it and prescribe it again.
--
-- SELECT only, in a READ ONLY transaction that is rolled back. It changes
-- nothing. Any role that can read orders and clinics can run it.

BEGIN TRANSACTION READ ONLY;

SELECT
  o.clinic_id,
  c.name                                                      AS clinic_name,
  count(*)                                                    AS drafts_missing_a_snapshot,
  count(*) FILTER (WHERE o.wholesale_price_snapshot IS NULL)  AS missing_wholesale_price,
  count(*) FILTER (WHERE o.retail_price_snapshot IS NULL)     AS missing_retail_price,
  count(*) FILTER (WHERE o.medication_snapshot IS NULL)       AS missing_medication,
  count(*) FILTER (WHERE o.shipping_state_snapshot IS NULL)   AS missing_shipping_state,
  count(*) FILTER (WHERE o.provider_npi_snapshot IS NULL)     AS missing_provider_npi,
  count(*) FILTER (WHERE o.pharmacy_snapshot IS NULL)         AS missing_pharmacy,
  CASE WHEN o.clinic_id = 'a1000000-0000-0000-0000-000000000001'
       THEN string_agg(o.order_id::text, ', ' ORDER BY o.created_at)
  END                                                         AS sunrise_order_ids
FROM orders o
LEFT JOIN clinics c ON c.clinic_id = o.clinic_id
WHERE o.status = 'DRAFT'
  AND o.is_active = true
  AND o.deleted_at IS NULL
  AND (o.wholesale_price_snapshot IS NULL
    OR o.retail_price_snapshot IS NULL
    OR o.medication_snapshot IS NULL
    OR o.shipping_state_snapshot IS NULL
    OR o.provider_npi_snapshot IS NULL
    OR o.pharmacy_snapshot IS NULL)
GROUP BY o.clinic_id, c.name
ORDER BY drafts_missing_a_snapshot DESC, c.name;

ROLLBACK;
```

---

# Part 2: merge checklist, in order

Updated 2026-10-26 (D-2026-10-26-03) to the current plan: thirteen PRs, from the fax viewer to the signed-order freeze. Heads as of that day: bundle-security, bundle-ci and bundle-features as in the dry run and their bundle reports; bundle-hipaa 1ea42cc7; clinical-difference-saved d21721a0; signed-order-freeze 798508ad; order-transmission-integrity e2d293e1 (see "Not in the plan yet" at the end).

Rules for every PR:
- **Just before merging:** the branch merges `origin/main` and its CI goes green, E2E included. At that point main holds every PR above it in this list.
- **Prod SQL first:** the SQL named in "Prod SQL before it" is applied to prod and verified **first**.
- **Env vars first:** the variables named in "Env vars in Vercel production" exist in the production project **before** the merge deploys. Names only; Sam sets the values.
- **Where conflicts come from:**
  - For #1 to #8, the conflicts and fixes are the ones the dry run (`docs/qa/merge-dry-run-2026-10-25.md`) and the bundle builds found. Their resolutions are in those reports.
  - For #9 to #13 there is no dry run yet. The conflicts listed are **predicted** from the files both sides change (`git merge-tree` and file overlap against each earlier branch), and need confirming at the merge.
- **Migration order:** E2E shares one Supabase project, and every E2E run applies all of `supabase/migrations/`. So a PR with a migration merges before any other PR runs E2E (CLAUDE.md).

### 1. ops-fax-viewer-documo (migration 000003)

- **What must merge first:** nothing.
- **Prod SQL before it:** **000003**, verified.
- **Merges origin/main first:** yes (1 commit behind). Clean.
- **Combination fix at this point:** none.
- **Env vars in Vercel production:** `DOCUMO_API_KEY` and `DOCUMO_ACCOUNT_ID`, which main already uses for outbound fax.
  - The fax viewer now also needs them to fetch each PDF from Documo.
  - **If missing:** `GET /api/ops/fax/[faxId]/pdf` answers 502 ("could not be fetched"; `requireEnv` throws inside the Documo client and the route catches it). Ops cannot open any inbound fax, and outbound fax fails as it does today.

### 2. rls-user-write-lockdown-v2 (migration 000004)

- **What must merge first:** #1.
- **Prod SQL before it:** **000004**, verified.
- **Merges origin/main first:** yes. `src/lib/proposals/__tests__/proposals-migration-static.test.ts`: main now has #1's version of the same test change; take main's.
- **Combination fix at this point:** none.
- **Env vars in Vercel production:** none new.

### 3. security-followups-2 (migration 000005)

- **What must merge first:** #2.
- **Prod SQL before it:** **000005**, verified.
- **Merges origin/main first:** yes. The same test: take main's.
- **Combination fix at this point:** none.
- **Env vars in Vercel production:** none new.

### 4. signup-squatting (migration 000006)

- **What must merge first:** #3.
- **Prod SQL before it:** **000006**, verified, **immediately before** the merge (see its window note). After the deploy, re-run its verification: `unclaimed_in_approved_clinics_expect_0`.
- **Merges origin/main first:** yes. The same test: take main's.
- **Combination fix at this point:** none.
- **Env vars in Vercel production:** none new.

### 5. rate-limit-db (migration 000007)

- **What must merge first:** #4.
- **Prod SQL before it:** **000007**, verified.
- **Merges origin/main first:** yes.
  - The same test: take main's.
  - `src/app/api/signup/route.ts`: keep #4's duplicate-email guard and make the call `const limit = await signupLimiter.check(ipKey)`.
- **Combination fix at this point:** none.
- **Env vars in Vercel production:** none new (the counts live in the 000007 table).

### 6. bundle-security

- **What must merge first:** #1 to #5.
- **Prod SQL before it:** none.
- **Merges origin/main first:** yes. Main now has #1 to #5. Expected:
  - (a) The handlers security-followups-2 moved to `refuseCrossSite` (`orders/batch-sign`, `patients/[patientId]/duplicate-flag`, `patients/face-sheet`, `patients`, `settings/signup-link`): use the `xHandler` signature with `refuseCrossSite`, and batch-sign keeps api-input-validation's size checks.
  - (b) `ops/onboarding/clinics/[clinicId]` imports (signup-squatting): keep both.
  - (c) `ops/fax/_components/fax-triage-queue.tsx` imports (fax): keep both.
  - Check that rate-limit-db's `await …Limiter.check(…)` calls survive in signup, join, invite accept, face-sheet and plan.
- **Combination fix at this point: the fax PDF route** (dry-run problem 2). `src/app/api/ops/fax/[faxId]/pdf/route.ts` must:
  - become `async function getHandler`;
  - use `refuseCrossSite(request, 'Forbidden', { 'Cache-Control': 'no-store' })`;
  - export `export const GET = withApiErrors('/api/ops/fax/[faxId]/pdf', getHandler)`.

  Otherwise route-error-wrapper and same-origin-moved-routes fail.
- **Env vars in Vercel production:** none new. It reads only names main already sets (`CRON_SECRET`, `ADAPTER_INTERNAL_SECRET`, `WEBHOOK_SECRET_ENCRYPTION_KEY`, the Supabase URL and keys).

### 7. bundle-ci

- **What must merge first:** #6. It is built on bundle-security, so merge origin/main **after #6 is on main**.
- **Prod SQL before it:** none.
- **Merges origin/main first:** yes. Expected: `perf-bundles` against signup-squatting in `ops/onboarding/[clinicId]/_components/clinic-review-details.tsx` and `ops/onboarding/_components/onboarding-admin.tsx`. Import `provider-review-copy` (perf-bundles) and `npi-claims` (signup-squatting).
- **Combination fix at this point:** nothing new. Already in the bundle: the sharded-trial job's Node 24 actions (problem 1) and the global-error `<title>` (problem 6).
- **Env vars in Vercel production:** none new.
  - `TEST_SHARD` and `TEST_SHARD_TOTAL` are set by the CI workflow's matrix, not in Vercel.
  - The E2E and Sentry secrets it reads are the GitHub Actions secrets CI already has.

### 8. bundle-features

Contains rx-quantity-shipping, rx-allergies-required, favorites-frequent, state-machine-enforcement, settings-notifications and the later bundle-features fixes.

- **What must merge first:** #7.
- **Prod SQL before it:** **the read-only drafts-missing-snapshots check** (above). Act on any rows first. No migration.
- **Merges origin/main first:** yes, after #7. Expected (dry run):
  - imports beside error-boundaries' `userMessage` in `margin-builder-form.tsx`, `batch-sign-form.tsx`, `new-protocol-form.tsx` and `allergy-notice.tsx`;
  - favorites-frequent against the route-wide changes.
- **Combination fixes at this point:**
  - Problem 3 (favorites-frequent):
    - move `api/favorites/recent/__tests__/staff-role-gate.test.ts` to `frequent/__tests__/`;
    - point `api/favorites/__tests__/input-validation.test.ts` at `../frequent/route`;
    - in `frequent-route.test.ts`, give the user `app_role: 'provider'`, use a uuid provider id and expect 400 for `provider_id=x`;
    - label the route `withApiErrors('/api/favorites/frequent', …)`.
  - Problem 4: drop the unused `computeBundleShipping` import in `margin-builder-form.tsx`.
  - Problem 5: merge duplicate same-module imports.
- **Env vars in Vercel production:** none new. `PHARMACY_SUBMISSIONS_ENABLED` is already set as main uses it today. Unset or not `true`, paid orders wait and nothing is sent to a pharmacy (the existing switch).

### 9. bundle-hipaa

clinic-help, password-flows, auth-monitoring, audit-review-breakglass, and phi-access-log-coverage inside audit-review-breakglass. Built on bundle-features: D-2026-10-26-02, head 1ea42cc7.

- **What must merge first:** #8. It contains bundle-features, so merge origin/main **after #8 is on main**.
- **Prod SQL before it:** none. No migration: auth-monitoring's alerts use the existing `ops_alert_queue`, and the access-review reasons use existing `phi_access_log` columns.
- **Merges origin/main first: predicted conflicts.** Main now has #1 to #7, which bundle-hipaa's own branches never saw. Files changed on both sides:
  - `src/lib/audit/phi-access.ts`: #1 adds `faxId` to `PhiAccessEntry` and writes `fax_id`; phi-access-log-coverage adds the B14 resources, the boolean returns and the fail-closed alerting; audit-review-breakglass adds `OpsAccessReasonResource`. Keep all three.
  - `src/app/(ops-dashboard)/ops/fax/page.tsx` and `src/app/api/ops/fax/route.ts`: see the combination fix below.
  - `src/app/api/providers/route.ts` and `src/lib/signup/self-serve.ts`: signup-squatting's NPI claim check against password-flows' provider invite. Keep both: the invite flow, and the `.neq('npi_claimed', false)` list check.
  - security-followups-2's and rate-limit-db's handlers (`orders/batch-sign`, `patients/face-sheet`, `onboarding/invite/accept`, `join/[token]`, `plan/[token]`) against coverage's PHI logging in the same handlers. Keep `refuseCrossSite`, the `await …check(…)` calls and the `logPhiAccess` calls.
  - `src/middleware.ts`: keep every public path, the reset paths (`/forgot-password`, `/api/auth/password-reset`) and `/api/sign-in`.
- **Combination fix at this point: the fax queue log.**
  - After #1 the queue no longer hands out signed PDF URLs: each PDF opens through `/api/ops/fax/[faxId]/pdf`, which logs one `view`/`inbound_fax` row with `fax_id`.
  - coverage's `logFaxQueueView` comment says "the signed URLs below open the fax PDFs". That is no longer true:
    - keep the queue-view rows (the queue still shows each fax's matched order);
    - correct that comment;
    - keep #1's PDF-route log row as it is.
  - Then in `src/lib/audit/access-review.ts`, `inbound_fax` must count as a list view only on the queue routes (`/ops/fax`, `/api/ops/fax`), not on the PDF route. Otherwise PDF opens are left out of `bulk_patients`. That is a two-line change, and its test goes beside `access-review-fixes.test.ts`.
- **Env vars in Vercel production:**
  - **`PHI_ACCESS_LOG_HASH_SECRET`**: exists on main, but bundle-hipaa makes it required.
    - **If missing in production:** `GET /api/health` answers 503 (`checks.phi_audit_hash_secret: "missing"`), so the deploy verify job fails the deploy and notifies Slack. It does not roll back.
    - PHI access rows are still written, but with null email, IP and user-agent hashes.
    - The sign-in monitor's per-account alert never fires (it needs the email hash).
  - `APP_BASE_URL`: exists. Password reset now also needs it for the email's link. **If missing:** `POST /api/auth/password-reset` answers 500 and no reset email is sent.
  - **Demo deployment only:** `POC_OPS_PASSWORD`, `POC_CLINIC_ADMIN_PASSWORD`, `POC_PROVIDER_PASSWORD`, `POC_MA_PASSWORD`. **If missing:**
    - ops "Reset Demo Credentials" skips that account with an error naming the variable;
    - `scripts/seed-poc.ts` stops before writing;
    - `scripts/fix-rls.ts` throws naming `POC_OPS_PASSWORD`;
    - the demo-tools page shows which are set.
  - Not needed for real clinics.
  - Not a Vercel variable: `E2E_TEST_PASSWORD`. CI derives the E2E password from `E2E_SUPABASE_SERVICE_ROLE_KEY` when it is unset, so no new GitHub secret is needed.
- **After the deploy (Sam):** rotate the old POC and E2E account passwords on every Supabase project where they were used (C's B9 note). The old values are still in git history.

### 10. bundle-docs

- **What must merge first:** nothing; it changes no code, so it can go earlier.
- **Prod SQL before it:** none.
- **Merges origin/main first:** yes. Docs only, so expect no conflicts. CI skips E2E.
- **Combination fix at this point:** none.
- **Env vars in Vercel production:** none.

### 11. perf-indexes (migration 000008)

- **What must merge first:** #9 (the plan's order; the indexes do not depend on it).
- **Prod SQL before it:** **000008**, verified. Read its editor notes on lock time first.
- **Merges origin/main first:** yes. The branch is on an older main. `git merge-tree` into bundle-hipaa 1ea42cc7 shows no conflicts. It changes the migration, its down file, its static test (`perf-indexes-migration.test.ts`) and the shared `proposals-migration-static.test.ts`. That last one is the test #2 to #5 also change: take main's version, then reapply perf-indexes' own change to it.
- **Combination fix at this point:** none known.
- **Env vars in Vercel production:** none.

### 12. clinical-difference-saved (migration 000009)

- **What must merge first:** #11.
- **Prod SQL before it:** **000009**, verified.
- **Merges origin/main first:** yes. Built on an earlier bundle-features (merge d1c66842). Main now has bundle-features' later commits, bundle-hipaa and bundle-docs. `git merge-tree` of clinical-difference-saved into bundle-hipaa 1ea42cc7 shows **no conflicts**. Re-check against #1 to #7, which bundle-hipaa does not contain: the branch's files (`api/clinical-statements`, `rx-details-row.tsx`, `database.types.ts`) are not among #1 to #7's changes in that overlap check.
- **Combination fix at this point:** none known.
- **Env vars in Vercel production:** none.

### 13. signed-order-freeze (migration 000010)

- **What must merge first:** #12. It contains clinical-difference-saved and an older order-transmission-integrity (2b9b69a5).
- **Prod SQL before it:** **000010**, verified, from the head being merged. Re-copy it if the branch moved after 798508ad.
- **Merges origin/main first:** yes. `git merge-tree` into bundle-hipaa 1ea42cc7 shows **one conflict**: `src/app/api/ops/orders/[orderId]/action/route.ts`, in its imports. signed-order-freeze imports `REROUTE_FROM_STATUSES` (the reroute's allowed statuses, shared with the freeze), and phi-access-log-coverage imports `logPhiAccess` and adds the fail-closed `ops_order_action` row. Keep both: the imports, the log row before any change, and `REROUTE_FROM_STATUSES.includes(currentStatus)` in the reroute.
- **Combination fix at this point:** `FROZEN_ORDER_COLUMNS` and the migration's array must stay equal (`signed-order-freeze.test.ts` fails otherwise). See the next section for the two columns order-transmission-integrity adds.
- **Env vars in Vercel production:**
  - none at 798508ad;
  - **`RX_BINDING_SECRET`** once order-transmission-integrity's T1-T7 code (e2d293e1) is merged into this branch or reaches main.

### Not in the plan yet: order-transmission-integrity (migration 000011)

A pushed T1-T7 on 2026-10-25 at 23:27 (e2d293e1). That head adds a migration, `20261024000011_order_signing_snapshots.sql`: `orders.patient_snapshot` and `orders.prescriber_snapshot`, marked "PREPARED: merges after 20261024000010". So it is now a migration branch, and the orchestrator has to decide where it goes. Facts for that decision:

- **It cannot go into bundle-hipaa** (no migration branches in bundles). Its natural place is a PR of its own after #13, or merged into signed-order-freeze before #13.
- **Its signing code writes the two new columns.** Deploying it before 000011 is applied would make every signing fail. Its prod SQL needs a runbook entry like the ones above, which this runbook does not have yet.
- **Its 000011 header says the 000010 freeze covers the two new columns** ("its column list is the binding's"). The 000010 at 798508ad does not list them (38 columns, neither of the two). Either signed-order-freeze adds them (A's update; then re-copy 000010 and set the verify count to 40), or 000011 extends the freeze itself.
- **`RX_BINDING_SECRET`** (new; must be in Vercel production before it deploys). **If missing in production:**
  - `GET /api/health` answers 503 (`checks.rx_binding_secret: "missing"`), so the deploy verify job fails the deploy;
  - batch sign refuses with 503 `BINDING_KEY_MISSING` before reading anything, so nothing can be signed;
  - every transmission is refused with `binding_key_missing`, so nothing is sent to a pharmacy.
- **Outside production:** the health check reports it, and the binding uses a fixed development key, so preview, local and CI sign as before.

After all thirteen, every migration from 20261024000003 to 20261024000010 is on main, and each was applied to prod before the code that uses it. 20261024000011 waits for the orchestrator's decision above.
