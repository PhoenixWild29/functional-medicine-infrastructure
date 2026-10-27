/**
 * Client bundle boundaries (page weight, C-2026-10-25-04).
 *
 * Walks the static import graph of client components (type-only imports
 * and dynamic import() are not followed: neither ships in the first load)
 * and checks that heavy or server-only modules are not pulled in eagerly:
 *
 *   - node:crypto in a client graph ships crypto-browserify, stream and
 *     util polyfills (about 120 kB gzip on /ops/onboarding).
 *   - qrcode (about 11 kB) is needed only after "Show QR code" on the plan
 *     link panel, which the dashboard and the review page render.
 *   - @dnd-kit/core (about 12 kB) is needed only in the dashboard's kanban
 *     view; the table view is the default.
 *   - The Supabase browser client (about 60 kB with auth, realtime,
 *     storage and postgrest) is needed by the layout only to sign out.
 */

import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../../..')
const SRC = path.join(ROOT, 'src')

function resolveLocal(spec: string, from: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = path.join(SRC, spec.slice(2))
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec)
  else return null
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand
  }
  return null
}

/** Static, value-level import specifiers (not `import type`, not import()). */
function staticImports(file: string): string[] {
  const src = fs.readFileSync(file, 'utf8')
  const out: string[] = []
  const re = /^\s*(import|export)\s+(?!type\s)([^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    const clause = m[2] ?? ''
    // `import { type A, type B } from` is type-only too.
    const named = clause.match(/\{([^}]*)\}/)
    if (named && !clause.replace(named[0], '').match(/[A-Za-z_$]/) &&
        named[1]!.split(',').map(s => s.trim()).filter(Boolean).every(s => s.startsWith('type '))) continue
    if (m[1] === 'export' && !clause) continue
    out.push(m[3]!)
  }
  return out
}

/** Every bare package specifier reachable through static imports. */
function eagerPackages(entry: string): Map<string, string> {
  const seen = new Set<string>()
  const pkgs = new Map<string, string>()
  const stack = [path.join(ROOT, entry)]
  while (stack.length) {
    const file = stack.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    for (const spec of staticImports(file)) {
      const local = resolveLocal(spec, file)
      if (local) stack.push(local)
      else if (!spec.startsWith('.') && !spec.startsWith('@/') && !pkgs.has(spec)) pkgs.set(spec, path.relative(ROOT, file))
    }
  }
  return pkgs
}

function offenders(entry: string, banned: RegExp): string[] {
  return [...eagerPackages(entry)].filter(([spec]) => banned.test(spec)).map(([spec, by]) => `${spec} (imported by ${by})`)
}

const NODE_CRYPTO = /^(node:)?crypto$/

describe('client components do not eagerly import heavy or server-only modules', () => {
  it('ops onboarding admin does not pull node:crypto into the browser', () => {
    expect(offenders('src/app/(ops-dashboard)/ops/onboarding/_components/onboarding-admin.tsx', NODE_CRYPTO)).toEqual([])
  })

  it.each([
    'src/components/proposals/plan-link-panel.tsx',
    'src/app/(clinic-app)/dashboard/_components/proposal-panel.tsx',
    'src/app/(clinic-app)/new-prescription/review/_components/batch-review-form.tsx',
  ])('%s loads qrcode only when the QR code is shown', entry => {
    expect(offenders(entry, /^qrcode$/)).toEqual([])
  })

  it('the dashboard loads @dnd-kit only for the kanban view', () => {
    expect(offenders('src/app/(clinic-app)/dashboard/_components/orders-dashboard.tsx', /^@dnd-kit\//)).toEqual([])
  })

  it.each([
    'src/components/hipaa-timeout.tsx',
    'src/components/sidebar-nav.tsx',
    'src/components/nav-sign-out-button.tsx',
    'src/app/unauthorized/_components/sign-out-button.tsx',
  ])('%s loads the Supabase browser client only to sign out', entry => {
    expect(offenders(entry, /^@supabase\//)).toEqual([])
  })

  it('the walker sees through to packages (sanity: the kanban itself imports @dnd-kit)', () => {
    expect(offenders('src/app/(clinic-app)/dashboard/_components/orders-kanban.tsx', /^@dnd-kit\//).length).toBeGreaterThan(0)
  })
})
