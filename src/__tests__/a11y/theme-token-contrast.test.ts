/**
 * @jest-environment node
 *
 * WCAG 2.1 AA (1.4.3, 4.5:1): the theme tokens in globals.css, measured in
 * both themes. The light theme is :root (clinic, patient and pharmacy
 * pages); the dark theme is .dark, which the (ops-dashboard) layout puts
 * on every ops page.
 *
 * The staff contrast pass (Issue Log: staff-contrast, Oct 27) found, in
 * the browser axe runs:
 *   - --muted-foreground on --muted under 4.5:1 in both themes (4.40:1
 *     light, 4.19:1 dark): muted badges, chips and table headers;
 *   - white on the dark --primary (3.63:1): every solid primary button on
 *     an ops page;
 *   - --destructive as text under 4.5:1 in both themes;
 *   - ops text with no colour of its own inheriting the body's light-theme
 *     foreground (near black) on the dark background.
 * The tokens now pass everywhere they are paired, and the ops wrapper sets
 * text-foreground. e2e/accessibility-all-routes.spec.ts measures the real
 * pages in Chromium, with contrast enforced on every route.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..', '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

type RGB = [number, number, number]
type Theme = 'light' | 'dark'

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

const CSS = read('src/app/globals.css')
/** A token from :root (light) or .dark; .dark falls back to :root when it does not set one. */
function token(name: string, theme: Theme): RGB {
  const split = CSS.indexOf('.dark {')
  const blocks = theme === 'light' ? [CSS.slice(0, split)] : [CSS.slice(split), CSS.slice(0, split)]
  for (const block of blocks) {
    const m = block.match(new RegExp(`--${name}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`))
    if (m) return hslToRgb(Number(m[1]), Number(m[2]), Number(m[3]))
  }
  throw new Error(`--${name} not found (${theme})`)
}

// [text token, background token]: every pairing the components use.
const PAIRS: Array<[string, string]> = [
  ['foreground', 'background'],
  ['card-foreground', 'card'],
  ['popover-foreground', 'popover'],
  ['muted-foreground', 'background'],
  ['muted-foreground', 'card'],
  ['muted-foreground', 'muted'],
  ['muted-foreground', 'secondary'],
  ['muted-foreground', 'accent'],
  ['secondary-foreground', 'secondary'],
  ['accent-foreground', 'accent'],
  ['primary-foreground', 'primary'],
  ['primary-foreground', 'primary-hover'],
  ['primary', 'background'],
  ['primary', 'card'],
  ['primary', 'muted'],
  ['destructive-foreground', 'destructive'],
  ['destructive', 'background'],
  ['destructive', 'card'],
]

describe.each(['light', 'dark'] as const)('%s theme tokens', theme => {
  it.each(PAIRS)('--%s on --%s is at least 4.5:1', (fg, bg) => {
    expect(contrast(token(fg, theme), token(bg, theme))).toBeGreaterThanOrEqual(4.5)
  })

  it.each([0.3, 0.5])('--muted-foreground on --muted/%s over the card is at least 4.5:1', alpha => {
    expect(contrast(token('muted-foreground', theme), mix(token('muted', theme), token('card', theme), alpha))).toBeGreaterThanOrEqual(4.5)
  })

  it('--primary-hover text on the primary/10 tint over the card is at least 4.5:1 (selected chips and avatars)', () => {
    const tint = mix(token('primary', theme), token('card', theme), 0.1)
    expect(contrast(token('primary-hover', theme), tint)).toBeGreaterThanOrEqual(4.5)
  })
})

it('dark: --primary-foreground on a 90% --primary (a leftover hover:bg-primary/90) is still at least 4.5:1', () => {
  expect(contrast(token('primary-foreground', 'dark'), mix(token('primary', 'dark'), token('background', 'dark'), 0.9))).toBeGreaterThanOrEqual(4.5)
})

describe('the tokens before this pass failed, so these checks mean something', () => {
  it('muted on muted, white on the dark primary, and light red-500 text', () => {
    expect(contrast(hslToRgb(215, 16, 47), hslToRgb(210, 40, 97))).toBeLessThan(4.5)
    expect(contrast(hslToRgb(220, 20, 55), hslToRgb(222, 35, 16))).toBeLessThan(4.5)
    expect(contrast(hex('#FFFFFF'), hslToRgb(217, 91, 60))).toBeLessThan(4.5)
    expect(contrast(hslToRgb(0, 84, 60), hex('#FFFFFF'))).toBeLessThan(4.5)
  })
})

describe('ops dark theme in the source', () => {
  it('the .dark wrapper sets text-foreground, so unstyled text is not the body\'s near-black', () => {
    const layout = read('src/app/(ops-dashboard)/layout.tsx')
    expect(layout).toMatch(/className="dark [^"]*\btext-foreground\b/)
  })

  it('status badge text: every light colour has a dark counterpart at 4.5:1 or more on the dark card', () => {
    const src = read('src/components/ui/status-badge.tsx')
    const pairs = [...src.matchAll(/'(#[0-9A-F]{6})': '(#[0-9A-F]{6})'/g)]
    expect(pairs.length).toBeGreaterThan(5)
    for (const [, light, dark] of pairs) {
      expect(contrast(hex(light!), hex('#FFFFFF'))).toBeGreaterThanOrEqual(4.5)
      expect(contrast(hex(dark!), token('card', 'dark'))).toBeGreaterThanOrEqual(4.5)
      expect(contrast(hex(dark!), token('muted', 'dark'))).toBeGreaterThanOrEqual(4.5)
    }
  })

  // Light tints (bg-*-50/100/200) and -500..-900 text are light-theme
  // status colours; on an ops page each class list needs its dark: variant
  // (-950/40 tint, -300 text, 9:1 or more on the dark surfaces).
  it('every ops class list with a light status colour has its dark: variant', () => {
    const HUE = 'red|emerald|green|amber|yellow|orange|blue|sky|indigo|purple|violet|cyan|teal|pink|rose'
    const lightText = new RegExp(`(?<![\\w:-])text-(${HUE})-(500|600|700|800|900|950)\\b`)
    const lightTint = new RegExp(`(?<![\\w:-])bg-(${HUE})-(50|100|200)\\b`)
    const files: string[] = []
    const walk = (dir: string) => {
      for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
        const p = `${dir}/${e.name}`
        if (e.isDirectory()) { if (e.name !== '__tests__') walk(p) } else if (p.endsWith('.tsx')) files.push(p)
      }
    }
    walk('src/app/(ops-dashboard)')
    const missing: string[] = []
    for (const f of files) {
      for (const [lit] of read(f).matchAll(/'[^'\n]*'|"[^"\n]*"/g)) {
        if (lightText.test(lit) && !/dark:text-/.test(lit)) missing.push(`${f}: ${lit}`)
        if (lightTint.test(lit) && !/dark:bg-/.test(lit)) missing.push(`${f}: ${lit}`)
      }
    }
    expect(files.length).toBeGreaterThan(20)
    expect(missing).toEqual([])
  })
})
