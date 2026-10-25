/**
 * @jest-environment node
 *
 * Every page under src/app has an error boundary that fits its audience
 * (the nearest error.tsx above it), and the app has a global-error.tsx and
 * a root not-found.tsx. A new top-level section without its own boundary
 * falls to the public one (sign-in links), which is wrong for staff and
 * patients, so the expected boundary for each page is pinned here.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const APP = join(process.cwd(), 'src', 'app')
const pages: string[] = []
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) { if (name !== '__tests__' && name !== 'api') walk(full); continue }
    if (name === 'page.tsx') pages.push(relative(APP, dir).split(sep).join('/'))
  }
}
walk(APP)

const nearestBoundary = (route: string): string => {
  const parts = route ? route.split('/') : []
  for (let i = parts.length; i >= 0; i--) {
    const dir = parts.slice(0, i).join('/')
    if (existsSync(join(APP, dir, 'error.tsx'))) return dir || '(root)'
  }
  return 'none'
}

// The boundary each section must use.
const expected = (route: string): string => {
  if (route.startsWith('(clinic-app)')) return '(clinic-app)'
  if (route.startsWith('(ops-dashboard)')) return '(ops-dashboard)'
  if (route.startsWith('pharmacy')) return 'pharmacy'
  for (const patient of ['checkout', 'intake', 'plan', 'join']) if (route.startsWith(patient)) return patient
  return '(root)'
}

it('global-error.tsx and the root not-found.tsx exist', () => {
  expect(existsSync(join(APP, 'global-error.tsx'))).toBe(true)
  expect(existsSync(join(APP, 'not-found.tsx'))).toBe(true)
  expect(readFileSync(join(APP, 'global-error.tsx'), 'utf8')).toMatch(/<html lang="en">/)
})

it('finds the pages', () => {
  expect(pages.length).toBeGreaterThan(50)
})

it.each(pages.map(p => [p || '/']))('%s', route => {
  const r = route === '/' ? '' : route
  expect(nearestBoundary(r)).toBe(expected(r))
})

it('patient boundaries show no reference and no link', () => {
  for (const dir of ['checkout', 'intake', 'plan', 'join', '(patient-checkout)']) {
    const src = readFileSync(join(APP, dir, 'error.tsx'), 'utf8')
    expect(src).toContain('error-screen-patient')
    expect(src).not.toMatch(/reference=|href:/)
  }
})

it('no boundary renders the error message', () => {
  const files = ['error.tsx', 'global-error.tsx', '(clinic-app)/error.tsx', '(ops-dashboard)/error.tsx', 'pharmacy/error.tsx', 'checkout/error.tsx', 'intake/error.tsx', 'plan/error.tsx', 'join/error.tsx', '(patient-checkout)/error.tsx']
  for (const f of files) expect({ f, rendersMessage: /error\.message/.test(readFileSync(join(APP, f), 'utf8')) }).toEqual({ f, rendersMessage: false })
})
