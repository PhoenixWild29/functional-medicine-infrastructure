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

export default defineConfig({
  testDir:     './e2e',
  testMatch:   '**/*.spec.ts',
  globalSetup: './e2e/global-setup',

  // Retry flaky tests in CI (network timeouts, async state transitions)
  retries: isCI ? 2 : 0,

  // Single worker in CI to prevent DB conflicts (orders share test data)
  workers: isCI ? 1 : 2,

  // Reporters: HTML report always; JUnit for CI artifact upload
  reporter: isCI
    ? [['html', { open: 'never' }], ['junit', { outputFile: 'test-results/junit.xml' }]]
    : [['html', { open: 'on-failure' }]],

  // Shared test options
  use: {
    baseURL: process.env['PLAYWRIGHT_BASE_URL'] ?? 'http://localhost:3000',

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
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testMatch: ['**/clinic-app.spec.ts', '**/ops-dashboard.spec.ts', '**/auth.spec.ts', '**/rbac.spec.ts', '**/feature-flags.spec.ts', '**/checkout.spec.ts'],
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
          command: 'npm run start',
          url: 'http://localhost:3000',
          reuseExistingServer: !isCI,
          timeout: 120_000,
        },
      }),
})
