/**
 * @jest-environment node
 *
 * The E2E job runs in the official Playwright image
 * (mcr.microsoft.com/playwright:v<version>-noble). Its browsers and OS
 * dependencies are baked in, so the job has no browser cache or
 * install-deps step (that step took ~31 s and could hang on the apt
 * mirror). The image's browsers belong to one Playwright version, so its
 * tag must equal the installed @playwright/test version:
 *   - this test fails on a mismatch (Jest runs on every PR, before E2E);
 *   - the E2E job's first step after npm ci runs
 *     scripts/ci/check-playwright-image.mjs, which fails with a clear
 *     message on a mismatch too.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const workflow = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8').replace(/\r\n/g, '\n')
const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8')) as { packages: Record<string, { version?: string }> }
const playwrightVersion = lock.packages['node_modules/@playwright/test']?.version

// The e2e job's text: from "  e2e:" to the next top-level job (or the end).
const e2eStart = workflow.search(/^ {2}e2e:\n/m)
const after = workflow.slice(e2eStart + 1)
const nextJob = after.search(/^ {2}[a-z][a-z0-9_-]*:\n/m)
const e2e = nextJob === -1 ? workflow.slice(e2eStart) : workflow.slice(e2eStart, e2eStart + 1 + nextJob)

it('the lockfile pins one @playwright/test version', () => {
  expect(playwrightVersion).toMatch(/^\d+\.\d+\.\d+$/)
  expect(lock.packages['node_modules/playwright']?.version).toBe(playwrightVersion)
})

it('the E2E job runs in the Playwright image for exactly that version', () => {
  const tags = [...workflow.matchAll(/mcr\.microsoft\.com\/playwright:v([0-9.]+)-noble/g)].map(m => m[1])
  expect(tags).toEqual([playwrightVersion])
  expect(e2e).toMatch(new RegExp(`\\n {4}container:\\n {6}image: mcr\\.microsoft\\.com/playwright:v${playwrightVersion!.replace(/\./g, '\\.')}-noble\\n`))
})

it('runs as the runner user (1001), as Playwright documents for GitHub Actions: Firefox refuses a root user with the runner-owned HOME', () => {
  expect(e2e).toMatch(/\n {6}options: --user 1001\n/)
})

it('no browser cache, browser install or install-deps step any more', () => {
  expect(e2e).not.toMatch(/ms-playwright|playwright install|install-deps|Cache Playwright browsers/)
})

it('checks the image against the installed version right after npm ci', () => {
  const npmCi = e2e.indexOf('run: npm ci')
  const guard = e2e.indexOf('run: node scripts/ci/check-playwright-image.mjs')
  expect(npmCi).toBeGreaterThan(-1)
  expect(guard).toBeGreaterThan(npmCi)
  expect(guard).toBeLessThan(e2e.indexOf('Sync E2E Supabase schema'))
})

it('keeps everything else: Node from setup-node, schema sync with the pinned CLI, build, tests, reports', () => {
  expect(e2e).toContain("node-version: ${{ env.NODE_VERSION }}")
  expect(e2e).toContain('npx supabase@2.120.0 db push --db-url "$E2E_DATABASE_URL" --include-all --yes')
  expect(e2e).toContain('run: npm run build')
  expect(e2e).toContain('run: npm run test:e2e')
  expect(e2e).toContain('name: playwright-report')
  expect(e2e).toContain('name: playwright-junit')
  expect(e2e).toContain('group: e2e-shared-supabase-project')
})

it('only the E2E job uses a container', () => {
  expect(workflow.match(/\n {4}container:\n/g)).toHaveLength(1)
})
