// Each case: fresh copy of the migrated DB + seed, one dangerous change,
// run the script; it must raise, and nothing may change (the transaction
// rolls back).
import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { cpSync, readFileSync, rmSync } from 'node:fs'

const [base, work, script] = process.argv.slice(2)
const seed = readFileSync(new URL('./seed.sql', import.meta.url), 'utf8')
const sql = readFileSync(script, 'utf8')

const cases = [
  ['Sunrise renamed to a matched name', `UPDATE clinics SET name = 'Beta Test Practice 2' WHERE clinic_id = 'a1000000-0000-0000-0000-000000000001';
    DELETE FROM agreement_acceptances WHERE false;`, /Sunrise or a demo clinic/],
  ['a demo pharmacy named QA Test Pharmacy', `UPDATE pharmacies SET name = 'QA Test Pharmacy' WHERE pharmacy_id = 'a4000000-0000-0000-0000-000000000002'`, /demo pharmacy/],
  ['an ops admin in the QA clinic', `UPDATE auth.users SET raw_app_meta_data = '{"app_role":"ops_admin","clinic_id":"c0000000-0000-4000-8000-0000000000c1"}' WHERE id = 'c0000000-0000-4000-8000-0000000001a1'`, /ops admin/],
  ['a Sunrise demo login in a matched clinic', `UPDATE auth.users SET raw_app_meta_data = '{"app_role":"clinic_admin","clinic_id":"c0000000-0000-4000-8000-0000000000c1"}' WHERE email = 'admin@sunrise-clinic.com'`, /demo login/],
  ['an E2E login that belongs to Sunrise', `UPDATE auth.users SET raw_app_meta_data = '{"app_role":"provider","clinic_id":"a1000000-0000-0000-0000-000000000001"}' WHERE email = 'e2e-1729@example.com'`, /clinic that is not matched/],
  ['the Beta login in a clinic whose name differs', `UPDATE clinics SET name = 'Beta Test Practice LLC' WHERE clinic_id = 'b0000000-0000-4000-8000-0000000000b1'`, /clinic that is not matched/],
  ['a QA pharmacy order for a real Sunrise patient', `INSERT INTO orders (patient_id, provider_id, clinic_id, pharmacy_id, formulation_id, status, quantity) VALUES ('a3000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'e0000000-0000-4000-8000-0000000000e1', 'd0000000-0000-4000-8000-000000000003', 'DRAFT', 1)`, /for a real patient/],
  ['a kept order refilling a test order', `INSERT INTO orders (patient_id, provider_id, clinic_id, pharmacy_id, formulation_id, status, quantity, refill_of_order_id) VALUES ('a3000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000001', 'd0000000-0000-4000-8000-000000000003', 'DRAFT', 1, 'f0000000-0000-4000-8000-0000000004f1')`, /depends on one that goes/],
  ['an EPCS audit row for a test patient', `INSERT INTO epcs_audit_log (provider_id, patient_id, event_type, dea_schedule, medication_name) VALUES ('a2000000-0000-0000-0000-000000000001', 'f0000000-0000-4000-8000-0000000001f1', 'PRESCRIPTION_CREATED', 2, 'x')`, /EPCS audit/],
  ['an active legal hold on the QA clinic', `INSERT INTO legal_holds (scope, target_id, reason, set_by) VALUES ('clinic', 'c0000000-0000-4000-8000-0000000000c1', 'litigation', 'ops')`, /legal hold/],
  ['two Sunrise patients named QAImport Alpha', `INSERT INTO patients (clinic_id, first_name, last_name, date_of_birth, phone, phone_e164) VALUES ('a1000000-0000-0000-0000-000000000001', 'QAImport', 'Alpha', '1970-02-02', '+15125550499', '+15125550499')`, /more than one match for Sunrise test patient QAImport Alpha/],
  ['more logins than expected', `INSERT INTO auth.users (id, email, raw_app_meta_data) SELECT gen_random_uuid(), 'qa' || g || '@qaclinic.example.org', '{"app_role":"provider","clinic_id":"c0000000-0000-4000-8000-0000000000c1"}' FROM generate_series(1, 40) g`, /matched logins \(expected at most 40\)/],
]

const snapshot = async db => (await db.query(`
  SELECT (SELECT count(*) FROM clinics) c, (SELECT count(*) FROM patients) p, (SELECT count(*) FROM orders) o,
         (SELECT count(*) FROM auth.users) u, (SELECT count(*) FROM agreement_acceptances) a, (SELECT count(*) FROM vault.secrets) v,
         (SELECT string_agg(tgenabled::text, '') FROM pg_trigger WHERE tgname IN ('orders_no_delete_signed','ledger_entries_no_update_delete','trg_agreement_acceptances_append_only')) t`)).rows[0]

let failures = 0
for (const [name, change, expected] of cases) {
  rmSync(work, { recursive: true, force: true })
  cpSync(base, work, { recursive: true })
  const db = new PGlite(work, { extensions: { pg_trgm, pgcrypto } })
  await db.exec(seed)
  await db.exec(change)
  const before = JSON.stringify(await snapshot(db))
  let message = null
  try { await db.exec(sql) } catch (e) { message = e.message; await db.exec('ROLLBACK') }
  const after = JSON.stringify(await snapshot(db))
  const ok = message !== null && expected.test(message) && before === after
  if (!ok) failures++
  console.log(`${ok ? 'refused ' : 'FAILED  '} ${name}: ${message ?? 'no error'}${before === after ? '' : ' | DATA CHANGED'}`)
  await db.close()
}
console.log(`${cases.length} refusal cases, ${failures} failed`)
