/**
 * @jest-environment node
 *
 * Lauren, 23 Oct: no em dash used as punctuation in on-screen text, on any
 * clinic, ops, pharmacy, patient or public page ("Paid — Processing",
 * "Shipping — Strive Pharmacy", "Order details — {id}"). A comma, colon or
 * period instead. A lone "—" standing in for an empty value may stay.
 *
 * What is scanned (comments stripped): every .ts/.tsx under src/app and
 * src/components (pages, components, titles, aria-labels), the error and
 * message strings API routes return to the screen, and the lib modules
 * whose strings are shown. Not scanned: logs (console.*), internal errors
 * (throw new Error), and machine-facing text (fax cover, Slack, PagerDuty,
 * the OpenAPI spec).
 *
 * Punctuation means an em dash with a space on at least one side. A lone
 * placeholder ('—', >—<) has none.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    if (name === '__tests__' || name === 'node_modules') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(full)
  }
  return out
}

/** Comments out, strings and JSX text kept (a small tokenizer, not a regex). */
function stripComments(src: string): string {
  let out = ''
  let state: null | "'" | '"' | '`' | 'line' | 'block' = null
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!
    const next = src[i + 1] ?? ''
    if (state === null) {
      const prev = i === 0 ? '\n' : src[i - 1]!
      if (c === '/' && next === '/' && /[\s;{}(),]/.test(prev)) { state = 'line'; i++; continue }
      if (c === '/' && next === '*') { state = 'block'; i++; continue }
      if (c === "'" || c === '"' || c === '`') state = c
      out += c
    } else if (state === 'line') {
      if (c === '\n') { state = null; out += c }
    } else if (state === 'block') {
      if (c === '*' && next === '/') { state = null; i++; continue }
      if (c === '\n') out += c
    } else {
      out += c
      if (c === '\\') { out += next; i++; continue }
      if (c === state || (c === '\n' && state !== '`')) state = null
    }
  }
  return out
}

// lib modules whose strings reach the screen.
const UI_LIB = [
  'src/lib/orders/status-config.ts', 'src/lib/practice/metrics.ts', 'src/lib/practice/attention.ts',
  'src/lib/orders/batch-sign.ts', 'src/lib/orders/signature.ts', 'src/lib/orders/titration.ts',
  'src/lib/orders/rx-details.ts', 'src/lib/orders/reroute.ts', 'src/lib/orders/resolve-line.ts',
  'src/lib/patients/dashboard-patient.ts', 'src/lib/orders/timeline-actors.ts',
]

// Machine-facing, not on a screen.
const MACHINE = /src\/app\/api\/spec\//

const PUNCTUATION_DASH = /\s—|—\s/
const NOT_SHOWN = /console\.|throw new Error\(|logger\./

function offenders(): string[] {
  const files = [...walk(join(ROOT, 'src', 'app')), ...walk(join(ROOT, 'src', 'components')), ...UI_LIB.map(f => join(ROOT, f))]
  const found: string[] = []
  for (const file of files) {
    const rel = relative(ROOT, file).replace(/\\/g, '/')
    if (MACHINE.test(rel)) continue
    const isApi = rel.startsWith('src/app/api/')
    const lines = stripComments(readFileSync(file, 'utf8')).split('\n')
    lines.forEach((line, i) => {
      if (!line.includes('—') || NOT_SHOWN.test(line)) return
      // In API routes only what is returned to the screen: error / message text.
      if (isApi && !/\b(error|message)\s*:/.test(line)) return
      if (PUNCTUATION_DASH.test(line)) found.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`)
    })
  }
  return found
}

it('no em dash is used as punctuation in on-screen text', () => {
  expect(offenders()).toEqual([])
})

it('a lone placeholder dash is allowed, punctuation is not', () => {
  expect(PUNCTUATION_DASH.test("value ?? '—'")).toBe(false)
  expect(PUNCTUATION_DASH.test('<span>—</span>')).toBe(false)
  expect(PUNCTUATION_DASH.test("label: 'Paid — Processing'")).toBe(true)
  expect(PUNCTUATION_DASH.test('Order details — {id}')).toBe(true)
})
