/**
 * @jest-environment node
 *
 * Team invites: the one migration (20261021000001, approved design).
 *
 * No Postgres runner here (CI applies the migrations for real on the E2E
 * database), so this pins what the SQL must say:
 *   - onboarding_invites.invitee_name (1 to 200 characters, or empty);
 *   - clinic_onboarding_events: member_deactivated / member_reactivated
 *     (every existing event kept) and subject_user_id, required for them;
 *   - clinic_team_members(clinic): the clinic's logins from auth.users;
 *   - set_clinic_member_active(clinic, user, active, actor): one
 *     transaction under a per-clinic lock; refuses the clinic's last active
 *     admin; app_metadata flags, ban, sessions and refresh tokens deleted,
 *     providers.is_active, the audit event; reactivation undoes the flags
 *     and the ban;
 *   - both functions SECURITY DEFINER with search_path fixed, executable by
 *     the service role only;
 *   - safe to apply twice; apply_pharmacy_admin_scope() last; the header
 *     notes the accepted 1-hour access-token gap; the down file refuses
 *     while anyone is deactivated.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(process.cwd(), 'supabase', 'migrations')
const FILE = '20261021000001_team_invites.sql'
const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8').replace(/\r\n/g, '\n') : '')
const raw = read(join(DIR, FILE))
const flat = (s: string) => s.replace(/--.*$/gm, '').replace(/\s+/g, ' ').toLowerCase()
const code = flat(raw)
const down = flat(read(join(DIR, 'down', '20261021000001_down.sql')))

function fn(name: string): string {
  const at = code.indexOf(`create or replace function ${name}(`)
  return at < 0 ? '' : code.slice(at, code.indexOf('$$;', code.indexOf('$$', at) + 2) + 3)
}

it('exists with a down file, each one transaction, numbered 20261021000001 and alone at that number', () => {
  expect(code).toMatch(/^\s*begin;/)
  expect(code).toMatch(/commit;\s*$/)
  expect(down).toMatch(/^\s*begin;.*commit;\s*$/)
  expect(readdirSync(DIR).filter(f => f.startsWith('20261021000001_'))).toEqual([FILE])
})

it('the header notes the accepted 1-hour gap for an access token already issued', () => {
  const header = raw.slice(0, raw.indexOf('BEGIN;'))
  expect(header).toMatch(/access token/i)
  expect(header).toMatch(/1 hour|one hour|1-hour/i)
})

it('ends with SELECT apply_pharmacy_admin_scope(); right before COMMIT', () => {
  expect(code).toMatch(/select apply_pharmacy_admin_scope\(\); commit;\s*$/)
})

describe('values the database refuses', () => {
  it('invitee_name: empty, or 1 to 200 characters after trimming', () => {
    expect(code).toContain('alter table onboarding_invites add column if not exists invitee_name text')
    expect(code).toMatch(/add constraint chk_onboarding_invites_invitee_name check \(invitee_name is null or char_length\(btrim\(invitee_name\)\) between 1 and 200\)/)
  })

  it('events: the two member events join every existing event; they need a subject', () => {
    expect(code).toContain('alter table clinic_onboarding_events add column if not exists subject_user_id uuid')
    const check = code.slice(code.indexOf('add constraint chk_onboarding_events_event'), code.indexOf(');', code.indexOf('add constraint chk_onboarding_events_event')))
    for (const e of ['invite_created', 'invite_revoked', 'invite_resent', 'invite_accepted', 'submitted', 'approved', 'sent_back', 'self_signup', 'member_deactivated', 'member_reactivated']) {
      expect(check).toContain(`'${e}'`)
    }
    expect(code).toMatch(/add constraint chk_onboarding_events_subject check \(event not in \('member_deactivated', ?'member_reactivated'\) or subject_user_id is not null\)/)
  })
})

describe('clinic_team_members', () => {
  const f = () => fn('clinic_team_members')

  it('lists the clinic’s logins from auth.users by app_metadata clinic_id, with role and deactivation', () => {
    expect(f()).not.toBe('')
    expect(f()).toMatch(/returns table \(user_id uuid, email text, full_name text, role text, deactivated_at timestamptz, last_sign_in_at timestamptz\)/)
    expect(f()).toContain('from auth.users')
    expect(f()).toContain("raw_app_meta_data ->> 'clinic_id' = p_clinic_id::text")
    expect(f()).toContain("raw_app_meta_data ->> 'app_role'")
    expect(f()).toContain('deleted_at is null')
  })

  it('security definer, search_path fixed, service role only', () => {
    expect(f()).toContain('security definer')
    expect(f()).toMatch(/set search_path = public, pg_catalog/)
    expect(code).toContain('revoke execute on function clinic_team_members(uuid) from public, anon, authenticated')
    expect(code).toContain('grant execute on function clinic_team_members(uuid) to service_role')
  })
})

describe('set_clinic_member_active', () => {
  const f = () => fn('set_clinic_member_active')

  it('runs under a per-clinic lock, on a member of that clinic only', () => {
    expect(f()).not.toBe('')
    expect(f()).toMatch(/pg_advisory_xact_lock\(hashtextextended\('clinic_team:' \|\| p_clinic_id::text, 0\)\)/)
    expect(f()).toMatch(/from auth\.users where id = p_user_id and raw_app_meta_data ->> 'clinic_id' = p_clinic_id::text for update/)
    expect(f()).toContain("'not_found'")
  })

  it('refuses to deactivate the clinic’s last active admin, before changing anything', () => {
    const body = f()
    const refusal = body.indexOf("'last_admin'")
    expect(refusal).toBeGreaterThan(-1)
    expect(body).toMatch(/raw_app_meta_data ->> 'app_role' = 'clinic_admin' and not \(raw_app_meta_data \? 'deactivated_at'\) and deleted_at is null and id <> p_user_id/)
    expect(refusal).toBeLessThan(body.indexOf('update auth.users'))
    expect(refusal).toBeLessThan(body.indexOf('delete from auth.sessions'))
  })

  it('deactivating: flags in app_metadata, a ban, sessions and refresh tokens deleted, provider inactive, the event', () => {
    const body = f()
    expect(body).toMatch(/raw_app_meta_data = raw_app_meta_data \|\| jsonb_build_object\('deactivated_at', now\(\), 'deactivated_by', p_actor\)/)
    expect(body).toMatch(/banned_until = now\(\) \+ interval '100 years'/)
    expect(body).toContain('delete from auth.refresh_tokens where user_id = p_user_id::text')
    expect(body).toContain('delete from auth.sessions where user_id = p_user_id')
    expect(body).toMatch(/update providers set is_active = false[^;]*where user_id = p_user_id and clinic_id = p_clinic_id/)
    expect(body).toMatch(/insert into clinic_onboarding_events \(clinic_id, event, actor_user_id, actor_role, subject_user_id\) values \(p_clinic_id, 'member_deactivated', p_actor, 'clinic_admin', p_user_id\)/)
  })

  it('reactivating: the flags and the ban removed, provider active, the event', () => {
    const body = f()
    expect(body).toMatch(/raw_app_meta_data = raw_app_meta_data - 'deactivated_at' - 'deactivated_by'/)
    expect(body).toContain('banned_until = null')
    expect(body).toMatch(/update providers set is_active = true[^;]*where user_id = p_user_id and clinic_id = p_clinic_id and deleted_at is null/)
    expect(body).toContain("'member_reactivated'")
  })

  it('deletes no user: history is kept', () => {
    expect(f()).not.toMatch(/delete from auth\.users|delete from providers/)
  })

  it('security definer, search_path fixed, service role only', () => {
    expect(f()).toContain('security definer')
    expect(f()).toMatch(/set search_path = public, pg_catalog/)
    expect(code).toContain('revoke execute on function set_clinic_member_active(uuid, uuid, boolean, uuid) from public, anon, authenticated')
    expect(code).toContain('grant execute on function set_clinic_member_active(uuid, uuid, boolean, uuid) to service_role')
  })
})

describe('safe to apply twice', () => {
  const before = (needle: string, at: number) => code.lastIndexOf(needle, at) > -1

  it('every named constraint is dropped if it exists before it is added', () => {
    const adds = [...code.matchAll(/add constraint ([a-z_]+)/g)]
    expect(adds.length).toBeGreaterThanOrEqual(3)
    for (const m of adds) expect([m[1], before(`drop constraint if exists ${m[1]}`, m.index!)]).toEqual([m[1], true])
  })

  it('columns only if missing; functions replaced; no table created', () => {
    expect(code).not.toMatch(/add column (?!if not exists)/)
    expect(code).not.toMatch(/create function/)
    expect(code).not.toMatch(/create table/)
  })
})

it('the down file refuses while anyone is deactivated, then reverses everything', () => {
  expect(down).toMatch(/raise exception/)
  expect(down).toContain("raw_app_meta_data ? 'deactivated_at'")
  expect(down).toContain('drop function if exists set_clinic_member_active(uuid, uuid, boolean, uuid)')
  expect(down).toContain('drop function if exists clinic_team_members(uuid)')
  expect(down).toContain('drop column if exists subject_user_id')
  expect(down).toContain('drop column if exists invitee_name')
  expect(down).not.toContain("'member_deactivated'")
  expect(down).toContain("'self_signup'")
})
