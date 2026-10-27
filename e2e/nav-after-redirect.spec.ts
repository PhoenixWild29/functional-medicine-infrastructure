import { createHash, randomBytes } from 'node:crypto'
import { test, expect, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { TEST_IDS, TEST_USERS } from './fixtures/seed'
import { shardPrefix } from './fixtures/shard'
import { e2ePassword } from './fixtures/test-password'

// ============================================================
// Navigation after the session changes, when the destination was redirected
// ============================================================
//
// Since Next 16.3 the client router reuses a redirect it already saw for a
// route in the same tab. So a page that was redirected to /login while
// signed out must still open after signing in (or after accepting an
// invite): the pages continue with a full navigation (lib/auth/
// full-navigation), which always reaches the middleware with the new
// session.
//
// Each test first lets the destination be redirected: a full load while
// signed out, then a client-router navigation to it (window.next.router,
// when the page exposes it), which is what the client router remembers.
//
// Data: the invite test inserts its own invite in the test clinic with the
// service role (a reserved nav-e2e- email) and deletes it and the login it
// creates in beforeAll and afterAll.

// Per shard (fixtures/shard): cleanup sweeps this prefix, so each shard sweeps only its own.
const EMAIL_PREFIX = shardPrefix('nav-e2e-')
const PASSWORD = e2ePassword()

function e2eService() {
  return createClient(process.env['E2E_SUPABASE_URL']!, process.env['E2E_SUPABASE_SERVICE_ROLE_KEY']!)
}

async function cleanup() {
  const db = e2eService()
  const invites = await db.from('onboarding_invites').delete().eq('clinic_id', TEST_IDS.clinic).like('email', `${EMAIL_PREFIX}%`)
  if (invites.error) throw new Error(`nav-after-redirect cleanup (invites): ${invites.error.message}`)
  const { data, error } = await db.auth.admin.listUsers({ perPage: 1000 })
  if (error) throw new Error(`nav-after-redirect cleanup (users): ${error.message}`)
  for (const u of data.users) {
    if (!u.email?.startsWith(EMAIL_PREFIX)) continue
    const del = await db.auth.admin.deleteUser(u.id)
    if (del.error) throw new Error(`nav-after-redirect cleanup (delete user): ${del.error.message}`)
  }
}

/** A client-router navigation, so the router sees (and remembers) the redirect. */
async function clientNavigate(page: Page, path: string) {
  await page.evaluate(p => {
    const router = (window as unknown as { next?: { router?: { push: (href: string) => void } } }).next?.router
    router?.push(p)
  }, path)
  await page.waitForTimeout(1_000)
}

test.beforeAll(cleanup)
test.afterAll(cleanup)

test.describe('Navigation after a redirect', () => {
  test('signed out, /practice is sent to /login?redirectTo; after signing in the clinic admin lands on /practice', async ({ page }) => {
    await page.goto('/practice')
    await expect(page).toHaveURL(/\/login\?redirectTo=%2Fpractice$/, { timeout: 15_000 })

    // The client router now sees /practice redirect to /login.
    await clientNavigate(page, '/practice')
    await expect(page).toHaveURL(/\/login/)

    await page.getByLabel('Email address').fill(TEST_USERS.clinicAdmin.email)
    await page.getByLabel('Password', { exact: true }).fill(TEST_USERS.clinicAdmin.password)
    await page.getByRole('button', { name: 'Sign in' }).click()

    await expect(page).toHaveURL(/\/practice$/, { timeout: 15_000 })
    await expect(page.getByRole('heading', { name: 'Practice Dashboard' })).toBeVisible({ timeout: 15_000 })
  })

  test('signed out, the app redirects to /login; after accepting an invite in the same tab the new member lands in the app', async ({ page }) => {
    // An invite for a medical assistant in the test clinic, by its token's hash.
    const token = randomBytes(32).toString('base64url')
    const email = `${EMAIL_PREFIX}${Date.now().toString(36)}@compoundiq.test`
    const { error } = await e2eService().from('onboarding_invites').insert({
      kind: 'medical_assistant', clinic_id: TEST_IDS.clinic, email,
      token_hash: createHash('sha256').update(token).digest('hex'),
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      created_by: '00000000-0000-4000-8000-000000000000',
    })
    expect(error).toBeNull()

    // The app's destinations are redirected while signed out.
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 })
    await clientNavigate(page, '/')
    await clientNavigate(page, '/dashboard')
    await expect(page).toHaveURL(/\/login/)

    // Accept the invite in the same tab.
    await page.goto(`/onboard/join/${token}`)
    await expect(page.getByRole('heading', { level: 1, name: /Join .* on CompoundIQ/ })).toBeVisible({ timeout: 15_000 })
    await page.getByLabel('Full name').fill('Nav Spec Assistant')
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
    await page.getByLabel('Confirm password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Create account' }).click()

    // Lands signed in, not on /login. B's review P2: a login created from an
    // invite first sets its own password from an emailed link, so the app
    // sends it to /reset-password before its home page.
    await expect(page).toHaveURL(/\/reset-password$/, { timeout: 20_000 })
    await expect(page.getByRole('link', { name: 'Email me a link' })).toBeVisible()
  })
})
