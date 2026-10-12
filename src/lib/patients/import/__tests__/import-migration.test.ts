/**
 * @jest-environment node
 *
 * Patient CSV import: migration 20261016000002 (after D's 20261016000001,
 * before B's 20261017000001). No Postgres runner here: this pins what the
 * SQL must say.
 *
 *   - patients.phone may be empty when there is an email (a patient needs
 *     a mobile or an email), so email-only rows can be imported;
 *   - source gains 'csv_import';
 *   - patient_import_batches: who, when, file name, row counts; RLS on
 *     app_metadata, read-only for the clinic, written by the service role;
 *   - patients.import_batch_id links each imported patient to its batch;
 *   - import_patient_batch(...): the batch and its patients in one
 *     transaction (a function body), complete, csv_import, texts off,
 *     executable by the service role only;
 *   - SELECT apply_pharmacy_admin_scope(); is the last statement before
 *     COMMIT; the down migration refuses rather than lose data.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations')
const FILE = '20261016000002_patient_csv_import.sql'
const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8').replace(/\r\n/g, '\n') : '')
const flat = (s: string) => s.replace(/--.*$/gm, '').replace(/\s+/g, ' ').toLowerCase()
const code = flat(read(join(MIGRATIONS, FILE)))
const down = flat(read(join(MIGRATIONS, 'down', '20261016000002_down.sql')))

it('exists, with a down file, each in one transaction, numbered 20261016000002', () => {
  expect(code).not.toBe('')
  expect(down).not.toBe('')
  expect(code).toMatch(/^\s*begin;/)
  expect(down).toMatch(/^\s*begin;/)
  expect(readdirSync(MIGRATIONS).filter(f => f.startsWith('20261016000002_'))).toEqual([FILE])
})

it('patients.phone may be empty, but a patient has a mobile or an email', () => {
  expect(code).toMatch(/alter table patients alter column phone drop not null/)
  expect(code).toMatch(/add constraint chk_patients_phone_or_email check \(phone is not null or email is not null\)/)
})

it("source allows 'csv_import' (and keeps every existing value)", () => {
  expect(code).toMatch(/drop constraint if exists patients_source_check/)
  expect(code).toMatch(/add constraint patients_source_check check \(source in \('staff', ?'self_intake', ?'import', ?'ehr', ?'csv_import'\)\)/)
})

it('patient_import_batches: who, when, file, counts; RLS read for the clinic on app_metadata, no write policy', () => {
  expect(code).toMatch(/create table if not exists patient_import_batches \(/)
  for (const col of ['batch_id uuid', 'clinic_id uuid not null references clinics', 'imported_by uuid not null', 'file_name text not null', 'total_rows integer not null', 'imported_rows integer not null', 'excluded_rows integer not null', 'duplicates_confirmed integer not null', 'created_at timestamptz not null default now()']) {
    expect(code).toContain(col)
  }
  expect(code).toMatch(/alter table patient_import_batches enable row level security/)
  expect(code).toMatch(/create policy import_batches_clinic_select on patient_import_batches for select to authenticated using \(clinic_id = \(auth\.jwt\(\) -> 'app_metadata' ->> 'clinic_id'\)::uuid\)/)
  expect(code).not.toMatch(/on patient_import_batches for (insert|update|delete|all)/)
  expect(code).not.toMatch(/user_metadata/)
})

it('patients.import_batch_id references the batch', () => {
  expect(code).toMatch(/add column if not exists import_batch_id uuid references patient_import_batches\(batch_id\)/)
})

it('import_patient_batch: one function (one transaction), complete, csv_import, texts off, service role only', () => {
  const fn = code.slice(code.indexOf('create or replace function import_patient_batch('), code.indexOf('$$;', code.indexOf('create or replace function import_patient_batch(')))
  expect(fn).toContain('insert into patient_import_batches')
  expect(fn).toContain('insert into patients')
  expect(fn).toContain("'complete'")
  expect(fn).toContain("'csv_import'")
  expect(fn).toMatch(/sms_opt_in[^;]*false/)
  expect(fn).toContain('jsonb_array_elements(p_patients)')
  expect(code).toContain('revoke all on function import_patient_batch(uuid, uuid, text, integer, integer, integer, jsonb) from public, anon, authenticated')
  expect(code).toContain('grant execute on function import_patient_batch(uuid, uuid, text, integer, integer, integer, jsonb) to service_role')
})

it('ends with apply_pharmacy_admin_scope() before COMMIT', () => {
  expect(code).toMatch(/select apply_pharmacy_admin_scope\(\); commit;\s*$/)
})

it('the down migration refuses while imported or email-only patients exist, then reverses everything', () => {
  expect(down).toMatch(/raise exception/)
  expect(down).toContain("source = 'csv_import'")
  expect(down).toContain('phone is null')
  expect(down).toContain('drop function if exists import_patient_batch')
  expect(down).toContain('drop column if exists import_batch_id')
  expect(down).toContain('drop table if exists patient_import_batches')
  expect(down).toMatch(/alter column phone set not null/)
  expect(down).toMatch(/check \(source in \('staff', ?'self_intake', ?'import', ?'ehr'\)\)/)
})
