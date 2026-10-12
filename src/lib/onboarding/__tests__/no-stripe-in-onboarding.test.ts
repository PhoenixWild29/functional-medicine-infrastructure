/**
 * @jest-environment node
 *
 * Payout setup is not live for onboarding: the payouts step shows
 * "Payout setup: available at launch" (disabled), and nothing in
 * onboarding imports Stripe, calls a Stripe route or reads Connect state.
 * Comments are stripped, so explaining this does not trip it.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOTS = [
  'src/app/onboarding',
  'src/app/onboard',
  'src/app/api/onboarding',
  'src/app/api/ops/onboarding',
  'src/app/(ops-dashboard)/ops/onboarding',
  'src/lib/onboarding',
  'src/components/onboarding',
]

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    if (name === '__tests__') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')

it('no onboarding code mentions Stripe', () => {
  const files = ROOTS.flatMap(r => walk(join(process.cwd(), r)))
  expect(files.length).toBeGreaterThan(10)
  const offenders = files
    .filter(f => /stripe/i.test(strip(readFileSync(f, 'utf8'))))
    .map(f => relative(process.cwd(), f).replace(/\\/g, '/'))
  expect(offenders).toEqual([])
})
