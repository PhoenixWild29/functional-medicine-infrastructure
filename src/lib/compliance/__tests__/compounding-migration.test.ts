/**
 * @jest-environment node
 *
 * Compliance C8 migration (20261012000001). No Postgres runner here (see
 * f3-rls-filter.test.ts): this pins what the SQL must say. The owner runs
 * it on prod before merge.
 *
 *   - ingredients: compounding_status (default unverified, the agreed
 *     values), commercial_equivalent, on_fda_shortage, source, reviewed
 *     at / by; source and reviewed_at set together;
 *   - ingredient_compounding_history: append-only, written by a trigger on
 *     every change to those fields; ops reads it, nobody edits it;
 *   - clinical_difference, diagnosis_code and diagnosis_text frozen at
 *     signing, and the down file restores the previous function exactly;
 *   - the demo statuses match src/lib/compliance/demo-compounding.ts, are
 *     marked "demo data, not verified", and never overwrite a reviewed row.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEMO_COMPOUNDING, DEMO_COMPOUNDING_SOURCE } from '../demo-compounding'
import { COMPOUNDING_STATUSES } from '../compounding'

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations')
// Line endings depend on the checkout (CRLF on Windows): compare text only.
const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8').replace(/\r\n/g, '\n') : '')
const sql = read(join(MIGRATIONS, '20261012000001_compounding_status.sql'))
const down = read(join(MIGRATIONS, 'down', '20261012000001_down.sql'))
const previous = read(join(MIGRATIONS, '20261006000001_patient_consent_intake_foundations.sql'))
const flat = (t: string) => t.replace(/--.*$/gm, '').replace(/\s+/g, ' ').toLowerCase()
const code = flat(sql)

function lockFunction(text: string): string {
  const start = text.indexOf('CREATE OR REPLACE FUNCTION prevent_snapshot_mutation()')
  return start < 0 ? '' : text.slice(start, text.indexOf('$$ LANGUAGE plpgsql;', start) + '$$ LANGUAGE plpgsql;'.length)
}

it('the migration and its down file exist, each in one transaction', () => {
  expect(sql).not.toBe('')
  expect(down).not.toBe('')
  for (const c of [code, flat(down)]) {
    expect(c).toMatch(/^\s*begin;/)
    expect(c).toMatch(/commit;\s*$/)
  }
})

describe('ingredients', () => {
  it('adds the compounding fields; unverified by default', () => {
    expect(code).toContain("add column if not exists compounding_status text not null default 'unverified'")
    expect(code).toContain('add column if not exists commercial_equivalent boolean not null default false')
    expect(code).toContain('add column if not exists on_fda_shortage boolean not null default false')
    expect(code).toContain('add column if not exists compounding_status_source text')
    expect(code).toContain('add column if not exists compounding_status_reviewed_at timestamptz')
    expect(code).toContain('add column if not exists compounding_status_reviewed_by uuid')
  })

  it('the status check lists exactly the app statuses', () => {
    const m = code.match(/check \(compounding_status in \(([^)]*)\)\)/)
    expect(m).not.toBeNull()
    expect(m![1]!.split(',').map(s => s.trim().replace(/'/g, ''))).toEqual([...COMPOUNDING_STATUSES])
  })

  it('a source comes with a review time, and is a real citation', () => {
    expect(code).toContain('check ((compounding_status_source is null) = (compounding_status_reviewed_at is null))')
    expect(code).toContain('check (compounding_status_source is null or length(btrim(compounding_status_source)) between 3 and 300)')
  })
})

describe('the audit log', () => {
  it('is append-only: privileges revoked and a trigger refuses update, delete and truncate', () => {
    expect(code).toContain('create table if not exists ingredient_compounding_history')
    expect(code).toContain('revoke insert, update, delete, truncate on ingredient_compounding_history from anon, authenticated;')
    expect(code).toContain('revoke update, delete, truncate on ingredient_compounding_history from service_role;')
    expect(code).toContain('before update or delete on ingredient_compounding_history')
    expect(code).toContain('before truncate on ingredient_compounding_history')
  })

  it('only ops reads it', () => {
    expect(code).toContain('alter table ingredient_compounding_history enable row level security;')
    expect(code).toContain("for select to authenticated using ((auth.jwt() -> 'user_metadata' ->> 'app_role') = 'ops_admin')")
    expect(code.match(/create policy \w+ on ingredient_compounding_history/g)).toHaveLength(1)
  })

  it('a trigger on ingredients records every change to the compounding fields, with who and the source', () => {
    expect(code).toContain('after insert or update on ingredients for each row execute function log_ingredient_compounding_change()')
    for (const f of ['compounding_status', 'commercial_equivalent', 'on_fda_shortage', 'compounding_status_source', 'compounding_status_reviewed_at', 'compounding_status_reviewed_by']) {
      expect(code).toContain(`new.${f} is distinct from old.${f}`)
    }
    expect(code).toContain('new.compounding_status_reviewed_by, new.compounding_status_source, old.compounding_status, new.compounding_status')
  })
})

describe('frozen at signing', () => {
  it('clinical_difference, diagnosis_code and diagnosis_text join the locked fields', () => {
    const fn = flat(lockFunction(sql))
    for (const f of ['clinical_difference', 'diagnosis_code', 'diagnosis_text']) {
      expect(fn).toContain(`new.${f} is distinct from old.${f}`)
    }
  })

  it('everything locked before is still locked', () => {
    const before = flat(lockFunction(previous)).match(/new\.(\w+) is distinct/g)!
    const after = flat(lockFunction(sql))
    for (const f of before) expect(after).toContain(f)
  })

  it('the down file restores the previous function exactly', () => {
    expect(lockFunction(down)).toBe(lockFunction(previous))
  })
})

describe('demo statuses', () => {
  const values = [...sql.matchAll(/\('([^']+)',\s*'([a-z_0-9]+)',\s*(true|false)\)/g)].map(m => [m[1], m[2], m[3] === 'true'])

  it('match demo-compounding.ts exactly', () => {
    expect(values).toEqual(DEMO_COMPOUNDING.map(d => [d.name, d.status, d.commercialEquivalent]))
  })

  it('peptides in regulatory limbo are pending_evaluation (blocked); BPC-157 among them', () => {
    const pending = DEMO_COMPOUNDING.filter(d => d.status === 'pending_evaluation').map(d => d.name)
    for (const p of ['BPC-157', 'TB-500', 'MOTS-c', 'DSIP', 'GHK-Cu', 'KPV', 'Epitalon', 'Semax']) expect(pending).toContain(p)
  })

  it('GLP-1s, testosterone, ketamine, naltrexone, progesterone, DHEA, methylene blue: commercial equivalent, not on shortage', () => {
    const ce = DEMO_COMPOUNDING.filter(d => d.commercialEquivalent).map(d => d.name)
    for (const n of ['Semaglutide', 'Tirzepatide', 'Testosterone', 'Ketamine', 'Naltrexone', 'Progesterone', 'DHEA', 'Methylene Blue']) expect(ce).toContain(n)
    expect(code).toContain('on_fda_shortage = false')
  })

  it('are marked demo data, and never overwrite a reviewed row', () => {
    expect(DEMO_COMPOUNDING_SOURCE).toBe('demo data, not verified')
    expect(code).toContain(`compounding_status_source = '${DEMO_COMPOUNDING_SOURCE}'`)
    expect(code).toContain("and i.compounding_status = 'unverified' and i.compounding_status_source is null")
  })
})

it('the down file drops the trigger, the audit table and the columns', () => {
  const d = flat(down)
  expect(d).toContain('drop trigger if exists log_ingredient_compounding_change on ingredients')
  expect(d).toContain('drop table if exists ingredient_compounding_history')
  for (const c of ['compounding_status_reviewed_by', 'compounding_status_reviewed_at', 'compounding_status_source', 'on_fda_shortage', 'commercial_equivalent', 'compounding_status']) {
    expect(d).toContain(`drop column if exists ${c}`)
  }
})
