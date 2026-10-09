/**
 * @jest-environment node
 *
 * API routes identify the caller with supabase.auth.getUser(), which
 * verifies the JWT with the auth server. getSession() only decodes the
 * cookie: a forged or replayed token passes it with whatever role and
 * clinic it claims. Middleware happens to verify most /api requests
 * first, but a route must not depend on that (a route under a public
 * middleware prefix, like /api/checkout, gets no upstream check at all).
 *
 * Fails if any non-test file under src/app/api calls auth.getSession().
 * Comments are stripped before matching.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const API = join(process.cwd(), 'src', 'app', 'api')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === '__tests__') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}

const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')

it('no route under src/app/api calls auth.getSession()', () => {
  const offenders = walk(API)
    .filter(f => /\.auth\s*\.\s*getSession\s*\(/.test(strip(readFileSync(f, 'utf8'))))
    .map(f => relative(process.cwd(), f).replace(/\\/g, '/'))
  expect(offenders).toEqual([])
})
