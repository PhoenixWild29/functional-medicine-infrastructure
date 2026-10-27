// Runs 2026-10-25-test-data-candidates.sql on the seed plus one unmatched
// look-alike login (beta-test-provider3@): it must be listed with
// matched_by_cleanup = false, everything the cleanup matches with true, and
// nothing may change (the query runs in a READ ONLY transaction).
// Usage: node candidates.mjs <migrated-db-dir> <scratch-copy-dir> <candidates.sql>
import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { cpSync, readFileSync, rmSync } from 'node:fs'
const [base, work, file] = process.argv.slice(2)
rmSync(work, { recursive: true, force: true }); cpSync(base, work, { recursive: true })
const db = new PGlite(work, { extensions: { pg_trgm, pgcrypto } })
await db.exec(readFileSync(new URL('./seed.sql', import.meta.url), 'utf8'))
await db.exec(`INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES (gen_random_uuid(), 'beta-test-provider3@sunrise-clinic.com', '{}')`)
const before = (await db.query('SELECT count(*) n FROM auth.users')).rows[0].n
const res = await db.exec(readFileSync(file, 'utf8'))
for (const r of res.find(r => r.fields.length).rows) console.log(r.matched_by_cleanup, r.kind, r.value)
console.log('users before/after', before, (await db.query('SELECT count(*) n FROM auth.users')).rows[0].n)
try { await db.exec(`BEGIN TRANSACTION READ ONLY; DELETE FROM clinics WHERE false; ROLLBACK;`) } catch (e) { console.log('read-only check:', e.message); await db.exec('ROLLBACK') }
