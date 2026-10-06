/**
 * @jest-environment node
 *
 * Compliance C1 + Patient Intake v1.1, PR 1: the one migration.
 *
 * There is no Postgres runner in this repo (see f3-rls-filter.test.ts),
 * so this pins what the SQL must say. The owner runs it on prod after
 * merge; anything it gets wrong is wrong there.
 *
 *   - patients: sex, phone_e164, source, external_id, intake_status and
 *     the SMS consent record (when, how, which consent text);
 *   - sms_opt_in defaults to FALSE for new rows, and no existing row's
 *     opt-in is changed;
 *   - phone_e164 is backfilled from phone where it parses;
 *   - no duplicate patients from one source: unique (clinic_id, source,
 *     external_id) where external_id is set; a lookup index on (clinic_id,
 *     phone_e164, date_of_birth) for the duplicate check;
 *   - the patients INSERT policy reads the clinic from user_metadata, the
 *     same path SELECT and UPDATE use since 20260329000002;
 *   - orders: the full shipping address frozen at signing, and protected
 *     by the snapshot trigger once the order is locked;
 *   - sms_log can record a send that was refused (no Twilio SID);
 *   - payment texts carry no clinic name (it can name a specialty).
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations')
const FILE = '20261006000001_patient_consent_intake_foundations.sql'
const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '')
const sql = read(join(MIGRATIONS, FILE))
const down = read(join(MIGRATIONS, 'down', '20261006000001_down.sql'))
/** The SQL without comments, whitespace collapsed, lower case. */
const code = sql.replace(/--.*$/gm, '').replace(/\s+/g, ' ').toLowerCase()

describe('the migration file', () => {
  it('exists, with a down migration, and runs in one transaction', () => {
    expect(sql).not.toBe('')
    expect(down).not.toBe('')
    expect(code).toMatch(/^\s*begin;/)
    expect(code).toMatch(/commit;\s*$/)
  })
})

describe('patients', () => {
  it('gains sex (female | male | unknown, nullable)', () => {
    expect(code).toMatch(/add column if not exists sex text check \(sex in \('female', ?'male', ?'unknown'\)\)/)
    expect(code).not.toMatch(/add column if not exists sex text not null/)
  })

  it('gains phone_e164, constrained to E.164', () => {
    expect(code).toMatch(/add column if not exists phone_e164 text/)
    expect(code).toContain("phone_e164 ~ '^\\+[1-9][0-9]{7,14}$'")
  })

  it('gains source (staff | self_intake | import | ehr, default staff) and external_id', () => {
    expect(code).toMatch(/add column if not exists source text not null default 'staff' check \(source in \('staff', ?'self_intake', ?'import', ?'ehr'\)\)/)
    expect(code).toMatch(/add column if not exists external_id text/)
  })

  it('gains intake_status (pending | complete), complete for existing rows', () => {
    expect(code).toMatch(/add column if not exists intake_status text not null default 'complete' check \(intake_status in \('pending', ?'complete'\)\)/)
  })

  it('gains the SMS consent record', () => {
    expect(code).toMatch(/add column if not exists sms_consent_at timestamptz/)
    expect(code).toMatch(/add column if not exists sms_consent_source text/)
    expect(code).toMatch(/add column if not exists sms_consent_text_version text/)
  })

  it('sms_opt_in defaults to false, and no existing row is changed', () => {
    expect(code).toMatch(/alter table patients alter column sms_opt_in set default false/)
    expect(code).not.toMatch(/update patients set[^;]*sms_opt_in/)
    expect(code).not.toMatch(/set sms_opt_in/)
  })

  it('backfills phone_e164 from phone where it parses: +digits, 10-digit US, 11-digit US with a 1', () => {
    expect(code).toMatch(/update patients[^;]*set phone_e164/)
    expect(code).toContain("'+1' || ")
    expect(code).toMatch(/where[^;]*phone_e164 is null/)
  })

  it('the backfill does not touch updated_at (the trigger is paused around it)', () => {
    const off = code.indexOf('disable trigger set_updated_at_patients')
    const backfill = code.search(/update patients[^;]*set phone_e164/)
    const on = code.indexOf('enable trigger set_updated_at_patients')
    expect(off).toBeGreaterThan(-1)
    expect(off).toBeLessThan(backfill)
    expect(on).toBeGreaterThan(backfill)
  })

  it('duplicates: unique (clinic_id, source, external_id) where external_id is set', () => {
    expect(code).toMatch(/create unique index if not exists \w+ on patients \(clinic_id, source, external_id\) where external_id is not null/)
  })

  it('duplicates: a lookup index on (clinic_id, phone_e164, date_of_birth), not unique', () => {
    expect(code).toMatch(/create index if not exists \w+ on patients \(clinic_id, phone_e164, date_of_birth\)/)
    expect(code).not.toMatch(/create unique index if not exists \w+ on patients \(clinic_id, phone_e164/)
  })

  it('a STOP reply finds the patient by phone: an index on phone_e164', () => {
    expect(code).toMatch(/create index if not exists \w+ on patients \(phone_e164\)/)
  })

  it('the INSERT policy reads the clinic from user_metadata, like SELECT and UPDATE', () => {
    expect(code).toMatch(/drop policy if exists patients_clinic_user_insert on patients/)
    expect(code).toContain(
      "create policy patients_clinic_user_insert on patients for insert to authenticated with check (clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::uuid)",
    )
  })
})

describe('orders: the shipping address, frozen at signing', () => {
  it('gains line 1, line 2, city and zip (the state is shipping_state_snapshot) and when it was taken', () => {
    for (const col of ['shipping_address_line1_snapshot', 'shipping_address_line2_snapshot', 'shipping_city_snapshot', 'shipping_zip_snapshot']) {
      expect(code).toMatch(new RegExp(`add column if not exists ${col} text`))
    }
    expect(code).toMatch(/add column if not exists shipping_address_snapshot_at timestamptz/)
  })

  it('the snapshot trigger protects them once the order is locked', () => {
    const fn = code.slice(code.indexOf('create or replace function prevent_snapshot_mutation()'))
    for (const col of ['shipping_address_line1_snapshot', 'shipping_address_line2_snapshot', 'shipping_city_snapshot', 'shipping_zip_snapshot', 'shipping_address_snapshot_at', 'shipping_state_snapshot', 'locked_at']) {
      expect(fn).toContain(`new.${col} is distinct from old.${col}`)
    }
  })
})

describe('sms_log: a refused send is recorded', () => {
  it('a row with no Twilio SID and status suppressed is allowed', () => {
    expect(code).toMatch(/alter table sms_log alter column twilio_message_sid drop not null/)
    expect(code).toMatch(/check \(status in \('queued', ?'sent', ?'delivered', ?'failed', ?'undelivered', ?'suppressed'\)\)/)
  })
})

describe('payment texts carry no PHI', () => {
  it('payment_link and both reminders are rewritten without the clinic name', () => {
    for (const name of ['payment_link', 'reminder_24h', 'reminder_48h']) {
      expect(code).toContain(`'${name}'`)
    }
    const updates = code.slice(code.indexOf('sms_templates'))
    expect(updates).not.toContain('{{clinicname}}')
  })
})

describe('the down migration', () => {
  it('drops what the up migration added and restores the old INSERT policy and default', () => {
    const d = down.replace(/--.*$/gm, '').replace(/\s+/g, ' ').toLowerCase()
    expect(d).toMatch(/alter table patients alter column sms_opt_in set default true/)
    expect(d).toContain("with check (clinic_id = (auth.jwt() ->> 'clinic_id')::uuid)")
    for (const col of ['sex', 'phone_e164', 'source', 'external_id', 'intake_status', 'sms_consent_at', 'sms_consent_source', 'sms_consent_text_version']) {
      expect(d).toContain(`drop column if exists ${col}`)
    }
    expect(d).toContain('drop column if exists shipping_address_snapshot_at')
  })
})
