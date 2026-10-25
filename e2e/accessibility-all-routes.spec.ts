import { test, expect, type Browser, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { createClient } from '@supabase/supabase-js'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { cleanupTestOrders, seedStaticData, TEST_IDS, TEST_USERS } from './fixtures/seed'

// ============================================================
// WCAG 2.1 AA on every route a user can reach, per role, real browser
// ============================================================
//
// axe (wcag2a, wcag2aa, wcag21a, wcag21aa; contrast included) on each page
// a role can open, plus the dialog and drawer states that matter: the
// order drawer on the clinic dashboard and in the ops pipeline. Any
// violation fails CI.
//
// Cost: each role signs in ONCE (beforeAll) and its storage state is
// reused, so every test below is one page load and one axe run.
//
// Not here, because other specs already run axe on them with the data
// they need (and a page they set up):
//   - /checkout/[token] (open, paid, cancelled), /checkout/success,
//     /checkout/expired (invalid token), /login, /onboarding,
//     /onboard/clinic/[token], /onboard/join/[token], /ops/onboarding:
//     accessibility.spec.ts
//   - /mfa/enroll, /mfa/challenge, /ops/pipeline (MFA user):
//     accessibility-auth.spec.ts
//   - /onboard/pharmacy/[token], /pharmacy/onboarding (every step),
//     /ops/onboarding/pharmacies and [applicationId]: pharmacy-onboarding-a11y
//   - /legal/privacy, /legal/patient-terms: legal-pages-a11y.spec.ts
//   - /get-started, /ops/onboarding/[clinicId] (a self sign-up in review):
//     self-serve-signup.spec.ts
//   - /intake/[token]: intake.spec.ts; /join/[token]: patient-signup-link
//   - /settings/team dialogs (invite, add provider, deactivate):
//     team-invites.spec.ts
// The prescription steps after search (margin, review, sign, sign/[id])
// need a prescription session built in the browser; clinic-app.spec.ts
// walks them, and jsdom axe tests cover their components. Loaded cold
// they redirect to /new-prescription, which is scanned below.

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']
// Stripe's Payment Element is a cross-origin iframe Stripe owns.
const STRIPE_FRAMES = 'iframe[name^="__privateStripeFrame"], iframe[src*="js.stripe.com"]'
const AUTH_DIR = join('test-results', '.auth-a11y')

const MA_USER = { email: 'test-a11y-ma@compoundiq.test', password: 'TestPassword123!' }

function e2eService() {
  return createClient(process.env['E2E_SUPABASE_URL']!, process.env['E2E_SUPABASE_SERVICE_ROLE_KEY']!)
}

async function axeViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).exclude(STRIPE_FRAMES).analyze()
  return results.violations.map(v => `${v.id} (${v.impact}): ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)
}

/** The page is rendered: its main landmark and h1 are on screen, and client data has had a moment. */
async function settle(page: Page) {
  await expect(page.locator('main').first()).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('h1').first()).toBeVisible({ timeout: 20_000 })
  await page.waitForLoadState('load')
  // Lists load after first paint (polling, React Query); give them one beat.
  await page.waitForTimeout(750)
}

async function saveSignIn(browser: Browser, role: string, user: { email: string; password: string }, landing: RegExp): Promise<string> {
  mkdirSync(AUTH_DIR, { recursive: true })
  const path = join(AUTH_DIR, `${role}.json`)
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto('/login')
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill(user.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(landing, { timeout: 20_000 })
  await context.storageState({ path })
  await context.close()
  return path
}

async function ensureMedicalAssistant(): Promise<void> {
  const db = e2eService()
  const appMetadata = { app_role: 'medical_assistant', clinic_id: TEST_IDS.clinic }
  const { data, error } = await db.auth.admin.listUsers({ perPage: 1000 })
  if (error) throw new Error(`listUsers: ${error.message}`)
  const existing = data.users.find(u => u.email === MA_USER.email)
  if (existing) {
    const { error: updateError } = await db.auth.admin.updateUserById(existing.id, { password: MA_USER.password, app_metadata: appMetadata, ban_duration: 'none' })
    if (updateError) throw new Error(`update MA: ${updateError.message}`)
    return
  }
  const { error: createError } = await db.auth.admin.createUser({ email: MA_USER.email, password: MA_USER.password, email_confirm: true, app_metadata: appMetadata })
  if (createError) throw new Error(`create MA: ${createError.message}`)
}

async function removeMedicalAssistant(): Promise<void> {
  const db = e2eService()
  const { data } = await db.auth.admin.listUsers({ perPage: 1000 })
  const existing = data?.users.find(u => u.email === MA_USER.email)
  if (existing) await db.auth.admin.deleteUser(existing.id)
}

/** One order for the drawer states (clinic dashboard and ops pipeline). */
async function insertDrawerOrder(): Promise<string> {
  const { data, error } = await e2eService()
    .from('orders')
    .insert({
      patient_id: TEST_IDS.patient, provider_id: TEST_IDS.provider, catalog_item_id: TEST_IDS.catalogItem,
      clinic_id: TEST_IDS.clinic, pharmacy_id: TEST_IDS.pharmacyTier1, status: 'PAID_PROCESSING', quantity: 1,
      wholesale_price_snapshot: 100.00, retail_price_snapshot: 200.00,
      medication_snapshot: { medication_name: 'Test Compound Injectable' },
      pharmacy_snapshot: { pharmacy_id: TEST_IDS.pharmacyTier1, name: 'Test Pharmacy Tier1' },
      sig_text: 'Inject 10 units weekly, accessibility drawer order', locked_at: new Date().toISOString(),
    })
    .select('order_id')
    .single()
  if (error || !data) throw new Error(`drawer order: ${error?.message}`)
  return data.order_id as string
}

type RoleRoutes = { role: string; user: { email: string; password: string }; landing: RegExp; routes: string[] }

const ROLES: RoleRoutes[] = [
  {
    role: 'clinic_admin', user: TEST_USERS.clinicAdmin, landing: /\/practice$/,
    routes: [
      '/practice', '/dashboard', '/new-prescription', '/protocols/new', '/refill',
      '/settings', '/settings/access-log', '/settings/agreements', '/settings/integrations',
      '/settings/patients/import', '/settings/patients/signup-link', '/settings/team',
      // A clinic admin opening an ops page is sent here.
      '/unauthorized',
    ],
  },
  {
    role: 'provider', user: TEST_USERS.provider, landing: /\/dashboard/,
    routes: ['/dashboard', '/new-prescription', '/new-prescription/sign', '/protocols/new', '/refill', '/settings'],
  },
  {
    role: 'medical_assistant', user: MA_USER, landing: /\/dashboard/,
    routes: ['/dashboard', '/new-prescription', '/refill', '/settings', '/settings/patients/import', '/settings/patients/signup-link'],
  },
  {
    role: 'ops_admin', user: TEST_USERS.opsAdmin, landing: /\/ops\/pipeline/,
    routes: [
      '/ops/pipeline', '/ops/sla', '/ops/adapters', '/ops/catalog', '/ops/demo-tools', '/ops/fax',
      '/ops/ingredients', '/ops/integrations', '/ops/licensure', '/ops/payables',
      `/ops/onboarding/${TEST_IDS.clinic}`,
    ],
  },
]

const SIGNED_OUT = ['/login', '/get-started', '/legal/privacy', '/legal/patient-terms', '/checkout/expired']

const storage: Record<string, string> = {}
function stateFor(role: string): string {
  const path = storage[role]
  if (!path) throw new Error(`no saved sign-in for ${role}`)
  return path
}
let drawerOrderId = ''

test.beforeAll(async ({ browser }) => {
  await seedStaticData()
  await ensureMedicalAssistant()
  drawerOrderId = await insertDrawerOrder()
  for (const r of ROLES) storage[r.role] = await saveSignIn(browser, r.role, r.user, r.landing)
})

test.afterAll(async () => {
  await cleanupTestOrders()
  await removeMedicalAssistant()
})

test.describe('WCAG 2.1 AA, signed out', () => {
  for (const route of SIGNED_OUT) {
    test(`signed out: ${route}`, async ({ page }) => {
      await page.goto(route)
      await settle(page)
      expect(await axeViolations(page)).toEqual([])
    })
  }
})

for (const r of ROLES) {
  test.describe(`WCAG 2.1 AA, ${r.role}`, () => {
    for (const route of r.routes) {
      test(`${r.role}: ${route}`, async ({ browser }) => {
        const context = await browser.newContext({ storageState: stateFor(r.role) })
        const page = await context.newPage()
        await page.goto(route)
        await settle(page)
        expect(await axeViolations(page)).toEqual([])
        await context.close()
      })
    }
  })
}

test.describe('WCAG 2.1 AA, drawers', () => {
  test('clinic_admin: the order drawer on the dashboard', async ({ browser }) => {
    const context = await browser.newContext({ storageState: stateFor('clinic_admin') })
    const page = await context.newPage()
    await page.goto('/dashboard')
    await settle(page)
    await page.locator(`[data-order-id="${drawerOrderId}"]`).first().click()
    await expect(page.getByRole('dialog').first()).toBeVisible({ timeout: 15_000 })
    await page.waitForTimeout(500)
    expect(await axeViolations(page)).toEqual([])
    await context.close()
  })

  test('ops_admin: the order drawer in the pipeline', async ({ browser }) => {
    const context = await browser.newContext({ storageState: stateFor('ops_admin') })
    const page = await context.newPage()
    await page.goto(`/ops/pipeline?order=${drawerOrderId}`)
    await settle(page)
    await expect(page.getByRole('dialog').first()).toBeVisible({ timeout: 15_000 })
    await page.waitForTimeout(500)
    expect(await axeViolations(page)).toEqual([])
    await context.close()
  })
})
