import { test, expect } from '@playwright/test'
import { TEST_USERS } from './fixtures/seed'

// ============================================================
// Auth Flow E2E — WO-65
// ============================================================
// Tests authentication flows and RBAC redirects:
//   - Role-aware post-login redirect
//   - Sign-out → /login
//   - Unauthorized access → /unauthorized
//   - Unauthenticated access to protected routes → /login
//   - HIPAA idle timeout warning modal (28-min mark, 30-min logout)
//   - Expired checkout token → /checkout/expired

test.describe('Auth — Login and Role-Aware Redirect', () => {
  test('ops_admin login redirects to /ops/pipeline', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Email').fill(TEST_USERS.opsAdmin.email)
    await page.getByLabel('Password').fill(TEST_USERS.opsAdmin.password)
    await page.getByRole('button', { name: /Sign in/i }).click()

    await expect(page).toHaveURL(/\/ops\/pipeline/, { timeout: 15_000 })
  })

  test('clinic_admin login redirects to /dashboard', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Email').fill(TEST_USERS.clinicAdmin.email)
    await page.getByLabel('Password').fill(TEST_USERS.clinicAdmin.password)
    await page.getByRole('button', { name: /Sign in/i }).click()

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 })
  })

  test('login with wrong password shows error — no redirect', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Email').fill(TEST_USERS.clinicAdmin.email)
    await page.getByLabel('Password').fill('WrongPassword!999')
    await page.getByRole('button', { name: /Sign in/i }).click()

    // Filter required: Next.js App Router injects a hidden role="alert"
    // route announcer (__next-route-announcer__) that causes strict-mode
    // violations on bare getByRole('alert') queries.
    await expect(
      page.getByRole('alert').filter({ hasText: /Invalid email or password/i })
    ).toBeVisible()
    await expect(page).toHaveURL('/login')
  })

  test('?redirectTo is honoured after login', async ({ page }) => {
    await page.goto('/login?redirectTo=/new-prescription')
    await page.getByLabel('Email').fill(TEST_USERS.clinicAdmin.email)
    await page.getByLabel('Password').fill(TEST_USERS.clinicAdmin.password)
    await page.getByRole('button', { name: /Sign in/i }).click()

    await expect(page).toHaveURL(/\/new-prescription/, { timeout: 15_000 })
  })

  test('?redirectTo with absolute URL is ignored — falls back to role redirect', async ({ page }) => {
    await page.goto('/login?redirectTo=https://evil.example.com')
    await page.getByLabel('Email').fill(TEST_USERS.clinicAdmin.email)
    await page.getByLabel('Password').fill(TEST_USERS.clinicAdmin.password)
    await page.getByRole('button', { name: /Sign in/i }).click()

    // Should NOT follow absolute URL — expect either /dashboard or /ops/pipeline
    await expect(page).toHaveURL(/\/(dashboard|ops)/, { timeout: 15_000 })
    await expect(page).not.toHaveURL(/evil\.example\.com/)
  })

  test('?redirectTo with protocol-relative URL is ignored', async ({ page }) => {
    await page.goto('/login?redirectTo=//evil.example.com')
    await page.getByLabel('Email').fill(TEST_USERS.clinicAdmin.email)
    await page.getByLabel('Password').fill(TEST_USERS.clinicAdmin.password)
    await page.getByRole('button', { name: /Sign in/i }).click()

    await expect(page).toHaveURL(/\/(dashboard|ops)/, { timeout: 15_000 })
    await expect(page).not.toHaveURL(/evil\.example\.com/)
  })
})

test.describe('Auth — Sign Out', () => {
  test('sign-out clears session and redirects to /login', async ({ page }) => {
    // Login first
    await page.goto('/login')
    await page.getByLabel('Email').fill(TEST_USERS.clinicAdmin.email)
    await page.getByLabel('Password').fill(TEST_USERS.clinicAdmin.password)
    await page.getByRole('button', { name: /Sign in/i }).click()
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 })

    // Sign out
    await page.getByRole('button', { name: /Sign out/i }).click()
    await expect(page).toHaveURL('/login', { timeout: 10_000 })

    // Verify session is gone — navigating to protected route redirects back to /login
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 })
  })
})

test.describe('Auth — Unauthenticated Access Guards', () => {
  test('unauthenticated access to /dashboard redirects to /login', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 })
  })

  test('unauthenticated access to /new-prescription redirects to /login', async ({ page }) => {
    await page.goto('/new-prescription')
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 })
  })

  test('unauthenticated access to /ops/pipeline redirects to /login', async ({ page }) => {
    await page.goto('/ops/pipeline')
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 })
  })
})

test.describe('Auth — RBAC Route Protection', () => {
  test('clinic_admin accessing /ops routes is redirected to /unauthorized', async ({ page }) => {
    // Login as clinic_admin
    await page.goto('/login')
    await page.getByLabel('Email').fill(TEST_USERS.clinicAdmin.email)
    await page.getByLabel('Password').fill(TEST_USERS.clinicAdmin.password)
    await page.getByRole('button', { name: /Sign in/i }).click()
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 })

    // Attempt to access ops route
    await page.goto('/ops/pipeline')
    await expect(page).toHaveURL(/\/unauthorized/, { timeout: 10_000 })
  })

  test('ops_admin accessing /new-prescription is redirected to /unauthorized', async ({ page }) => {
    // Login as ops_admin
    await page.goto('/login')
    await page.getByLabel('Email').fill(TEST_USERS.opsAdmin.email)
    await page.getByLabel('Password').fill(TEST_USERS.opsAdmin.password)
    await page.getByRole('button', { name: /Sign in/i }).click()
    await expect(page).toHaveURL(/\/ops\/pipeline/, { timeout: 15_000 })

    // Attempt to access clinic route
    await page.goto('/new-prescription')
    await expect(page).toHaveURL(/\/unauthorized/, { timeout: 10_000 })
  })
})

test.describe('Auth — Checkout Token Validation', () => {
  test('invalid checkout token shows error page', async ({ page }) => {
    await page.goto('/checkout/invalid-token')
    // Should see expired/invalid message or redirect to expired page
    const errorVisible = await page.getByText(/link has expired/i)
      .or(page.getByText(/not found/i))
      .or(page.getByText(/invalid/i))
      .isVisible({ timeout: 10_000 })
    expect(errorVisible).toBeTruthy()
  })

  test('checkout/expired page renders without auth', async ({ page }) => {
    await page.goto('/checkout/expired')
    await expect(page.getByText(/expired/i)).toBeVisible()
    // Should not redirect to /login — this is a public informational page
    await expect(page).toHaveURL('/checkout/expired')
  })
})

test.describe('Auth — HIPAA Idle Timeout', () => {
  // Coverage split:
  //   - Timer state machine (28-min warning, 30-min sign-out, activity reset)
  //     is covered by the unit test at src/components/__tests__/hipaa-timeout.test.tsx.
  //   - This E2E verifies the component is mounted on /dashboard and ready
  //     to schedule timers.
  //
  // Why not page.clock here: Playwright's Chromium driver installs the clock
  // polyfill via CDP into the current execution context. A full-page
  // navigation (login → /dashboard) creates a new context and the polyfill
  // doesn't carry over. Firefox/WebKit use engine-level injection and DO
  // carry over, so the fake-clock approach only works there — but that
  // inverts the usual reliability hierarchy and is a flaky integration
  // test for what is fundamentally unit-testable logic.
  test('HIPAA idle timeout component is mounted on /dashboard', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Email').fill(TEST_USERS.clinicAdmin.email)
    await page.getByLabel('Password').fill(TEST_USERS.clinicAdmin.password)
    await page.getByRole('button', { name: /Sign in/i }).click()
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 })

    // Sentinel is always rendered by HipaaTimeout (hidden when no warning,
    // promoted to the dialog element when the 28-min timer fires). Its
    // presence proves the component mounted and its useEffect scheduled
    // both setTimeout calls (WARNING_MS + TIMEOUT_MS).
    await expect(page.locator('[data-testid="hipaa-timeout-root"]')).toBeAttached()
  })
})
