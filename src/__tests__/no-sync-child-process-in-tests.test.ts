/**
 * @jest-environment node
 *
 * B-2026-10-26-10: no test blocks its worker with a synchronous child
 * process. execFileSync / execSync / spawnSync block the worker's event loop,
 * so jest's per-test timeout cannot fire: a slow or hung child stalls that
 * worker for as long as it takes (one did for 1,321 s in a loaded full run)
 * and, with no job timeout, could hold CI for hours. Use the async form with
 * a timeout, or check the file statically.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const SKIP = new Set(['node_modules', '.next', '.git', 'coverage', 'e2e'])
const SYNC_CHILD = /\b(execFileSync|execSync|spawnSync)\s*\(/

function testFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) testFiles(p, out)
    else if (/\.test\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

it('no unit test spawns a synchronous child process', () => {
  const self = __filename
  const offenders = [...testFiles(join(ROOT, 'src')), ...testFiles(join(ROOT, 'eslint-rules'))]
    .filter(f => f !== self && SYNC_CHILD.test(readFileSync(f, 'utf8')))
    .map(f => relative(ROOT, f).split('\\').join('/'))
  expect(offenders).toEqual([])
})

it('the scan sees test files (it is not vacuous)', () => {
  expect(testFiles(join(ROOT, 'src')).length).toBeGreaterThan(100)
  expect(testFiles(join(ROOT, 'eslint-rules')).length).toBeGreaterThan(0)
})
