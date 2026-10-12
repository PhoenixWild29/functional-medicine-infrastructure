/**
 * @jest-environment node
 *
 * Text contrast (WCAG 2.1 AA 1.4.3, 4.5:1) on the pharmacy onboarding
 * pages. #215's ops onboarding page failed axe color-contrast in the ops
 * dark theme; the same patterns were here:
 *   - white on --primary in the dark theme (#3B82F6, 3.7:1): buttons need
 *     dark:bg-primary-hover (#2563EB, 5.2:1), and no faded hover;
 *   - --muted-foreground on the dark card (#6B7A99 on #161B27, 4.0:1):
 *     ops text needs dark:text-slate-300;
 *   - --destructive as text fails in both themes (#EF4444 on white 3.8:1,
 *     #DC2626 on the dark card 3.6:1): errors use red-700 / dark:red-300.
 * jsdom has no layout, so axe cannot compute contrast here; this pins the
 * classes, and the colours they stand for are checked numerically below.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..', '..', '..')
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8')

const FIELDS = 'src/components/pharmacy-onboarding/fields.tsx'
// Rendered inside the ops layout's .dark wrapper.
const OPS = [
  'src/app/(ops-dashboard)/ops/onboarding/pharmacies/page.tsx',
  'src/app/(ops-dashboard)/ops/onboarding/pharmacies/[applicationId]/page.tsx',
  'src/app/(ops-dashboard)/ops/onboarding/_components/pharmacy/pharmacy-onboarding-section.tsx',
  'src/app/(ops-dashboard)/ops/onboarding/_components/pharmacy/pharmacy-application-review.tsx',
]
// Light theme (pharmacy portal and invite acceptance).
const LIGHT = [
  'src/app/onboard/pharmacy/[token]/page.tsx',
  'src/app/onboard/pharmacy/[token]/_components/accept-invite-form.tsx',
  'src/app/pharmacy/onboarding/page.tsx',
  'src/app/pharmacy/onboarding/_components/onboarding-wizard.tsx',
  'src/app/pharmacy/onboarding/_components/steps.tsx',
]
const ALL = [FIELDS, ...OPS, ...LIGHT]

/** Every class list (static className strings) in a file. */
const classLists = (src: string) =>
  [...src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)].map(m => m[1] ?? m[2] ?? '')

describe('pharmacy onboarding classes', () => {
  it.each(ALL)('%s: no --destructive text and no faded primary hover', f => {
    const src = read(f)
    expect(src.match(/\btext-destructive\b/g) ?? []).toEqual([])
    expect(src.match(/hover:bg-primary\/\d+/g) ?? []).toEqual([])
  })

  it.each([FIELDS, ...OPS])('%s: a solid primary button darkens in the dark theme', f => {
    const solid = classLists(read(f)).filter(c => /(^|\s)bg-primary(\s|$)/.test(c))
    for (const c of solid) expect(c).toContain('dark:bg-primary-hover')
  })

  it.each([FIELDS, ...OPS])('%s: muted text is lifted on the dark card', f => {
    const muted = classLists(read(f)).filter(c => /(^|\s)text-muted-foreground(\s|$)/.test(c))
    for (const c of muted) expect(c).toContain('dark:text-slate-300')
  })
})

describe('the colours those classes stand for', () => {
  const hex = (h: string): [number, number, number] =>
    [0, 2, 4].map(i => parseInt(h.slice(1 + i, 3 + i), 16)) as [number, number, number]
  const lum = ([r, g, b]: [number, number, number]) => {
    const lin = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  }
  const contrast = (a: string, b: string) => {
    const [x, y] = [lum(hex(a)), lum(hex(b))].sort((p, q) => q - p) as [number, number]
    return (x + 0.05) / (y + 0.05)
  }
  const WHITE = '#FFFFFF', DARK_CARD = '#161B27', DARK_BG = '#0C0E14'

  it.each([
    ['red-700 error on white', '#B91C1C', WHITE],
    ['red-300 error on the dark card', '#FCA5A5', DARK_CARD],
    ['slate-300 on the dark card', '#CBD5E1', DARK_CARD],
    ['slate-300 on the dark page', '#CBD5E1', DARK_BG],
    ['white on primary-hover (dark button)', WHITE, '#2563EB'],
    ['white on blue-700 (dark button hover)', WHITE, '#1D4ED8'],
    ['white on primary-hover (light button hover)', WHITE, '#1D4ED8'],
  ])('%s is at least 4.5:1', (_n, fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5)
  })

  it.each([
    ['--muted-foreground on the dark card', '#6B7A99', DARK_CARD],
    ['white on dark --primary', WHITE, '#3B82F6'],
    ['light --destructive on white', '#EF4444', WHITE],
  ])('%s is below 4.5:1 (why the classes above are required)', (_n, fg, bg) => {
    expect(contrast(fg, bg)).toBeLessThan(4.5)
  })
})
