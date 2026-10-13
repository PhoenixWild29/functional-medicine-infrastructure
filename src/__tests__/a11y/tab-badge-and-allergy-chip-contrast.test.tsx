/**
 * @jest-environment jsdom
 *
 * WCAG 2.1 AA (1.4.3, 4.5:1) in light and dark:
 *
 *   - Dashboard order-tab count badges (All, Drafts, Pending Payment, ...):
 *     the active badge was text-primary on bg-primary/10 (4.52:1 light,
 *     4.45:1 dark over the card; under 4.5 as rendered), the others
 *     text-muted-foreground on bg-muted (4.40:1 light, 4.19:1 dark). Both
 *     now use text-foreground.
 *   - Allergy chips: the loading chip was text-muted-foreground on bg-muted
 *     (4.40 / 4.19), now text-foreground. The NKDA / allergies / not
 *     recorded / could-not-load chips used a 40% dark tint whose contrast
 *     depended on the surface under it (card, page, selected row); in dark
 *     they now use the solid -950 shade, so the ratio is fixed.
 *
 * jsdom cannot compute colours, so the ratios come from the tokens in
 * globals.css and Tailwind's palette, and the classes are pinned.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, cleanup } from '@testing-library/react'
import { AllergyChip } from '@/app/(clinic-app)/new-prescription/_components/allergy-chip'

const ROOT = join(__dirname, '..', '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

type RGB = [number, number, number]
function hslToRgb(h: number, s: number, l: number): RGB {
  s /= 100; l /= 100
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0) * 255, f(8) * 255, f(4) * 255]
}
function luminance([r, g, b]: RGB): number {
  const lin = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}
function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}
const mix = (fg: RGB, bg: RGB, alpha: number): RGB => fg.map((c, i) => alpha * c + (1 - alpha) * bg[i]!) as RGB
const hex = (h: string): RGB => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)) as RGB
function token(name: string, theme: 'light' | 'dark'): RGB {
  const css = read('src/app/globals.css')
  const block = theme === 'light' ? css.slice(0, css.indexOf('.dark {')) : css.slice(css.indexOf('.dark {'))
  const m = block.match(new RegExp(`--${name}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`))
  if (!m) throw new Error(`--${name} not found (${theme})`)
  return hslToRgb(Number(m[1]), Number(m[2]), Number(m[3]))
}

// Tailwind 3 palette
const P = {
  'emerald-100': '#d1fae5', 'emerald-800': '#065f46', 'emerald-950': '#022c22', 'emerald-300': '#6ee7b7',
  'red-100': '#fee2e2', 'red-800': '#991b1b', 'red-950': '#450a0a', 'red-300': '#fca5a5',
  'amber-100': '#fef3c7', 'amber-800': '#92400e', 'amber-950': '#451a03', 'amber-300': '#fcd34d',
} as const

afterEach(cleanup)

describe.each(['light', 'dark'] as const)('tab count badges, %s', theme => {
  const surfaces = () => [token('background', theme), token('card', theme)]
  it('active: text-foreground on primary/10 is at least 4.5:1 on the page and the card', () => {
    for (const s of surfaces()) expect(contrast(token('foreground', theme), mix(token('primary', theme), s, 0.1))).toBeGreaterThanOrEqual(4.5)
  })
  it('inactive: text-foreground on bg-muted is at least 4.5:1 (text-muted-foreground was not)', () => {
    expect(contrast(token('foreground', theme), token('muted', theme))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(token('muted-foreground', theme), token('muted', theme))).toBeLessThan(4.5)
  })
})

it('the old active badge (text-primary on primary/10 over the card) was under 4.5:1 in dark', () => {
  expect(contrast(token('primary', 'dark'), mix(token('primary', 'dark'), token('card', 'dark'), 0.1))).toBeLessThan(4.5)
})

describe('allergy chip colour pairs', () => {
  it.each(['emerald', 'red', 'amber'] as const)('%s: light -800 on -100 and dark -300 on solid -950 are at least 4.5:1', c => {
    expect(contrast(hex(P[`${c}-800`]), hex(P[`${c}-100`]))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(hex(P[`${c}-300`]), hex(P[`${c}-950`]))).toBeGreaterThanOrEqual(4.5)
  })
  it.each(['light', 'dark'] as const)('loading chip, %s: text-foreground on bg-muted (muted-foreground was not)', theme => {
    expect(contrast(token('foreground', theme), token('muted', theme))).toBeGreaterThanOrEqual(4.5)
  })
})

describe('the classes in the source', () => {
  it('dashboard tab badges use text-foreground, never text-primary or text-muted-foreground', () => {
    const src = read('src/app/(clinic-app)/dashboard/_components/orders-dashboard.tsx')
    expect(src).toContain("'bg-primary/10 text-foreground' : 'bg-muted text-foreground'")
    expect(src).not.toContain("'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'")
  })

  const chip = (el: HTMLElement) => el.className
  it('loading chip: text-foreground on bg-muted', () => {
    render(<AllergyChip patient={null} loading />)
    const cls = chip(screen.getByTestId('allergy-chip-loading'))
    expect(cls).toMatch(/(^|\s)bg-muted(\s|$)/)
    expect(cls).toMatch(/(^|\s)text-foreground(\s|$)/)
    expect(cls).not.toMatch(/text-muted-foreground/)
  })

  it.each([
    ['nkda',         { nkda: true, allergies: [] },               'emerald'],
    ['recorded',     { nkda: false, allergies: ['penicillin'] },  'red'],
    ['not_recorded', { nkda: false, allergies: [] },              'amber'],
  ] as const)('%s chip: -800 on -100 in light, -300 on solid -950 in dark (no 40%% tint)', (_k, patient, c) => {
    render(<AllergyChip patient={patient as never} />)
    const cls = chip(screen.getByTestId('allergy-chip'))
    for (const want of [`bg-${c}-100`, `text-${c}-800`, `dark:bg-${c}-950`, `dark:text-${c}-300`]) {
      expect(cls.split(/\s+/)).toContain(want)
    }
    expect(cls).not.toMatch(/dark:bg-\w+-950\/\d+/)
  })

  it('could-not-load chip: solid red-950 in dark', () => {
    render(<AllergyChip patient={{ allergiesLoadFailed: true } as never} />)
    const cls = chip(screen.getByTestId('allergy-chip-load-error'))
    expect(cls.split(/\s+/)).toEqual(expect.arrayContaining(['bg-red-100', 'text-red-800', 'dark:bg-red-950', 'dark:text-red-300']))
    expect(cls).not.toMatch(/dark:bg-red-950\/\d+/)
  })
})
