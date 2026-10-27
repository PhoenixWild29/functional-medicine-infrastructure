import { defineConfig, devices } from '@playwright/test'

// ============================================================
// Playwright E2E Test Configuration — WO-42
// ============================================================
//
// Three test suites covering critical user flows:
//   - Clinic App (medical assistant workflow)
//   - Patient Checkout (mobile checkout flow)
//   - Ops Dashboard (SLA triage and reroute)
//
// CI mode: single worker, 2 retries, headless.
// Local dev: 2 workers, 0 retries, headed optional.

const isCI = !!process.env['CI']

// ── Shards ───────────────────────────────────────────────────
// `--shard=1/2` and `--shard=2/2` can run at the same time against the ONE
// E2E Supabase project: e2e/fixtures/shard.ts gives each shard its own
// clinic, providers, patients and logins (shard 1 keeps today's), read
// from TEST_SHARD. That is set here, from --shard, before globalSetup, the
// web server and the workers start (each inherits this process's env).
function cliShard(): { current: number; total: number } | null {
  const argv = process.argv
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    const v = a.startsWith('--shard=') ? a.slice('--shard='.length) : a === '--shard' ? argv[i + 1] : undefined
    const m = v ? /^(\d+)\/(\d+)$/.exec(v) : null
    if (m) return { current: Number(m[1]), total: Number(m[2]) }
  }
  return null
}
const shardFromCli = cliShard()
if (shardFromCli && !process.env['TEST_SHARD']) {
  process.env['TEST_SHARD'] = String(shardFromCli.current)
  process.env['TEST_SHARD_TOTAL'] = String(shardFromCli.total)
}
const sharded = Number(process.env['TEST_SHARD_TOTAL'] ?? '1') > 1
const shard = Number(process.env['TEST_SHARD'] ?? '1')
// Shard N's server listens on 3000 + N - 1, so two shards can run on one
// machine. Unsharded (and shard 1): 3000, exactly as before.
const port = sharded ? 3000 + shard - 1 : 3000
const localBaseURL = `http://localhost:${port}`
if (sharded) {
  // Links the app builds (intake, checkout) and specs that read it point
  // at this shard's server.
  process.env['APP_BASE_URL'] = localBaseURL
}
// Two shards on one machine write their results side by side.
const shardSuffix = sharded ? `-shard-${shard}` : ''

// SERIAL_REASONS: describes tagged @serial change app-wide state that
// per-shard data cannot isolate (table-wide RPCs over every provider's
// favorites, every protocol item, the whole catalog; an offer on a shared
// pharmacy). When sharded they run in the 'serial' project, listed first:
// Playwright cuts one ordered list of (project, file) groups into
// contiguous slices, and a group belongs to the shard its first test
// falls in, so a first project holding under half the tests always runs
// whole on shard 1. Unsharded, nothing changes.
const SERIAL = /@serial/

export default defineConfig({
  testDir:     './e2e',
  outputDir:   `test-results${shardSuffix}`,
  testMatch:   '**/*.spec.ts',
  globalSetup: './e2e/global-setup',

  // Retry flaky tests in CI (network timeouts, async state transitions)
  retries: isCI ? 2 : 0,

  // Single worker in CI to prevent DB conflicts (orders share test data)
  workers: isCI ? 1 : 2,

  // Reporters: HTML report always; JUnit for CI artifact upload
  reporter: isCI
    // 'github' writes each failure as a check-run annotation, readable
    // without downloading the (auth-gated) report artifact. 'list' prints
    // each test's result as it finishes, so a run cut off by the job
    // timeout still shows which tests passed, failed or hung (html, junit
    // and github write nothing until the run ends).
    ? [['list'], ['html', { open: 'never', outputFolder: `playwright-report${shardSuffix}` }], ['junit', { outputFile: `test-results${shardSuffix}/junit.xml` }], ['github']]
    : [['html', { open: 'on-failure' }]],

  // Shared test options
  use: {
    baseURL: process.env['PLAYWRIGHT_BASE_URL'] ?? localBaseURL,

    // Capture screenshot on failure for debugging
    screenshot: 'only-on-failure',

    // Record trace on retry for detailed debugging
    trace: 'on-first-retry',

    // Video capture on failure
    video: 'retain-on-failure',
  },

  // Global test timeout
  timeout: 60_000,

  // Projects: desktop web (Chromium, Firefox, WebKit) and mobile checkout
  projects: [
    ...(sharded ? [{
      name: 'serial',
      use: { ...devices['Desktop Chrome'] },
      testMatch: ['**/clinic-app.spec.ts'],
      grep: SERIAL,
    }] : []),
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      ...(sharded ? { grepInvert: SERIAL } : {}),
      testMatch: ['**/clinic-app.spec.ts', '**/ops-dashboard.spec.ts', '**/auth.spec.ts', '**/rbac.spec.ts', '**/feature-flags.spec.ts', '**/checkout.spec.ts', '**/accessibility.spec.ts', '**/accessibility-all-routes.spec.ts', '**/accessibility-auth.spec.ts', '**/pharmacy-onboarding-a11y.spec.ts', '**/mfa.spec.ts', '**/legal-pages-a11y.spec.ts', '**/intake.spec.ts', '**/patient-import.spec.ts', '**/ehr-sync-keragon.spec.ts', '**/patient-signup-link.spec.ts', '**/self-serve-signup.spec.ts', '**/team-invites.spec.ts', '**/first-run-checklist.spec.ts', '**/face-sheet-fill.spec.ts', '**/nav-after-redirect.spec.ts', '**/order-failure-reason.spec.ts', '**/upload-size-limit.spec.ts', '**/clinic-onboarding-status.spec.ts', '**/patient-protocol-choice.spec.ts', '**/error-pages.spec.ts', '**/patient-pages-mobile.spec.ts', '**/practitioner-requirements.spec.ts', '**/keyboard-core-flows.spec.ts'],
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      // Core auth and checkout flows on Firefox
      testMatch: ['**/auth.spec.ts', '**/checkout.spec.ts'],
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      // Core auth and checkout flows on WebKit/Safari
      testMatch: ['**/auth.spec.ts', '**/checkout.spec.ts'],
    },
    {
      name: 'mobile-chrome',
      use: {
        ...devices['Pixel 5'],
        viewport: { width: 375, height: 812 },
      },
      testMatch: '**/checkout.spec.ts',
    },
  ],

  // Start the production Next.js server if PLAYWRIGHT_BASE_URL is not set.
  // CI must run `npm run build` before this step; `npm run start` cold-boots in
  // under 10s and avoids next dev's HMR compilation flakiness that has
  // previously hung the E2E job for 50+ minutes.
  ...(process.env['PLAYWRIGHT_BASE_URL']
    ? {}
    : {
        webServer: {
          command: port === 3000 ? 'npm run start' : `npm run start -- -p ${port}`,
          url: localBaseURL,
          reuseExistingServer: !isCI,
          timeout: 120_000,
        },
      }),
})
