/**
 * WCAG 2.1 AA (1.4.3, 4.5:1): the clinic sidebar's active link and the
 * small badges in Select Patient's rows, in light and dark.
 *
 * PR #227's E2E (intake.spec.ts) failed axe color-contrast on
 * /new-prescription:
 *   - the active sidebar link, text-primary on bg-primary/10 (about 4.5:1
 *     in light by the tokens, under it as rendered; 4.45:1 in dark);
 *   - the state badge in each patient row, text-muted-foreground on
 *     bg-muted (4.40:1 light, 4.19:1 dark).
 * Both now use text-foreground. The sidebar is shared by every clinic
 * page, so the fix is at its source. The "No state" badge (amber-700 on
 * amber-100, 4.51:1) is darkened to amber-800 for margin.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

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

/** A token's HSL from globals.css: the light theme (:root) or .dark. */
function token(name: string, theme: 'light' | 'dark'): RGB {
  const css = read('src/app/globals.css')
  const block = theme === 'light' ? css.slice(0, css.indexOf('.dark {')) : css.slice(css.indexOf('.dark {'))
  const m = block.match(new RegExp(`--${name}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`))
  if (!m) throw new Error(`--${name} not found (${theme})`)
  return hslToRgb(Number(m[1]), Number(m[2]), Number(m[3]))
}

/** The tokens before the staff contrast pass (queue2-b), for the "was not" checks. */
const OLD: Record<string, Record<'light' | 'dark', RGB>> = {
  'muted-foreground': { light: hslToRgb(215, 16, 47), dark: hslToRgb(220, 20, 55) },
  primary:            { light: hslToRgb(221, 83, 53), dark: hslToRgb(217, 91, 60) },
}

describe.each(['light', 'dark'] as const)('%s', theme => {
  it('active sidebar link: text-foreground on the primary/10 tint over the card is at least 4.5:1', () => {
    const tint = mix(token('primary', theme), token('card', theme), 0.1)
    expect(contrast(token('foreground', theme), tint)).toBeGreaterThanOrEqual(4.5)
  })

  it('the old active colour (text-primary on that tint) was under 4.5:1 somewhere, so this test means something', () => {
    if (theme === 'dark') {
      const old = mix(OLD['primary']!.dark, token('card', theme), 0.1)
      expect(contrast(OLD['primary']!.dark, old)).toBeLessThan(4.5)
    }
  })

  it('patient-row badge: text-foreground on bg-muted is at least 4.5:1 (text-muted-foreground was not)', () => {
    expect(contrast(token('foreground', theme), token('muted', theme))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(OLD['muted-foreground']![theme], token('muted', theme))).toBeLessThan(4.5)
  })
})

it('"No state" badge: amber-800 on amber-100 is at least 4.5:1 with margin', () => {
  expect(contrast(hex('#92400e'), hex('#fef3c7'))).toBeGreaterThanOrEqual(6)
})

describe('the classes in the source', () => {
  it('the sidebar\'s active link uses text-foreground on the primary tint, not text-primary', () => {
    const src = read('src/components/sidebar-nav.tsx')
    expect(src).toContain("'bg-primary/10 text-foreground")
    expect(src).not.toMatch(/'bg-primary\/10 text-primary'/)
  })

  it('Select Patient\'s row badges: state on bg-muted uses text-foreground; "No state" uses amber-800', () => {
    const src = read('src/app/(clinic-app)/new-prescription/_components/patient-provider-selector.tsx')
    expect(src).not.toMatch(/bg-muted px-2 py-0\.5 text-\[10px\] font-medium text-muted-foreground/)
    expect(src).toMatch(/bg-muted px-2 py-0\.5 text-\[10px\] font-medium text-foreground/)
    expect(src).not.toMatch(/bg-amber-100 px-2 py-0\.5 text-\[10px\] font-medium text-amber-700/)
  })
})

// ── #227 run 3: selected-row and selected-card tints in Select Patient ──
// text-muted-foreground on bg-primary/10 (the selected patient / provider
// row) measured 4.11:1 light, 4.33:1 dark; on bg-primary/5 (the selected
// patient card) 4.40:1 light. Secondary text there is now text-foreground.
// The "No signature on file" note was amber-600 (3.19:1 on the card,
// 2.77:1 on the selected tint); now amber-800.
describe.each(['light', 'dark'] as const)('selected tints, %s', theme => {
  const card = () => token('card', theme)
  it.each([0.1, 0.05])('text-foreground on primary/%s over the card is at least 4.5:1', alpha => {
    expect(contrast(token('foreground', theme), mix(token('primary', theme), card(), alpha))).toBeGreaterThanOrEqual(4.5)
  })
})

it('light: muted text on the primary/10 and primary/5 tints was under 4.5:1 (what axe found)', () => {
  const card = token('card', 'light')
  expect(contrast(OLD['muted-foreground']!.light, mix(token('primary', 'light'), card, 0.1))).toBeLessThan(4.5)
  expect(contrast(OLD['muted-foreground']!.light, mix(token('primary', 'light'), card, 0.05))).toBeLessThan(4.5)
})

it('"No signature on file": amber-800 on the selected tint and on the card is at least 4.5:1 (amber-600 was not)', () => {
  const card = token('card', 'light')
  const tint = mix(token('primary', 'light'), card, 0.1)
  expect(contrast(hex('#92400e'), tint)).toBeGreaterThanOrEqual(4.5)
  expect(contrast(hex('#92400e'), card)).toBeGreaterThanOrEqual(4.5)
  expect(contrast(hex('#d97706'), card)).toBeLessThan(4.5)
})
