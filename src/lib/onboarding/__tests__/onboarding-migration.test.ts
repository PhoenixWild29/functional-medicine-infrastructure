/**
 * @jest-environment node
 *
 * Migration 20261013000001 (clinic onboarding), read as text:
 *   - every new table has RLS enabled, and every policy reads the role and
 *     clinic from app_metadata (never user_metadata)
 *   - BAA / terms acceptances and the onboarding audit log are append-only
 *     (a trigger refuses UPDATE and DELETE)
 *   - invites store only a SHA-256 token hash
 *   - clinics keep the tax ID's last 4 only; existing clinics stay approved
 *   - no patient data in these tables
 *   - the down file removes everything the up file adds
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(process.cwd(), 'supabase', 'migrations')
const UP = join(DIR, '20261013000001_clinic_onboarding.sql')
const DOWN = join(DIR, 'down', '20261013000001_down.sql')

const strip = (s: string) => s.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').toLowerCase()
const up = existsSync(UP) ? strip(readFileSync(UP, 'utf8')) : ''
const down = existsSync(DOWN) ? strip(readFileSync(DOWN, 'utf8')) : ''

const TABLES = ['onboarding_invites', 'clinic_onboarding_steps', 'agreement_acceptances', 'clinic_onboarding_events']

function createTable(name: string): string {
  const m = new RegExp(`create table if not exists ${name} \\((.*?)\\);`).exec(up)
  return m ? m[1]! : ''
}

it('the migration and its down file exist', () => {
  expect(existsSync(UP)).toBe(true)
  expect(existsSync(DOWN)).toBe(true)
})

it.each(TABLES)('%s is created with RLS enabled', t => {
  expect(createTable(t)).not.toBe('')
  expect(up).toContain(`alter table ${t} enable row level security`)
})

it('every policy reads role and clinic from app_metadata, never user_metadata', () => {
  const policies = up.match(/create policy [^;]*;/g) ?? []
  expect(policies.length).toBeGreaterThan(0)
  for (const p of policies) {
    expect(p).not.toMatch(/user_metadata|raw_user_meta_data/)
    if (/auth\.jwt\(\)/.test(p)) expect(p).toContain("'app_metadata'")
  }
})

it.each(['agreement_acceptances', 'clinic_onboarding_events'])('%s is append-only', t => {
  expect(up).toMatch(new RegExp(`create trigger [a-z_]+ before update or delete on ${t} for each row execute function [a-z_]+\\(\\)`))
})

it('invites store a SHA-256 token hash and never the token', () => {
  const cols = createTable('onboarding_invites')
  expect(cols).toMatch(/token_hash text not null/)
  expect(up).toMatch(/token_hash ~ '\^\[0-9a-f\]\{64\}\$'/)
  expect(cols).not.toMatch(/\btoken text\b/)
})

it('clinics keep the tax ID last 4 only, and existing clinics stay approved', () => {
  expect(up).toMatch(/add column if not exists tax_id_last4 text/)
  expect(up).toMatch(/tax_id_last4 ~ '\^\\d\{4\}\$'/)
  expect(up).toMatch(/add column if not exists onboarding_status text not null default 'approved'/)
})

it('holds no patient data', () => {
  for (const t of TABLES) {
    expect(createTable(t)).not.toMatch(/patient|date_of_birth|\bdob\b|diagnosis|medication/)
  }
})

it('the down file drops every new table and clinic column', () => {
  for (const t of TABLES) expect(down).toContain(`drop table if exists ${t}`)
  for (const c of ['onboarding_status', 'legal_name', 'dba_name', 'address_line1', 'address_line2', 'city', 'state', 'postal_code', 'practice_npi', 'tax_id_last4', 'onboarding_submitted_at', 'onboarding_reviewed_at', 'onboarding_reviewed_by', 'onboarding_review_note']) {
    expect(down).toContain(`drop column if exists ${c}`)
  }
})
