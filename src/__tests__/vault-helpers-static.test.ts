/**
 * @jest-environment node
 *
 * The Vault helpers (create_vault_secret, rotate_vault_secret,
 * delete_vault_secret) must write secrets through Supabase Vault's own API.
 *
 * PR #231 E2E: create_vault_secret failed with "permission denied for
 * function _crypto_aead_det_noncegen". Its definition (20260317000005)
 * did a raw INSERT INTO vault.secrets. In Supabase Vault 0.3 the nonce
 * column's default is vault._crypto_aead_det_noncegen(), which only
 * Vault's own SECURITY DEFINER functions may run, and the encryption
 * happens inside vault.create_secret / vault.update_secret, not in a
 * trigger. So a raw INSERT is refused, and a raw UPDATE of the secret
 * column (rotate_vault_secret) would store the new value unencrypted.
 *
 * This takes the LAST migration that defines each helper (the one in
 * effect) and pins: it calls vault.create_secret / vault.update_secret,
 * never writes vault.secrets' secret directly; SECURITY DEFINER with a
 * fixed, empty search_path; EXECUTE revoked from PUBLIC, anon and
 * authenticated and granted to service_role. No later migration may
 * revert it.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(process.cwd(), 'supabase', 'migrations')
const FILES = readdirSync(DIR).filter(f => f.endsWith('.sql')).sort()
const flat = (s: string) => s.replace(/\r\n/g, '\n').replace(/--.*$/gm, '').replace(/\s+/g, ' ').toLowerCase()
const MIGRATIONS = FILES.map(f => ({ file: f, code: flat(readFileSync(join(DIR, f), 'utf8')) }))

/** The body of the last CREATE [OR REPLACE] FUNCTION <name>(...) ... $$; in effect, and where. */
function latestDefinition(name: string): { file: string; body: string } | null {
  let found: { file: string; body: string } | null = null
  for (const m of MIGRATIONS) {
    const re = new RegExp(`create (?:or replace )?function (?:public\\.)?${name}\\s*\\(`, 'g')
    let hit: RegExpExecArray | null
    while ((hit = re.exec(m.code))) {
      const start = hit.index
      const open = m.code.indexOf('$$', start)
      const close = m.code.indexOf('$$', open + 2)
      found = { file: m.file, body: m.code.slice(start, close + 2) }
    }
  }
  return found
}

/** Grants and revokes on a helper, in migration order. */
function grantsAfter(name: string, file: string): string {
  return MIGRATIONS.filter(m => m.file >= file).map(m => m.code).join(' ')
    .split(';').filter(s => s.includes(` function ${name}(`) || s.includes(` function public.${name}(`)).join(';')
}

describe.each([
  ['create_vault_secret', 'vault.create_secret(', '(text, text)'],
  ['rotate_vault_secret', 'vault.update_secret(', '(uuid, text)'],
])('%s', (name, api, sig) => {
  const def = latestDefinition(name)!

  it('is defined', () => {
    expect(def).not.toBeNull()
  })

  it(`writes through ${api.slice(0, -1)}, never vault.secrets directly`, () => {
    expect(def.body).toContain(api)
    expect(def.body).not.toMatch(/insert into vault\.secrets/)
    expect(def.body).not.toMatch(/update vault\.secrets\s+set\s+secret/)
  })

  it('is SECURITY DEFINER with a fixed, empty search_path', () => {
    expect(def.body).toContain('security definer')
    expect(def.body).toMatch(/set search_path = ''/)
  })

  it('anon and authenticated cannot run it; service_role can', () => {
    const g = grantsAfter(name, def.file)
    expect(g).toContain(`revoke all on function ${name}${sig} from public, anon, authenticated`)
    expect(g).toContain(`grant execute on function ${name}${sig} to service_role`)
    expect(g).not.toMatch(new RegExp(`grant [a-z, ]+ on function ${name}\\${sig.replace(')', '\\)')} to [a-z_, ]*(anon|authenticated|public)`))
  })
})

it('delete_vault_secret stays service_role only, with a fixed search_path', () => {
  const def = latestDefinition('delete_vault_secret')!
  expect(def.body).toContain('security definer')
  expect(def.body).toMatch(/set search_path = ''/)
  const g = grantsAfter('delete_vault_secret', def.file)
  expect(g).toContain('revoke all on function delete_vault_secret(uuid) from public, anon, authenticated')
  expect(g).toContain('grant execute on function delete_vault_secret(uuid) to service_role')
})

it('no app code writes vault.secrets directly (only the helpers, through RPC)', () => {
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '__tests__') continue
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p, out)
      else if (/\.(ts|tsx)$/.test(e.name)) out.push(p)
    }
    return out
  }
  const offenders = walk(join(process.cwd(), 'src')).filter(f => {
    const src = readFileSync(f, 'utf8')
    return /schema\(['"]vault['"]\)\s*\.from\(['"]secrets['"]\)\s*\.(insert|update|upsert)/.test(src.replace(/\s+/g, ''))
  })
  expect(offenders).toEqual([])
})
