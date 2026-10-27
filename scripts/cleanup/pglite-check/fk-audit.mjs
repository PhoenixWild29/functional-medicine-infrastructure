// Every foreign key that points at a table the cleanup script deletes from,
// and how each is handled. A row that stays and references a deleted row
// would make a DELETE fail (or lose its link silently), so each FK must be:
//   - from a table the script also deletes from (children first), or
//   - ON DELETE CASCADE / SET NULL (the database handles it), or
//   - from a table the script UPDATEs to clear the link, or
//   - from a table the refusal section reads (the script refuses to run
//     when such a row points at matched data: EPCS audit, protocol phases).
// Anything else is printed as UNHANDLED. A NO ACTION key that is missed
// cannot damage kept rows (the DELETE fails and the transaction rolls
// back); CASCADE and SET NULL keys can, so the report lists them too.
// Usage: node fk-audit.mjs <migrated-db-dir> <scratch-copy-dir> <cleanup.sql>
import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { cpSync, readFileSync, rmSync } from 'node:fs'

const [base, work, script] = process.argv.slice(2)
rmSync(work, { recursive: true, force: true })
cpSync(base, work, { recursive: true })
const db = new PGlite(work, { extensions: { pg_trgm, pgcrypto } })

const code = readFileSync(script, 'utf8').replace(/--.*$/gm, '')
const qualify = t => (t.includes('.') ? t : `public.${t}`)
const deleted = new Set([...code.matchAll(/DELETE FROM ([a-z_.]+)/gi)].map(m => qualify(m[1])))
const updated = new Set([...code.matchAll(/UPDATE ([a-z_.]+) SET/gi)].map(m => qualify(m[1])))
const refusals = code.slice(code.indexOf('DO $$'), code.indexOf('END $$'))
const refused = new Set([...refusals.matchAll(/FROM ([a-z_.]+)/gi)].map(m => qualify(m[1])))

const { rows } = await db.query(`
  SELECT c.conname,
         cn.nspname || '.' || cl.relname   AS from_table,
         fn.nspname || '.' || fl.relname   AS to_table,
         c.confdeltype,
         (SELECT string_agg(a.attname, ', ') FROM unnest(c.conkey) k JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k) AS cols
  FROM pg_constraint c
  JOIN pg_class cl ON cl.oid = c.conrelid JOIN pg_namespace cn ON cn.oid = cl.relnamespace
  JOIN pg_class fl ON fl.oid = c.confrelid JOIN pg_namespace fn ON fn.oid = fl.relnamespace
  WHERE c.contype = 'f'
  ORDER BY 3, 2, 1`)

const action = { a: 'NO ACTION', r: 'RESTRICT', c: 'CASCADE', n: 'SET NULL', d: 'SET DEFAULT' }
let unhandled = 0
let relevant = 0
for (const r of rows) {
  if (!deleted.has(r.to_table)) continue
  relevant++
  let how
  if (deleted.has(r.from_table)) how = 'deleted by the script'
  else if (r.confdeltype === 'c') how = 'CASCADE'
  else if (r.confdeltype === 'n') how = 'SET NULL'
  else if (updated.has(r.from_table)) how = 'link cleared by an UPDATE in the script'
  else if (refused.has(r.from_table)) how = 'the script refuses when such a row points at matched data'
  else { how = 'UNHANDLED'; unhandled++ }
  console.log(`${how === 'UNHANDLED' ? 'UNHANDLED' : 'ok       '} ${r.from_table}(${r.cols}) -> ${r.to_table} [${action[r.confdeltype]}]: ${how}`)
}
console.log(`${deleted.size} tables deleted from; ${relevant} foreign keys point at them; ${unhandled} unhandled`)
await db.close()
