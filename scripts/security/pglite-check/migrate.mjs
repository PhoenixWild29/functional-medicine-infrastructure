// Apply every repo migration to a fresh PGlite (on disk, so later scripts reuse it).
import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const repo = process.argv[2]
const dataDir = process.argv[3]
rmSync(dataDir, { recursive: true, force: true })
const db = new PGlite(dataDir, { extensions: { pg_trgm, pgcrypto } })
await db.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;')
await db.exec(readFileSync(new URL('./bootstrap.sql', import.meta.url), 'utf8'))

const dir = join(repo, 'supabase', 'migrations')
const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
let failed = 0
for (const f of files) {
  let sql = readFileSync(join(dir, f), 'utf8')
  sql = sql.replace(/CREATE EXTENSION IF NOT EXISTS supabase_vault[^;]*;/gi, '-- (vault stubbed)')
  try {
    await db.exec(sql)
    console.log('ok  ', f)
  } catch (e) {
    failed++
    console.log('FAIL', f, '::', e.message)
    try { await db.exec('ROLLBACK') } catch { /* not in a transaction */ }
  }
}
console.log(`${files.length} migrations, ${failed} failed`)
await db.close()
