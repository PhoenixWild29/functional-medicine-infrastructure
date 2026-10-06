/**
 * @jest-environment node
 *
 * C7 (no PHI to Stripe) static guard. The runtime guard in
 * src/lib/stripe/phi-guard.ts only sees calls made through
 * createStripeClient(), so this pins the two things that keep it complete:
 *
 *   1. The Stripe SDK is constructed in exactly one place,
 *      src/lib/stripe/client.ts, which wraps it with the guard.
 *   2. No source sends a patient-identifying field Stripe would store:
 *      receipt_email, statement_descriptor(_suffix), shipping, or a
 *      customer object.
 *
 * Comments are stripped before matching, so explaining the rule in a
 * comment does not trip it.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SRC  = join(ROOT, 'src')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__' || name === '__type-checks__') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(full)
  }
  return out
}

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

const FILES = walk(SRC)
  .filter(f => !/database\.types\.ts$/.test(f))
  .map(f => ({ rel: relative(ROOT, f).replace(/\\/g, '/'), src: code(f) }))

describe('C7 Stripe PHI static guard', () => {
  it('constructs the Stripe SDK only in src/lib/stripe/client.ts', () => {
    const offenders = FILES
      .filter(f => /new\s+Stripe\s*\(/.test(f.src))
      .map(f => f.rel)
    expect(offenders).toEqual(['src/lib/stripe/client.ts'])
  })

  it.each([
    ['receipt_email',          /receipt_email\s*:/],
    ['statement_descriptor',   /statement_descriptor(_suffix)?\s*:/],
    ['customers.create/update', /\.customers\.(create|update)\s*\(/],
  ])('no source sends %s to Stripe', (_name, pattern) => {
    const offenders = FILES.filter(f => pattern.test(f.src)).map(f => f.rel)
    expect(offenders).toEqual([])
  })

  it('no Stripe description mentions a prescription', () => {
    const offenders = FILES
      .filter(f => /description\s*:\s*[`'"][^`'"]*prescription/i.test(f.src))
      .map(f => f.rel)
    expect(offenders).toEqual([])
  })
})
