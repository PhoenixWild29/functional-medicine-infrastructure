/**
 * @jest-environment node
 *
 * Decision 11 follow-up: migration 20261028000001 gives provider_favorites
 * a deleted_at column (DELETE /api/favorites sets it), hides deleted rows
 * from user-JWT reads with a RESTRICTIVE SELECT policy, and makes
 * collapse_provider_favorites() ignore them. Pins the text; the behaviour
 * is checked on PGlite in src/__tests__/favorites-soft-delete-pglite.test.ts.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(process.cwd(), 'supabase', 'migrations')
const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8').replace(/\r\n/g, '\n') : '')
const flat = (s: string) => s.replace(/--.*$/gm, '').replace(/\s+/g, ' ').toLowerCase()
const up = flat(read(join(DIR, '20261028000001_favorites_soft_delete.sql')))
const down = flat(read(join(DIR, 'down', '20261028000001_down.sql')))

it('exists with a down file, one transaction each', () => {
  expect(up).toMatch(/^\s*begin;.*commit;\s*$/)
  expect(down).toMatch(/^\s*begin;.*commit;\s*$/)
})

it('adds deleted_at idempotently, with a partial index for the live list', () => {
  expect(up).toContain('alter table public.provider_favorites add column if not exists deleted_at timestamptz')
  expect(up).toMatch(/create index if not exists idx_provider_favorites_live on public\.provider_favorites \(provider_id, use_count desc\) where deleted_at is null/)
})

it('hides deleted rows from user-JWT reads with a restrictive select policy', () => {
  expect(up).toContain('drop policy if exists provider_favorites_hide_deleted on public.provider_favorites')
  expect(up).toContain('create policy provider_favorites_hide_deleted on public.provider_favorites as restrictive for select to authenticated using (deleted_at is null)')
})

it('collapse_provider_favorites() merges live rows only, with the same grants', () => {
  expect(up).toContain('create or replace function collapse_provider_favorites()')
  expect(up).toMatch(/join providers p on p\.provider_id = f\.provider_id where f\.deleted_at is null group by/)
  expect(up).toContain('revoke all on function collapse_provider_favorites() from anon, authenticated')
  expect(up).toContain('grant execute on function collapse_provider_favorites() to service_role')
})

it('ends with apply_pharmacy_admin_scope() before COMMIT', () => {
  expect(up.trim().endsWith('select apply_pharmacy_admin_scope(); commit;')).toBe(true)
})

it('the down file drops the policy, the index and the column, and restores the function', () => {
  expect(down).toContain('drop policy if exists provider_favorites_hide_deleted on public.provider_favorites')
  expect(down).toContain('drop index if exists public.idx_provider_favorites_live')
  expect(down).toContain('create or replace function collapse_provider_favorites()')
  expect(down).not.toContain('deleted_at is null')
  // A deleted favorite stays deleted: the rows are removed before the column goes.
  expect(down).toMatch(/delete from public\.provider_favorites where deleted_at is not null; .*alter table public\.provider_favorites drop column if exists deleted_at/)
})
