// ============================================================
// A Postgres with every repo migration applied, in memory (PGlite)
// ============================================================
//
// For tests that must run real RLS: the policies, functions and grants are
// exactly the migrations' (supabase/migrations, in filename order), on top
// of a minimal Supabase stand-in (src/__tests__/fixtures/pglite-
// bootstrap.sql: roles, auth.jwt(), storage, vault, default grants).
//
// asUser runs a query as the `authenticated` role with the given JWT
// claims, the way PostgREST does (SET LOCAL ROLE + request.jwt.claims), in
// a transaction that is rolled back. Applying the migrations takes a while,
// so build one database per test file (beforeAll).
//
// Test-only: nothing here touches a real database.

import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()

export async function migratedDb(): Promise<PGlite> {
  const db = new PGlite({ extensions: { pg_trgm, pgcrypto } })
  await db.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;')
  await db.exec(readFileSync(join(ROOT, 'src', '__tests__', 'fixtures', 'pglite-bootstrap.sql'), 'utf8'))
  const dir = join(ROOT, 'supabase', 'migrations')
  for (const file of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
    // The vault extension is stubbed by the bootstrap (PGlite has none).
    const sql = readFileSync(join(dir, file), 'utf8').replace(/CREATE EXTENSION IF NOT EXISTS supabase_vault[^;]*;/gi, '-- (vault stubbed)')
    try {
      await db.exec(sql)
    } catch (err) {
      throw new Error(`migration ${file} failed on PGlite: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return db
}

/** Run sql as `authenticated` with these JWT claims, then roll back. */
export async function asUser<T = Record<string, unknown>>(
  db: PGlite,
  claims: Record<string, unknown>,
  sql: string,
): Promise<T[]> {
  await db.exec('BEGIN')
  try {
    await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)])
    await db.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [String(claims['sub'] ?? '')])
    await db.exec('SET LOCAL ROLE authenticated')
    const { rows } = await db.query<T>(sql)
    return rows
  } finally {
    await db.exec('ROLLBACK')
  }
}
