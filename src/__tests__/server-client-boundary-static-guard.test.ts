/**
 * @jest-environment node
 *
 * Regression guard for the 2026-09 WO-106 /dashboard outage.
 *
 * WO-106 exported a helper, isTabId(), from orders-dashboard.tsx — a
 * 'use client' module — and dashboard/page.tsx, a Server Component,
 * imported it and CALLED it during render. In the app router, anything a
 * server module imports from a 'use client' module is a client reference,
 * not the real value: rendering a client component from it works, calling
 * it as a function throws. /dashboard stopped rendering at all.
 *
 * Nothing else caught it:
 *   - tsc sees an ordinary function with an ordinary signature;
 *   - Jest imports both files into one module graph, where the call works;
 *   - `next build` compiles the page but does not execute it.
 * Only E2E — which loads /dashboard for real — failed, three tests at
 * once, none of them about tabs.
 *
 * The rule enforced here: a Server Component may import from a
 * 'use client' module only what it renders — components (PascalCase)
 * and types. Helpers, constants and hooks belong in a plain module both
 * sides can import. This checks the whole class, not the one instance.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname, relative, resolve } from 'node:path'

const ROOT = process.cwd()
const SRC  = join(ROOT, 'src')
const APP  = join(SRC, 'app')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(full)
  }
  return out
}

/** The first statement, after comments and blank lines, is 'use client'. */
function isClientModule(source: string): boolean {
  const head = source
    .replace(/^﻿/, '')
    .replace(/^(\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*/, '')
  return /^['"]use client['"]/.test(head)
}

/** '@/x' → src/x; './x' → relative to the importer; packages → null. */
function resolveImport(from: string, spec: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = join(SRC, spec.slice(2))
  else if (spec.startsWith('.')) base = resolve(dirname(from), spec)
  else return null
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

/**
 * Values a Server Component may take from a client module: components.
 * PascalCase, and not an ALL_CAPS constant (TABS, MAX_X) — a constant
 * array from a client module is just as unusable on the server.
 */
function isComponentName(name: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/.test(name) && !/^[A-Z0-9_]+$/.test(name)
}

interface Violation { file: string; name: string; from: string }

/** Every value (not type) import this server module takes from a client module. */
function violationsIn(file: string, clientModules: ReadonlySet<string>): Violation[] {
  const source = readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
  const out: Violation[] = []

  for (const m of source.matchAll(/import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g)) {
    const clause = m[1]!.trim()
    const target = resolveImport(file, m[2]!)
    if (!target || !clientModules.has(target)) continue
    if (/^type\s/.test(clause)) continue                       // import type { … }

    const rel = relative(ROOT, file).replace(/\\/g, '/')
    const fromRel = relative(ROOT, target).replace(/\\/g, '/')

    if (/^\*\s+as\s+/.test(clause)) {                           // import * as X
      out.push({ file: rel, name: clause, from: fromRel })
      continue
    }

    const braces = /\{([\s\S]*?)\}/.exec(clause)
    for (const raw of braces ? braces[1]!.split(',') : []) {
      const spec = raw.trim()
      if (!spec || /^type\s/.test(spec)) continue               // { type Foo }
      const exported = spec.split(/\s+as\s+/)[0]!.trim()
      if (!isComponentName(exported)) out.push({ file: rel, name: exported, from: fromRel })
    }
    // A default import from a client module is its component — allowed.
  }
  return out
}

describe('server components take only components and types from client modules', () => {
  const files = walk(SRC)
  const clientModules = new Set(files.filter(f => isClientModule(readFileSync(f, 'utf8'))))
  // Server modules that render: every non-client file under src/app. A
  // plain helper there that is only ever imported by client code would
  // run on the client, but none of them import values from a client
  // module, so the broader net costs nothing.
  const serverFiles = files.filter(f => f.startsWith(APP) && !clientModules.has(f))

  it('finds the client modules and server files it is meant to check', () => {
    // A guard that silently scans nothing passes forever.
    expect(clientModules.size).toBeGreaterThan(20)
    expect(serverFiles.some(f => f.replace(/\\/g, '/').endsWith('dashboard/page.tsx'))).toBe(true)
    expect([...clientModules].some(f => f.replace(/\\/g, '/').endsWith('dashboard/_components/orders-dashboard.tsx'))).toBe(true)
  })

  it('no server component imports a helper, constant or hook from a client module', () => {
    const violations = serverFiles.flatMap(f => violationsIn(f, clientModules))
    const report = violations.map(v => `${v.file} imports ${v.name} from client module ${v.from}`)
    expect(report).toEqual([])
  })
})
