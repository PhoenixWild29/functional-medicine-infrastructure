/**
 * @jest-environment node
 *
 * scripts/ci/check-playwright-image.mjs: the E2E job's guard. It reads the
 * Playwright image tag from .github/workflows/ci.yml and the installed
 * @playwright/test version, and fails with a clear message when they
 * differ (a Playwright bump without an image bump would run the tests
 * against the wrong browsers, or none).
 */

import { execFile } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = join(process.cwd(), 'scripts', 'ci', 'check-playwright-image.mjs')

function fixture(imageVersion: string | null, installed: string | null) {
  const dir = mkdtempSync(join(tmpdir(), 'pw-guard-'))
  mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
  writeFileSync(join(dir, '.github', 'workflows', 'ci.yml'), imageVersion
    ? `jobs:\n  e2e:\n    container:\n      image: mcr.microsoft.com/playwright:v${imageVersion}-noble\n`
    : 'jobs:\n  e2e:\n    runs-on: ubuntu-latest\n')
  if (installed) {
    mkdirSync(join(dir, 'node_modules', '@playwright', 'test'), { recursive: true })
    writeFileSync(join(dir, 'node_modules', '@playwright', 'test', 'package.json'), JSON.stringify({ name: '@playwright/test', version: installed }))
  }
  return dir
}

// Async with a timeout, not execFileSync: a synchronous child blocks the
// jest worker so the per-test timeout cannot fire (B-2026-10-26-10,
// no-sync-child-process-in-tests).
function run(cwd: string): Promise<{ code: number; out: string }> {
  return new Promise(resolve => {
    execFile(process.execPath, [SCRIPT], { cwd, encoding: 'utf8', timeout: 20_000 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : -1) : 0
      resolve({ code, out: `${stdout}${stderr}` })
    })
  })
}

it('same version: passes and says so', async () => {
  const r = await run(fixture('1.58.2', '1.58.2'))
  expect(r.code).toBe(0)
  expect(r.out).toContain('Playwright image v1.58.2 matches @playwright/test 1.58.2')
})

it('a Playwright bump without an image bump: fails, naming both and what to change', async () => {
  const r = await run(fixture('1.58.2', '1.59.0'))
  expect(r.code).toBe(1)
  expect(r.out).toContain('mcr.microsoft.com/playwright:v1.58.2-noble')
  expect(r.out).toContain('@playwright/test 1.59.0')
  expect(r.out).toContain('mcr.microsoft.com/playwright:v1.59.0-noble')
})

it('no image in the workflow: fails', async () => {
  const r = await run(fixture(null, '1.58.2'))
  expect(r.code).toBe(1)
  expect(r.out).toMatch(/no mcr\.microsoft\.com\/playwright image/i)
})

it('@playwright/test not installed (npm ci not run): fails', async () => {
  const r = await run(fixture('1.58.2', null))
  expect(r.code).toBe(1)
  expect(r.out).toMatch(/@playwright\/test is not installed/)
})
