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

    await expect(page.getByRole('alert')).toContainText(/Invalid email or password/i)
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
  // NOTE: The full 28-minute idle timeout cannot be tested with real time in E2E.
  // This test verifies the idle timer modal EXISTS in the DOM and is triggered
  // by the inactivity mechanism when time is fast-forwarded via page.clock.
  test('idle timeout warning modal appears and auto-logout fires at 30 min', async ({ page }) => {
    // Login as clinic admin
    await page.goto('/login')
    await page.getByLabel('Email').fill(TEST_USERS.clinicAdmin.email)
    await page.getByLabel('Password').fill(TEST_USERS.clinicAdmin.password)
    await page.getByRole('button', { name: /Sign in/i }).click()
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 })

    // Install fake clock — freeze at "now"
    await page.clock.install({ time: Date.now() })

    // Fast-forward 28 minutes → warning modal should appear.
    // Uses getByRole('dialog', { name }) which resolves the accessible name
    // via aria-labelledby (the dialog's <h2 id="hipaa-timeout-title">).
    // This resolves to a single element, avoiding the strict-mode violation
    // that occurs with .or() unions that match both the dialog and a
    // descendant text node simultaneously.
    await page.clock.fastForward('28:00')
    const warningDialog = page.getByRole('dialog', { name: /Session Expiring Soon/i })
    await expect(warningDialog).toBeVisible({ timeout: 5_000 })

    // Dialog should still be present before the final 2-minute advance —
    // user hasn't interacted, so no reset can have fired.
    await expect(warningDialog).toBeVisible()

    // Fast-forward remaining 2 minutes → auto-logout
    await page.clock.fastForward('2:00')
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 })
  })
})
