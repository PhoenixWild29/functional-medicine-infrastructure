/**
 * @jest-environment node
 *
 * Landmarks (Issue Log 94): every route renders exactly one <main>, and
 * every page that renders content has an h1.
 *
 * Static: for each src/app page.tsx, the layouts above it and the page
 * (with the components it renders) are read as source. A route gets its
 * <main> from exactly one place:
 *   - a layout above it, and then nothing below may render another, or
 *   - the page itself (or a shared component that renders the page's
 *     <main>), when no layout does.
 * A page that only redirects renders nothing and is skipped.
 *
 * Found by this guard and fixed: /onboard/pharmacy/[token] (the onboard
 * layout's <main> around the page's own <main>), and the ops pages (half
 * rendered a <main>, half none; the ops layout now owns it). The ops
 * Adapters, Catalog, Fax Queue and Pipeline pages had no h1.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, normalize, relative, sep } from 'node:path'

const APP = join(process.cwd(), 'src', 'app')
const SRC = join(process.cwd(), 'src')

/** Components outside a page's own folder that render a page-level <main>. */
const MAIN_COMPONENTS = ['LegalDocumentPage', 'SessionGuardNotice', 'MfaShell', 'IntakeFlow', 'CheckoutPageContent', 'OnboardingWizard']

const strip = (s: string) => s
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

const code = (file: string) => strip(readFileSync(file, 'utf8'))

function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith('@/') ? join(SRC, spec.slice(2)) : spec.startsWith('.') ? normalize(join(dirname(from), spec)) : null
  if (!base) return null
  for (const ext of ['.tsx', '.ts', `${sep}index.tsx`]) if (existsSync(base + ext)) return base + ext
  return null
}

/** The layout's own source, following `export { default } from '...'`. */
function layoutSource(file: string): string {
  const src = code(file)
  const re = /export\s*\{\s*default\s*\}\s*from\s*'([^']+)'/.exec(src)
  const target = re ? resolveImport(file, re[1]!) : null
  return target ? code(target) : src
}

/** The page plus the local components it imports (its own _components tree), a few levels deep. */
function pageSources(file: string, depth = 0, seen = new Set<string>()): string[] {
  if (seen.has(file) || depth > 3) return []
  seen.add(file)
  const src = code(file)
  const out = [src]
  for (const m of src.matchAll(/from '([^']+)'/g)) {
    const r = resolveImport(file, m[1]!)
    if (r && r.includes(`${sep}_components${sep}`)) out.push(...pageSources(r, depth + 1, seen))
  }
  return out
}

function pages(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (name === '__tests__' || name === 'api') continue
    if (statSync(p).isDirectory()) out.push(...pages(p))
    else if (name === 'page.tsx') out.push(p)
  }
  return out
}

function layoutsAbove(page: string): string[] {
  const out: string[] = []
  let d = dirname(page)
  for (;;) {
    const l = join(d, 'layout.tsx')
    if (existsSync(l)) out.push(l)
    if (normalize(d) === normalize(APP)) break
    d = dirname(d)
  }
  return out
}

const route = (page: string) => '/' + relative(APP, dirname(page)).split(sep).filter(s => !/^\(.*\)$/.test(s)).join('/')
const countMain = (s: string) => (s.match(/<main\b/g) ?? []).length
const usesMainComponent = (s: string) => MAIN_COMPONENTS.some(c => new RegExp(`<${c}\\b`).test(s))
const redirectOnly = (s: string) => /\bredirect\(/.test(s) && !/<[A-Za-z]/.test(s)

const ALL = pages(APP).sort()

it('finds the routes', () => {
  expect(ALL.length).toBeGreaterThan(40)
})

describe.each(ALL.map(p => [route(p), p] as const))('%s', (_route, page) => {
  const pageSrc = pageSources(page)
  const layoutMains = layoutsAbove(page).filter(l => countMain(layoutSource(l)) > 0)
  const isRedirect = redirectOnly(pageSrc[0]!)

  it('has exactly one source of <main>', () => {
    if (isRedirect) return
    const below = pageSrc.reduce((n, s) => n + countMain(s), 0) + (pageSrc.some(usesMainComponent) ? 1 : 0)
    if (layoutMains.length > 0) {
      expect({ layoutMains: layoutMains.length, mainsBelowTheLayout: below }).toEqual({ layoutMains: 1, mainsBelowTheLayout: 0 })
    } else {
      expect({ pageRendersMain: below > 0 }).toEqual({ pageRendersMain: true })
    }
  })

  it('has an h1', () => {
    if (isRedirect) return
    const all = pageSrc.join('\n')
    const h1 = /<h1\b/.test(all) || usesMainComponent(all) || /headingLevel=\{1\}/.test(all)
    expect({ h1 }).toEqual({ h1: true })
  })
})
