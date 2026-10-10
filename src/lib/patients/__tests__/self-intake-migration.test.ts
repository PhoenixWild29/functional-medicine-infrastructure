/**
 * @jest-environment node
 *
 * Patient Intake v1.1, PR 2: the one migration (20261015000001).
 *
 * There is no Postgres runner in this repo, so this pins what the SQL must
 * say (the same approach as consent-intake-migration.test.ts):
 *
 *   - a patient added with only a mobile number may have no name or date
 *     of birth while intake is pending, and must have all three once it is
 *     complete;
 *   - patients gain current_medications, intake_completed_at and the
 *     privacy notice acknowledgement;
 *   - patient_intake_links stores only the SHA-256 of the token, single
 *     use, expiring, at most one open link per patient;
 *   - RLS on the new table reads the clinic from app_metadata, never
 *     user_metadata, and only the service role writes;
 *   - it sorts after D's 20261013000001 and B's 20261014000001;
 *   - the down migration refuses rather than invent a name or DOB.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations')
const FILE = '20261015000001_patient_self_intake.sql'
const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '')
const sql = read(join(MIGRATIONS, FILE))
const down = read(join(MIGRATIONS, 'down', '20261015000001_down.sql'))
const flat = (s: string) => s.replace(/--.*$/gm, '').replace(/\s+/g, ' ').toLowerCase()
const code = flat(sql)
const downCode = flat(down)

describe('the migration file', () => {
  it('exists, with a down migration, and runs in one transaction', () => {
    expect(sql).not.toBe('')
    expect(down).not.toBe('')
    expect(code).toMatch(/^\s*begin;/)
    expect(code).toMatch(/commit;\s*$/)
    expect(downCode).toMatch(/^\s*begin;/)
    expect(downCode).toMatch(/commit;\s*$/)
  })

  it('sorts after 20261013000001 and 20261014000001', () => {
    expect(FILE > '20261014000001_~').toBe(true)
    expect(FILE.startsWith('20261015000001_')).toBe(true)
  })
})

describe('patients', () => {
  it('lets first_name, last_name and date_of_birth be empty', () => {
    expect(code).toMatch(/alter column first_name drop not null/)
    expect(code).toMatch(/alter column last_name drop not null/)
    expect(code).toMatch(/alter column date_of_birth drop not null/)
  })

  it('requires all three once intake is complete', () => {
    expect(code).toMatch(
      /add constraint chk_patients_identity_when_complete check \( intake_status = 'pending' or \(first_name is not null and last_name is not null and date_of_birth is not null\) \)/,
    )
  })

  it('does not relax phone: a patient always has a mobile number', () => {
    expect(code).not.toMatch(/alter column phone drop not null/)
  })

  it('gains current_medications, intake_completed_at and the privacy notice acknowledgement', () => {
    expect(code).toMatch(/add column if not exists current_medications text/)
    expect(code).toMatch(/add column if not exists intake_completed_at timestamptz/)
    expect(code).toMatch(/add column if not exists privacy_notice_ack_at timestamptz/)
    expect(code).toMatch(/add column if not exists privacy_notice_version text/)
  })
})

describe('patient_intake_links', () => {
  it('stores a SHA-256 hex hash, never the token', () => {
    expect(code).toMatch(/create table if not exists patient_intake_links/)
    expect(code).toContain("token_hash ~ '^[0-9a-f]{64}$'")
    expect(code).not.toMatch(/\btoken text\b/)
    expect(code).toMatch(/create unique index if not exists uq_intake_links_token_hash on patient_intake_links \(token_hash\)/)
  })

  it('is single use and expiring, revoked when resent, one open link per patient', () => {
    expect(code).toMatch(/expires_at timestamptz not null/)
    expect(code).toMatch(/used_at timestamptz/)
    expect(code).toMatch(/revoked_at timestamptz/)
    expect(code).toMatch(
      /create unique index if not exists uq_intake_links_one_open_per_patient on patient_intake_links \(patient_id\) where used_at is null and revoked_at is null/,
    )
  })

  it('has RLS on, a clinic read policy on app_metadata, and no write policy', () => {
    expect(code).toMatch(/alter table patient_intake_links enable row level security/)
    expect(code).toMatch(
      /create policy intake_links_clinic_user_select on patient_intake_links for select to authenticated using \(clinic_id = \(auth\.jwt\(\) -> 'app_metadata' ->> 'clinic_id'\)::uuid\)/,
    )
    expect(code).not.toMatch(/user_metadata/)
    expect(code).not.toMatch(/on patient_intake_links for (insert|update|delete|all)/)
    expect(code).toMatch(/revoke all on patient_intake_links from anon/)
  })
})

describe('the down migration', () => {
  it('refuses while a patient has no name or date of birth, instead of inventing one', () => {
    expect(downCode).toMatch(/raise exception/)
    expect(downCode).toMatch(/first_name is null or last_name is null or date_of_birth is null/)
  })

  it('drops the table and columns and restores NOT NULL', () => {
    expect(downCode).toMatch(/drop table if exists patient_intake_links/)
    expect(downCode).toMatch(/alter column first_name set not null/)
    expect(downCode).toMatch(/alter column last_name set not null/)
    expect(downCode).toMatch(/alter column date_of_birth set not null/)
    expect(downCode).toMatch(/drop constraint if exists chk_patients_identity_when_complete/)
  })
})

// ── Intake decisions (Oct 10): the intake text, and duplicate flags ──

import { INTAKE_LINK_SMS } from '@/lib/sms/templates'

describe('the intake text template', () => {
  it('allows intake_link in sms_templates and keeps its reference row identical to the app\'s text', () => {
    expect(code).toMatch(/drop constraint if exists sms_templates_template_name_check/)
    expect(code).toMatch(/add constraint sms_templates_template_name_check check \(template_name in \( ?'payment_link', ?'reminder_24h', ?'reminder_48h', ?'payment_confirmation', ?'shipping_notification', ?'delivered', ?'custom', ?'intake_link' ?\)\)/)
    expect(sql).toContain(`'intake_link',\n  '${INTAKE_LINK_SMS}'`)
  })

  it('the down migration removes the row and restores the constraint without it', () => {
    expect(downCode).toMatch(/delete from sms_templates where template_name = 'intake_link'/)
    expect(downCode).toMatch(/check \(template_name in \( ?'payment_link', ?'reminder_24h', ?'reminder_48h', ?'payment_confirmation', ?'shipping_notification', ?'delivered', ?'custom' ?\)\)/)
  })
})

describe('possible duplicate flag on the patient', () => {
  it('points at another patient, records what matched and when, and who dismissed it', () => {
    expect(code).toMatch(/add column if not exists possible_duplicate_of uuid references patients\(patient_id\)/)
    expect(code).toMatch(/add column if not exists possible_duplicate_matched_on text/)
    expect(code).toMatch(/add column if not exists possible_duplicate_flagged_at timestamptz/)
    expect(code).toMatch(/add column if not exists possible_duplicate_dismissed_at timestamptz/)
    expect(code).toMatch(/add column if not exists possible_duplicate_dismissed_by uuid/)
    expect(code).toMatch(/possible_duplicate_of is distinct from patient_id/)
  })

  it('the down migration drops them', () => {
    for (const c of ['possible_duplicate_of', 'possible_duplicate_matched_on', 'possible_duplicate_flagged_at', 'possible_duplicate_dismissed_at', 'possible_duplicate_dismissed_by']) {
      expect(downCode).toContain(`drop column if exists ${c}`)
    }
  })
})
