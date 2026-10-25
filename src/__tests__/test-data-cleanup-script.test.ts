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
 *   - it refuses Sunrise, the demo rows and anything over its limits;
 *   - test proposals (#268) go whole, and nothing that stays may point at one.
 * The read-only candidates query (2026-10-25-test-data-candidates.sql) is
 * pinned too: it may never write.
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
  expect(disabled.length).toBe(9)
  expect(disabled).toEqual(expect.arrayContaining([
    'proposal_choice_items.proposal_choice_items_no_update_delete',
    'treatment_proposal_events.treatment_proposal_events_no_update_delete',
  ]))
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
    'a matched proposal is for a patient that stays',
    'an order that stays belongs to a matched proposal',
    'an order that goes belongs to a proposal that stays',
    'a proposal that stays chose an order or option that goes',
    'protocol phase(s) of patients that stay use a removed protocol or provider',
    'matched % (expected at most %)',
  ]) expect(code).toContain(reason)
  // The refusals run before anything is deleted.
  expect(code.indexOf('refused: a matched clinic is Sunrise')).toBeLessThan(code.indexOf('DISABLE TRIGGER'))
})

it('removes test proposals whole, in FK order, and only matched ones', () => {
  const flat = code.replace(/\s+/g, ' ')
  expect(flat).toMatch(/INSERT INTO m_proposal SELECT proposal_id FROM treatment_proposals WHERE clinic_id IN \(SELECT clinic_id FROM m_clinic\) OR patient_id IN \(SELECT patient_id FROM m_patient\) OR provider_id IN \(SELECT provider_id FROM m_provider\)/)
  const at = (needle: string) => {
    const i = flat.indexOf(needle)
    expect({ needle, found: i > -1 }).toEqual({ needle, found: true })
    return i
  }
  const items = at('DELETE FROM proposal_choice_items WHERE proposal_id IN (SELECT proposal_id FROM m_proposal)')
  const events = at('DELETE FROM treatment_proposal_events WHERE proposal_id IN (SELECT proposal_id FROM m_proposal)')
  const orders = at('DELETE FROM orders WHERE order_id IN (SELECT order_id FROM m_order)')
  const options = at('DELETE FROM treatment_proposal_options WHERE option_id IN (SELECT option_id FROM m_option)')
  const proposals = at('DELETE FROM treatment_proposals WHERE proposal_id IN (SELECT proposal_id FROM m_proposal)')
  const patients = at('DELETE FROM patients WHERE patient_id IN (SELECT patient_id FROM m_patient)')
  // Choice items and events reference orders and options; orders reference
  // options; proposals reference patients.
  expect(items).toBeLessThan(orders)
  expect(events).toBeLessThan(options)
  expect(orders).toBeLessThan(options)
  expect(options).toBeLessThan(proposals)
  expect(proposals).toBeLessThan(patients)
  expect(code).toMatch(/\('proposals', \d+\)/)
})

it('the candidates query is read only', () => {
  const cand = readFileSync(join(process.cwd(), 'scripts', 'cleanup', '2026-10-25-test-data-candidates.sql'), 'utf8')
    .replace(/\r\n/g, '\n').replace(/--.*$/gm, '')
  const parts = cand.split(';').map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean)
  expect(parts[0]).toBe('BEGIN TRANSACTION READ ONLY')
  expect(parts[parts.length - 1]).toBe('ROLLBACK')
  expect(parts).toHaveLength(3)
  expect(parts[1]).toMatch(/^WITH /)
  expect(cand).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|GRANT|CREATE|COMMIT)\b/i)
})
