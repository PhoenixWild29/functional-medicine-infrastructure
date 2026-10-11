/**
 * @jest-environment node
 *
 * Role and clinic are authorization facts, so they come from app_metadata
 * (writable only with the service role), never from user_metadata (which
 * any signed-in user can rewrite with supabase.auth.updateUser).
 *
 * This guard fails when:
 *   1. any source file under src/, scripts/ or e2e/ reads app_role or
 *      clinic_id from user_metadata, directly or through an alias
 *      (const meta = user.user_metadata; meta['app_role']);
 *   2. any file writes app_role or clinic_id into user_metadata;
 *   3. after replaying every migration in order, any live RLS policy still
 *      reads user_metadata or auth.users.raw_user_meta_data;
 *   4. the migration that moves the claims has no down file.
 *
 * user_metadata stays fine for display data (full_name). Comments are
 * stripped before matching, so explaining the rule does not trip it.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__' || name === '.next') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx|mjs|js)$/.test(name) && !/\.d\.ts$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}

function stripTsComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
}

const SOURCES = ['src', 'scripts', 'e2e']
  .flatMap(d => walk(join(ROOT, d)))
  .filter(f => !/database\.types\.ts$/.test(f))
  .map(f => ({ rel: relative(ROOT, f).replace(/\\/g, '/'), code: stripTsComments(readFileSync(f, 'utf8')) }))

const ROLE_KEYS = '(app_role|clinic_id|pharmacy_id)'

describe('role and clinic never come from user_metadata (source)', () => {
  it('no direct read of app_role / clinic_id from user_metadata', () => {
    const direct = new RegExp(`user_metadata\\s*\\??\\.?\\s*(\\[\\s*['"\`]|\\.)${ROLE_KEYS}`)
    const offenders = SOURCES.filter(f => direct.test(f.code)).map(f => f.rel)
    expect(offenders).toEqual([])
  })

  it('no read through an alias of user_metadata', () => {
    const offenders: string[] = []
    for (const f of SOURCES) {
      const aliases = [...f.code.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*[^;\n]*\buser_metadata\b/g)].map(m => m[1]!)
      for (const a of aliases) {
        const read = new RegExp(`\\b${a.replace(/\$/g, '\\$')}\\s*\\??\\.?\\s*(\\[\\s*['"\`]|\\.)${ROLE_KEYS}`)
        if (read.test(f.code)) offenders.push(`${f.rel} (${a})`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('no write of app_role / clinic_id into user_metadata', () => {
    const literal = new RegExp(`user_metadata\\s*:\\s*\\{[^}]*\\b${ROLE_KEYS}\\b`)
    const offenders = SOURCES
      .filter(f => literal.test(f.code) || /user_metadata\s*:\s*userMetadataFor\b/.test(f.code))
      .map(f => f.rel)
    expect(offenders).toEqual([])
  })
})

// ── SQL: replay every migration, then inspect the live policies ──────

const MIG = join(ROOT, 'supabase', 'migrations')

function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => {
    const i = l.indexOf('--')
    return i < 0 ? l : l.slice(0, i)
  }).join('\n')
}

/** The balanced (...) that follows `keyword`, or undefined. */
function clause(body: string, keyword: RegExp): string | undefined {
  const m = keyword.exec(body)
  if (!m) return undefined
  let i = m.index + m[0].length
  while (i < body.length && body[i] !== '(') i++
  let depth = 0
  const start = i
  for (; i < body.length; i++) {
    if (body[i] === '(') depth++
    else if (body[i] === ')') { depth--; if (depth === 0) return body.slice(start, i + 1) }
  }
  return undefined
}

const NAME = String.raw`("(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_]*)`
const TABLE = String.raw`((?:[A-Za-z_][A-Za-z0-9_]*\.)?[A-Za-z_][A-Za-z0-9_]*)`
const normName = (n: string) => n.startsWith('"') ? n.slice(1, -1).replace(/""/g, '"') : n.toLowerCase()
const normTable = (t: string) => (t.includes('.') ? t : `public.${t}`).toLowerCase()

interface LivePolicy { using?: string | undefined; check?: string | undefined; file: string }

function replay(): Map<string, LivePolicy> {
  const live = new Map<string, LivePolicy>()
  const files = readdirSync(MIG).filter(f => f.endsWith('.sql')).sort()
  for (const file of files) {
    const sql = stripSqlComments(readFileSync(join(MIG, file), 'utf8'))
    for (const raw of sql.split(';')) {
      const s = raw.trim()
      if (!s) continue
      let m = new RegExp(String.raw`^DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?${NAME}\s+ON\s+${TABLE}`, 'is').exec(s)
      if (m) { live.delete(`${normTable(m[2]!)}|${normName(m[1]!)}`); continue }
      m = new RegExp(String.raw`^CREATE\s+POLICY\s+${NAME}\s+ON\s+${TABLE}([\s\S]*)$`, 'i').exec(s)
      if (m) {
        live.set(`${normTable(m[2]!)}|${normName(m[1]!)}`, {
          using: clause(m[3]!, /\bUSING\b/i), check: clause(m[3]!, /\bWITH\s+CHECK\b/i), file,
        })
        continue
      }
      m = new RegExp(String.raw`^ALTER\s+POLICY\s+${NAME}\s+ON\s+${TABLE}([\s\S]*)$`, 'i').exec(s)
      if (m) {
        const key = `${normTable(m[2]!)}|${normName(m[1]!)}`
        const prev = live.get(key)
        if (prev) {
          const using = clause(m[3]!, /\bUSING\b/i)
          const check = clause(m[3]!, /\bWITH\s+CHECK\b/i)
          live.set(key, { using: using ?? prev.using, check: check ?? prev.check, file })
        }
        continue
      }
      m = new RegExp(String.raw`^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?${TABLE}`, 'i').exec(s)
      if (m) {
        const t = normTable(m[1]!)
        for (const k of [...live.keys()]) if (k.startsWith(`${t}|`)) live.delete(k)
      }
    }
  }
  return live
}

describe('role and clinic never come from user_metadata (RLS)', () => {
  it('after every migration, no live policy reads user_metadata or raw_user_meta_data', () => {
    const offenders = [...replay()]
      .filter(([, p]) => /user_metadata|raw_user_meta_data/.test(`${p.using ?? ''} ${p.check ?? ''}`))
      .map(([k, p]) => `${k} (${p.file})`)
    expect(offenders).toEqual([])
  })

  it('the migration that moves the claims backfills app_metadata and has a down file', () => {
    const files = readdirSync(MIG).filter(f => /_app_metadata_roles\.sql$/.test(f))
    expect(files).toHaveLength(1)
    const up = readFileSync(join(MIG, files[0]!), 'utf8')
    expect(up).toMatch(/raw_app_meta_data/)
    const version = files[0]!.split('_')[0]
    expect(existsSync(join(MIG, 'down', `${version}_down.sql`))).toBe(true)
  })
})
