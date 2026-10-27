// Copy the migrated database, seed it, run the cleanup script twice and
// check Sunrise / demo rows are byte-for-byte unchanged.
// Usage: node run.mjs <migrated-db-dir> <scratch-copy-dir> <cleanup.sql>
import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { cpSync, readFileSync, rmSync } from 'node:fs'

const [base, work, script] = process.argv.slice(2)
rmSync(work, { recursive: true, force: true })
cpSync(base, work, { recursive: true })
const db = new PGlite(work, { extensions: { pg_trgm, pgcrypto } })
try { await db.exec(readFileSync(new URL('./seed.sql', import.meta.url), 'utf8')) } catch (e) { console.log('SEED ERROR: ' + e.message + (e.detail ? ' | ' + e.detail : '')); process.exit(1) }
console.log('seeded')

// Fingerprint of everything that must survive: every row of every public
// table except those the script may touch for test rows, plus the demo
// users, Sunrise rows and the kept logs.
const fingerprint = async () => {
  const { rows } = await db.query(`
    SELECT 'clinics' t, md5(string_agg(c::text, '|' ORDER BY c::text)) h FROM clinics c WHERE clinic_id::text LIKE 'a1000000-%'
    UNION ALL SELECT 'pharmacies', md5(string_agg(p::text, '|' ORDER BY p::text)) FROM pharmacies p WHERE pharmacy_id::text LIKE 'a4000000-%'
    UNION ALL SELECT 'demo users', md5(string_agg(u.id::text || u.email, '|' ORDER BY u.id)) FROM auth.users u WHERE u.id::text LIKE 'a0000000-%'
    UNION ALL SELECT 'demo identities+sessions', md5(coalesce((SELECT string_agg(id::text, '|' ORDER BY id) FROM auth.identities WHERE user_id::text LIKE 'a0000000-%'), '') || coalesce((SELECT string_agg(id::text, '|' ORDER BY id) FROM auth.sessions WHERE user_id::text LIKE 'a0000000-%'), ''))
    UNION ALL SELECT 'providers', md5(string_agg(p::text, '|' ORDER BY p::text)) FROM providers p WHERE clinic_id::text LIKE 'a1000000-%'
    UNION ALL SELECT 'provider licenses', md5(string_agg(l::text, '|' ORDER BY l::text)) FROM provider_state_licenses l WHERE provider_id::text LIKE 'a2000000-%'
    UNION ALL SELECT 'demo patient Alex', md5(p::text) FROM patients p WHERE patient_id = 'a3000000-0000-0000-0000-000000000001'
    UNION ALL SELECT 'demo orders', md5(string_agg(o::text, '|' ORDER BY o::text)) FROM orders o WHERE order_id::text LIKE 'd1000000-%'
    UNION ALL SELECT 'demo order history', md5(string_agg(h::text, '|' ORDER BY h::text)) FROM order_status_history h WHERE order_id::text LIKE 'd1000000-%'
    UNION ALL SELECT 'demo submissions', md5(string_agg(s::text, '|' ORDER BY s::text)) FROM adapter_submissions s WHERE order_id::text LIKE 'd1000000-%'
    UNION ALL SELECT 'demo ledger', md5(string_agg(l::text, '|' ORDER BY l::text)) FROM ledger_entries l WHERE order_id::text LIKE 'd1000000-%'
    UNION ALL SELECT 'demo payables', md5(string_agg(p::text, '|' ORDER BY p::text)) FROM pharmacy_payables p WHERE order_id::text LIKE 'd1000000-%'
    UNION ALL SELECT 'demo payable events', md5(string_agg(e::text, '|' ORDER BY e::text)) FROM payable_events e WHERE payable_id::text LIKE 'd1000000-%'
    UNION ALL SELECT 'sunrise agreements', md5(string_agg(a::text, '|' ORDER BY a::text)) FROM agreement_acceptances a WHERE clinic_id::text LIKE 'a1000000-%'
    UNION ALL SELECT 'sunrise/demo onboarding events', md5(string_agg(e::text, '|' ORDER BY e::text)) FROM clinic_onboarding_events e WHERE clinic_id::text LIKE 'a1000000-%'
    UNION ALL SELECT 'sunrise demo invites', md5(string_agg(i::text, '|' ORDER BY i::text)) FROM onboarding_invites i WHERE clinic_id::text LIKE 'a1000000-%' AND email = 'ma@sunrise-clinic.com'
    UNION ALL SELECT 'demo proposal, options, choice items, events', md5(
      coalesce((SELECT string_agg(p::text, '|' ORDER BY p::text) FROM treatment_proposals p WHERE proposal_id::text LIKE 'd1000000-%'), '') ||
      coalesce((SELECT string_agg(o::text, '|' ORDER BY o::text) FROM treatment_proposal_options o WHERE proposal_id::text LIKE 'd1000000-%'), '') ||
      coalesce((SELECT string_agg(i::text, '|' ORDER BY i::text) FROM proposal_choice_items i WHERE proposal_id::text LIKE 'd1000000-%'), '') ||
      coalesce((SELECT string_agg(e.event || e.actor || e.created_at::text, '|' ORDER BY e.event) FROM treatment_proposal_events e WHERE proposal_id::text LIKE 'd1000000-%'), ''))
    UNION ALL SELECT 'sunrise protocol and patient phase', md5((SELECT string_agg(t::text, '|') FROM protocol_templates t WHERE protocol_id::text LIKE 'a1000000-%') || (SELECT string_agg(ph::text, '|') FROM patient_protocol_phases ph WHERE tracking_id::text LIKE 'a1000000-%'))
    UNION ALL SELECT 'phi_access_log', md5(string_agg(l::text, '|' ORDER BY l::text)) FROM phi_access_log l
    UNION ALL SELECT 'demo vault secret', md5(string_agg(s::text, '|' ORDER BY s::text)) FROM vault.secrets s WHERE id::text LIKE 'a0000000-%'
    UNION ALL SELECT 'storage', md5(string_agg(o.bucket_id || o.name, '|' ORDER BY o.bucket_id, o.name)) FROM storage.objects o
    UNION ALL SELECT 'reference data', md5((SELECT string_agg(f::text, '|') FROM formulations f) || (SELECT string_agg(d::text, '|') FROM dosage_forms d))
    ORDER BY 1`)
  return rows
}

const before = await fingerprint()
const sql = readFileSync(script, 'utf8')

for (const run of [1, 2]) {
  let results
  try { results = await db.exec(sql) } catch (e) { console.log('SCRIPT ERROR (run ' + run + '): ' + e.message + (e.detail ? ' | ' + e.detail : '') + (e.where ? ' | ' + e.where : '')); process.exit(1) }
  const selects = results.filter(r => r.fields.length > 0)
  const preview = selects[0].rows
  const report = selects[selects.length - 1].rows
  console.log(`\n===== run ${run}: preview (rows matched)`)
  for (const r of preview) console.log(`  ${String(r.ord).padStart(2)} ${r.item}: ${r.rows_matched}${r.note ? '  [' + String(r.note).slice(0, 140) + ']' : ''}`)
  console.log(`===== run ${run}: verification (after / expected)`)
  let bad = 0
  for (const r of report) {
    const ok = String(r.rows_after) === String(r.expected_after)
    if (!ok) bad++
    console.log(`  ${ok ? 'ok ' : 'BAD'} ${r.item}: ${r.rows_after} / ${r.expected_after}`)
  }
  console.log(`run ${run}: ${bad} mismatches`)
}

const after = await fingerprint()
let changed = 0
for (let i = 0; i < before.length; i++) {
  const same = before[i].h === after[i].h
  if (!same) changed++
  console.log(`${same ? 'unchanged' : 'CHANGED  '} ${before[i].t}`)
}
console.log(`fingerprints: ${changed} changed`)

// Triggers re-enabled.
const { rows: trg } = await db.query(`SELECT c.relname, t.tgname, t.tgenabled FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
  WHERE t.tgname IN ('orders_no_delete_signed','ledger_entries_no_update_delete','payable_events_no_update_delete','trg_agreement_acceptances_append_only','trg_clinic_onboarding_events_append_only','pharmacy_agreement_acceptances_no_update_delete','pharmacy_onboarding_events_no_update_delete','proposal_choice_items_no_update_delete','treatment_proposal_events_no_update_delete')`)
for (const r of trg) console.log(`trigger ${r.relname}.${r.tgname}: ${r.tgenabled === 'O' ? 'enabled' : 'DISABLED'}`)
console.log(`guard triggers: ${trg.filter(r => r.tgenabled === 'O').length} of ${trg.length} enabled (expected 9 of 9)`)
await db.close()
