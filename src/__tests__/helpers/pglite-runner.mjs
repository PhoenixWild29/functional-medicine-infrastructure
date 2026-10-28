// ============================================================
// PGlite runner: every repo migration, then a plan of steps
// ============================================================
//
// Run by src/__tests__/helpers/pglite-migrated.ts in a child Node process
// (PGlite loads its WebAssembly with dynamic import(), which jest's
// CommonJS runtime refuses). Reads a JSON plan on stdin, prints one JSON
// line of results on stdout.
//
// A step runs in its own transaction:
//   { id, sql, persist: true }        as the owner, committed (seed, switch flips)
//   { id, sql, claims, pre? }         `pre` as the owner, then SET LOCAL ROLE
//                                     authenticated with these JWT claims (as
//                                     PostgREST does), then sql; rolled back
//   { id, sql, role, pre? }           the same as another role (service_role)
// Each result is { id, rows } or { id, error }.
//
// Test-only: an in-memory database, nothing else is touched.

import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const plan = JSON.parse(readFileSync(0, 'utf8'))

const db = new PGlite({ extensions: { pg_trgm, pgcrypto } })
await db.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;')
await db.exec(readFileSync(join(root, 'src', '__tests__', 'fixtures', 'pglite-bootstrap.sql'), 'utf8'))
const dir = join(root, 'supabase', 'migrations')
for (const file of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
  // The vault extension is stubbed by the bootstrap (PGlite has none).
  const sql = readFileSync(join(dir, file), 'utf8').replace(/CREATE EXTENSION IF NOT EXISTS supabase_vault[^;]*;/gi, '-- (vault stubbed)')
  try {
    await db.exec(sql)
  } catch (err) {
    process.stdout.write(JSON.stringify({ migrationError: `${file}: ${err.message}` }) + '\n')
    process.exit(0)
  }
}

const results = []
for (const step of plan.steps) {
  await db.exec('BEGIN')
  try {
    if (step.pre) await db.exec(step.pre)
    if (step.claims) {
      await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(step.claims)])
      await db.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [String(step.claims.sub ?? '')])
      await db.exec('SET LOCAL ROLE authenticated')
    } else if (step.role) {
      await db.exec(`SET LOCAL ROLE ${step.role}`)
    }
    // exec runs several statements; the step's rows are the last one's.
    const out = await db.exec(step.sql)
    results.push({ id: step.id, rows: out.length ? out[out.length - 1].rows : [] })
    await db.exec(step.persist ? 'COMMIT' : 'ROLLBACK')
  } catch (err) {
    results.push({ id: step.id, error: err.message })
    await db.exec('ROLLBACK').catch(() => {})
  }
}
await db.close()
process.stdout.write(JSON.stringify({ results }) + '\n')
