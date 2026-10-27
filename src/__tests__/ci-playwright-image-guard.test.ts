/**
 * @jest-environment node
 *
 * scripts/ci/check-playwright-image.mjs: the E2E job's guard. It reads the
 * Playwright image tag from .github/workflows/ci.yml and the installed
 * @playwright/test version, and fails with a clear message when they
 * differ (a Playwright bump without an image bump would run the tests
 * against the wrong browsers, or none).
 */

import { execFileSync } from 'node:child_process'
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

function run(cwd: string): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [SCRIPT], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { code: 0, out }
  } catch (e) {
    const err = e as { status: number; stdout: string; stderr: string }
    return { code: err.status, out: `${err.stdout}${err.stderr}` }
  }
}

it('same version: passes and says so', () => {
  const r = run(fixture('1.58.2', '1.58.2'))
  expect(r.code).toBe(0)
  expect(r.out).toContain('Playwright image v1.58.2 matches @playwright/test 1.58.2')
})

it('a Playwright bump without an image bump: fails, naming both and what to change', () => {
  const r = run(fixture('1.58.2', '1.59.0'))
  expect(r.code).toBe(1)
  expect(r.out).toContain('mcr.microsoft.com/playwright:v1.58.2-noble')
  expect(r.out).toContain('@playwright/test 1.59.0')
  expect(r.out).toContain('mcr.microsoft.com/playwright:v1.59.0-noble')
})

it('no image in the workflow: fails', () => {
  const r = run(fixture(null, '1.58.2'))
  expect(r.code).toBe(1)
  expect(r.out).toMatch(/no mcr\.microsoft\.com\/playwright image/i)
})

it('@playwright/test not installed (npm ci not run): fails', () => {
  const r = run(fixture('1.58.2', null))
  expect(r.code).toBe(1)
  expect(r.out).toMatch(/@playwright\/test is not installed/)
})
