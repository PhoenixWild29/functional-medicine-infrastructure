// ============================================================
// The E2E job's Playwright image must match @playwright/test
// ============================================================
//
// The E2E job (.github/workflows/ci.yml) runs in
// mcr.microsoft.com/playwright:v<version>-noble, whose browsers are baked
// in for exactly that Playwright version. A Playwright bump without the
// same image bump would test against the wrong browsers (or fail to find
// them), so the job runs this right after npm ci and stops with a clear
// message on any mismatch. Also pinned by src/__tests__/
// ci-playwright-container.test.ts, so Jest catches it before E2E runs.
//
// Run from the repo root: node scripts/ci/check-playwright-image.mjs

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const fail = message => {
  console.error(`Playwright image check failed: ${message}`)
  process.exit(1)
}

const workflow = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8')
const image = workflow.match(/mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)-noble/)
if (!image) fail('.github/workflows/ci.yml has no mcr.microsoft.com/playwright image for the E2E job.')

const pkgPath = join(root, 'node_modules', '@playwright', 'test', 'package.json')
if (!existsSync(pkgPath)) fail('@playwright/test is not installed (run npm ci first).')
const installed = JSON.parse(readFileSync(pkgPath, 'utf8')).version

if (image[1] !== installed) {
  fail(
    `the E2E job runs in mcr.microsoft.com/playwright:v${image[1]}-noble, but @playwright/test ${installed} is installed. ` +
    `Change the image in .github/workflows/ci.yml to mcr.microsoft.com/playwright:v${installed}-noble ` +
    '(its browsers are built for exactly that version).',
  )
}

console.log(`Playwright image v${image[1]} matches @playwright/test ${installed}.`)
