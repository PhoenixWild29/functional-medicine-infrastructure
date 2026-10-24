/**
 * @jest-environment node
 *
 * scripts/cleanup/2026-10-24-test-data-cleanup.sql (Issue Log 95) is run by
 * hand on prod, once, after review. Its behaviour is checked against every
 * migration on PGlite (scripts/cleanup/pglite-check). This pins the safety
 * properties in the text itself, so an edit cannot quietly remove them:
 *   - one transaction, preview before the deletes, verification after;
 *   - every DELETE is limited to the matched rows;
 *   - the append-only compliance logs, legal holds and storage objects are
 *     never deleted;
 *   - every guard trigger it disables is enabled again before COMMIT;
 *   - matching uses exact names and emails, never a pattern on a name;
 *   - it refuses Sunrise, the demo rows and anything over its limits.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const raw = readFileSync(join(process.cwd(), 'scripts', 'cleanup', '2026-10-24-test-data-cleanup.sql'), 'utf8').replace(/\r\n/g, '\n')
const code = raw.replace(/--.*$/gm, '')
const statements = code.split(';').map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean)

it('is one transaction: BEGIN first, COMMIT last', () => {
  expect(statements[0]).toBe('BEGIN')
  expect(statements[statements.length - 1]).toBe('COMMIT')
  expect(statements.filter(s => /^(BEGIN|COMMIT|ROLLBACK)$/i.test(s))).toEqual(['BEGIN', 'COMMIT'])
})

it('previews before the first delete and verifies after the last', () => {
  const firstDelete = statements.findIndex(s => /^(WITH .*\) )?DELETE FROM /i.test(s))
  const lastDelete = statements.length - 1 - [...statements].reverse().findIndex(s => /DELETE FROM /i.test(s))
  const preview = statements.findIndex(s => /^SELECT ord, item, preview AS rows_matched/.test(s))
  const verify = statements.findIndex(s => /^UPDATE cleanup_report r SET after/.test(s))
  expect(preview).toBeGreaterThan(-1)
  expect(preview).toBeLessThan(firstDelete)
  expect(verify).toBeGreaterThan(lastDelete)
  expect(code).toMatch(/RAISE EXCEPTION 'verification failed, nothing kept/)
})

it('every DELETE is limited to the matched rows', () => {
  const deletes = [...code.matchAll(/DELETE FROM ([a-z_.]+)([^;]*?)(?:RETURNING|;)/gi)]
  expect(deletes.length).toBeGreaterThan(40)
  for (const [, table, rest] of deletes) {
    expect({ table, limited: /^\s*WHERE[\s\S]*\(SELECT [a-z_:]+ FROM m_[a-z_]+\)/i.test(rest ?? '') }).toEqual({ table, limited: true })
  }
})

it('never deletes the compliance logs, legal holds or storage objects', () => {
  for (const t of ['phi_access_log', 'epcs_audit_log', 'legal_holds', 'storage.objects', 'retention_runs', 'reconciliation_runs', 'ops_alert_queue', 'auth.audit_log_entries']) {
    expect(code).not.toMatch(new RegExp(`DELETE FROM ${t.replace('.', '\\.')}\\b`, 'i'))
  }
  expect(code).not.toMatch(/TRUNCATE/i)
  expect(code).not.toMatch(/DISABLE TRIGGER (ALL|USER)/i)
  expect(code).not.toMatch(/ALTER TABLE (phi_access_log|epcs_audit_log|legal_holds)/i)
})

it('every guard trigger it disables is enabled again, after the deletes', () => {
  const disabled = [...code.matchAll(/ALTER TABLE (\w+) DISABLE TRIGGER (\w+)/g)].map(m => `${m[1]}.${m[2]}`)
  const enabled = [...code.matchAll(/ALTER TABLE (\w+) ENABLE TRIGGER (\w+)/g)].map(m => `${m[1]}.${m[2]}`)
  expect(disabled.sort()).toEqual(enabled.sort())
  expect(disabled.length).toBe(7)
  expect(code.lastIndexOf('DISABLE TRIGGER')).toBeLessThan(code.indexOf('DELETE FROM sla_notifications_log'))
  expect(code.indexOf('ENABLE TRIGGER')).toBeGreaterThan(code.lastIndexOf('DELETE FROM auth.users'))
})

it('matches by exact names and emails, never a pattern on a name', () => {
  expect(code).not.toMatch(/(name|first_name|last_name|legal_name)\s+(I?LIKE|~)/i)
  expect(code).not.toMatch(/ILIKE/i)
  expect(code).toMatch(/WHERE name IN \('QA Test Clinic', 'Beta Test Practice', 'Beta Test Practice 2'\)/)
  expect(code).toMatch(/WHERE name = 'QA Test Pharmacy'/)
  for (const email of ['beta-test-provider@sunrise-clinic.com', 'beta-test-provider2@sunrise-clinic.com', 'beta-test-ma@sunrise-clinic.com']) {
    expect(code).toContain(`('${email}')`)
  }
})

it('refuses Sunrise, the demo rows, ops admins, demo logins and over-limit matches', () => {
  for (const reason of [
    'a matched clinic is Sunrise or a demo clinic',
    'a matched pharmacy is a demo pharmacy',
    'a matched login is an ops admin',
    'a matched login is a demo login',
    'a matched login belongs to a clinic that is not matched',
    'a matched login belongs to a pharmacy that is not matched',
    'an order to the test pharmacy is for a real patient',
    'an order that stays depends on one that goes',
    'EPCS audit row(s) point at matched rows',
    'active legal hold(s) cover matched rows',
    'more than one match for',
    'matched % (expected at most %)',
  ]) expect(code).toContain(reason)
  // The refusals run before anything is deleted.
  expect(code.indexOf('refused: a matched clinic is Sunrise')).toBeLessThan(code.indexOf('DISABLE TRIGGER'))
})
