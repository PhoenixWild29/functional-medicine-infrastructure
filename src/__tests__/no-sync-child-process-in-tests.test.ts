/**
 * @jest-environment node
 *
 * B-2026-10-26-10: no test blocks its worker with a synchronous child
 * process. execFileSync / execSync / spawnSync block the worker's event loop,
 * so jest's per-test timeout cannot fire: a slow or hung child stalls that
 * worker for as long as it takes (one did for 1,321 s in a loaded full run)
 * and, with no job timeout, could hold CI for hours. Use the async form with
 * a timeout, or check the file statically.
 *
 * B-2026-10-26-12: the scan covers the code tests run, not only *.test.ts:
 * every file under a __tests__ directory (helpers, fixtures, runners) and
 * the jest setup file. The PGlite helper (helpers/pglite-migrated.ts) used
 * spawnSync for up to 15 minutes and the *.test.ts-only scan missed it.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const SKIP = new Set(['node_modules', '.next', '.git', 'coverage', 'e2e'])
const SYNC_CHILD = /\b(execFileSync|execSync|spawnSync)\s*\(/
const CODE = /\.(tsx?|[cm]?js)$/

function testFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) testFiles(p, out)
    else if (/\.test\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

/** Every code file under a __tests__ directory: test files and what they import or run. */
function testSupportFiles(dir: string, out: string[] = [], inTests = false): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) testSupportFiles(p, out, inTests || name === '__tests__')
    else if (inTests && CODE.test(name)) out.push(p)
  }
  return out
}

const scanned = () => [...new Set([
  ...testFiles(join(ROOT, 'src')),
  ...testFiles(join(ROOT, 'eslint-rules')),
  ...testSupportFiles(join(ROOT, 'src')),
  ...testSupportFiles(join(ROOT, 'eslint-rules')),
  join(ROOT, 'jest.setup.ts'),
])]

it('no unit test, test helper or jest setup file spawns a synchronous child process', () => {
  const self = __filename
  const offenders = scanned()
    .filter(f => f !== self && SYNC_CHILD.test(readFileSync(f, 'utf8')))
    .map(f => relative(ROOT, f).split('\\').join('/'))
  expect(offenders).toEqual([])
})

it('the scan sees test files and helpers (it is not vacuous)', () => {
  expect(testFiles(join(ROOT, 'src')).length).toBeGreaterThan(100)
  expect(testFiles(join(ROOT, 'eslint-rules')).length).toBeGreaterThan(0)
  const helpers = scanned().map(f => relative(ROOT, f).split(sep).join('/'))
  expect(helpers).toEqual(expect.arrayContaining([
    'src/__tests__/helpers/pglite-migrated.ts',
    'src/__tests__/helpers/pglite-runner.mjs',
    'jest.setup.ts',
  ]))
})
