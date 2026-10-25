/**
 * @jest-environment node
 *
 * Migration 20261024000007: the shared rate-limit count (security review
 * L7). Its behaviour (atomic increments under concurrency, window rollover,
 * pruning, grants) is checked on PGlite against every migration
 * (scripts/security/pglite-check/rate-limit.mjs). This pins the text.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(process.cwd(), 'supabase', 'migrations')
const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8').replace(/\r\n/g, '\n') : '')
const flat = (s: string) => s.replace(/--.*$/gm, '').replace(/\s+/g, ' ').toLowerCase()
const up = flat(read(join(DIR, '20261024000007_rate_limit_hits.sql')))
const down = flat(read(join(DIR, 'down', '20261024000007_down.sql')))

it('exists with a down file, one transaction each', () => {
  expect(up).toMatch(/^\s*begin;.*commit;\s*$/)
  expect(down).toMatch(/^\s*begin;.*commit;\s*$/)
})

it('the table: bucket, keyed hash, window, count; primary key over the three; RLS on; no grants to anon or authenticated', () => {
  expect(up).toContain('create table if not exists rate_limit_hits')
  expect(up).toMatch(/primary key \(bucket, key_hash, window_start\)/)
  expect(up).toMatch(/key_hash text not null check \(key_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/)
  expect(up).toContain('alter table rate_limit_hits enable row level security')
  expect(up).toContain('revoke all on rate_limit_hits from public, anon, authenticated')
  expect(up).not.toMatch(/create policy/)
})

it('the RPC: atomic upsert-increment, prunes its bucket, SECURITY DEFINER with pg_catalog first, service_role only', () => {
  expect(up).toContain('create or replace function rate_limit_hit(p_bucket text, p_key_hash text, p_window_seconds integer)')
  expect(up).toContain('security definer set search_path = pg_catalog, public')
  expect(up).toMatch(/on conflict \(bucket, key_hash, window_start\) do update set hit_count = h\.hit_count \+ 1/)
  expect(up).toMatch(/delete from public\.rate_limit_hits/)
  expect(up).toContain('revoke execute on function rate_limit_hit(text, text, integer) from public, anon, authenticated')
  expect(up).toContain('grant execute on function rate_limit_hit(text, text, integer) to service_role')
  expect(up.trim().endsWith('select apply_pharmacy_admin_scope(); commit;')).toBe(true)
})

it('the down file drops the function and the table', () => {
  expect(down).toContain('drop function if exists rate_limit_hit(text, text, integer)')
  expect(down).toContain('drop table if exists rate_limit_hits')
})
