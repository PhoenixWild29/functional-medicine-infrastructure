/**
 * WCAG 2.1 AA (1.4.3): the primary buttons and links on the pages under
 * the accessibility suites keep 4.5:1 in their hover state too.
 *
 * PR #212's E2E failed axe color-contrast on ".bg-primary" after a click
 * left the pointer on the MFA Verify button: hover:bg-primary/90 blends
 * the blue with the white page behind it, and white on that measured about
 * 4.34:1. hover:opacity-90 does the same, and hover:text-primary/80 drops
 * blue link text on white to about 3.6:1. Hover now uses --primary-hover,
 * a darker shade.
 */

import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '..', '..', '..')

const AUDITED = [
  'src/app/mfa/_components/mfa-shared.tsx',
  'src/app/mfa/_components/mfa-enroll.tsx',
  'src/app/mfa/_components/mfa-challenge.tsx',
  'src/app/unauthorized/page.tsx',
  'src/app/unauthorized/_components/sign-out-button.tsx',
  'src/components/session-guard-notice.tsx',
  'src/app/login/page.tsx',
  'src/app/checkout/[token]/_components/checkout-page-content.tsx',
  'src/app/checkout/success/page.tsx',
  'src/app/checkout/expired/page.tsx',
]

// A translucent primary, or a faded element, over the white page lightens
// the colour: the failing combination.
const FADED_HOVER = /hover:(?:bg|text)-primary\/\d+|hover:opacity-\d+/g

describe('primary hover states keep AA contrast', () => {
  it.each(AUDITED)('%s has no translucent or faded primary hover', file => {
    const src = readFileSync(join(ROOT, file), 'utf8')
    expect(src.match(FADED_HOVER) ?? []).toEqual([])
  })

  // ── The tokens themselves, measured ──────────────────────────
  function hslToRgb(h: number, s: number, l: number): [number, number, number] {
    s /= 100; l /= 100
    const k = (n: number) => (n + h / 30) % 12
    const a = s * Math.min(l, 1 - l)
    const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
    return [f(0) * 255, f(8) * 255, f(4) * 255]
  }
  function luminance([r, g, b]: [number, number, number]): number {
    const lin = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  }
  function contrast(a: [number, number, number], b: [number, number, number]): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
    return (hi + 0.05) / (lo + 0.05)
  }
  function token(name: string): [number, number, number] {
    // The light theme (:root), the first definition in globals.css.
    const css = readFileSync(join(ROOT, 'src/app/globals.css'), 'utf8')
    const m = css.match(new RegExp(`--${name}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`))
    if (!m) throw new Error(`--${name} not found in globals.css`)
    return hslToRgb(Number(m[1]), Number(m[2]), Number(m[3]))
  }
  const WHITE: [number, number, number] = [255, 255, 255]

  it('white text on --primary is at least 4.5:1', () => {
    expect(contrast(token('primary-foreground'), token('primary'))).toBeGreaterThanOrEqual(4.5)
  })

  it('white text on --primary-hover is at least 4.5:1', () => {
    expect(contrast(token('primary-foreground'), token('primary-hover'))).toBeGreaterThanOrEqual(4.5)
  })

  it('--primary-hover text on a white page is at least 4.5:1', () => {
    expect(contrast(token('primary-hover'), WHITE)).toBeGreaterThanOrEqual(4.5)
  })

  it('the old hover (90% primary over white) was below 4.5:1, so the test means something', () => {
    const p = token('primary')
    const blended = p.map((c, i) => 0.9 * c + 0.1 * WHITE[i]!) as [number, number, number]
    expect(contrast(WHITE, blended)).toBeLessThan(4.5)
  })
})
