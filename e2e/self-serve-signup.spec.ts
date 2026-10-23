import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { TEST_USERS } from './fixtures/seed'
import { npiChecksumValid } from '../src/lib/providers/npi'

// ============================================================
// Self sign-up: /login > Get started > lands in the app, pending review
// ============================================================
//
// For each entry point (solo provider, clinic, pharmacy): the visitor signs
// up from /login with no invite and lands in the product at once. A clinic
// under review sees the banner on every page; New Prescription opens, and
// saving a draft or signing is refused on the server with the banner's
// words. A pharmacy goes to its portal (two-step setup first, as always for
// pharmacies) and stays inactive. Ops sees each one labelled "Signed up on
// their own", with a new count on the tab.
//
// Data: reserved @compoundiq.test emails with this run's id. Cleanup in
// beforeAll and afterAll (service role, E2E project only) removes the
// logins, providers, licenses, wizard steps, pharmacies and applications.
// A clinic's onboarding events are append-only (and keep their clinic), so
// a signed-up clinic is soft-deleted (deleted_at): it leaves the ops lists
// and the new count.

const RUN = randomUUID().slice(0, 8)
const EMAIL_PREFIX = 'e2e-signup-'
const email = (kind: string) => `${EMAIL_PREFIX}${kind}-${RUN}@compoundiq.test`
const PASSWORD = 'e2e sign-up passphrase 42'
const BANNER = "We're verifying your licenses. You can look around; ordering opens once you're approved."
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

function e2eService() {
  return createClient(process.env['E2E_SUPABASE_URL']!, process.env['E2E_SUPABASE_SERVICE_ROLE_KEY']!)
}

/** A fictional NPI with a valid check digit, unique to this run. */
function fictionalNpi(): string {
  const base = `1${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
  for (let d = 0; d < 10; d++) if (npiChecksumValid(`${base}${d}`)) return `${base}${d}`
  throw new Error('no check digit')
}

async function cleanup() {
  const db = e2eService()
  const { data, error } = await db.auth.admin.listUsers({ perPage: 1000 })
  if (error) throw new Error(`listUsers: ${error.message}`)
  const mine = data.users.filter(u => u.email?.startsWith(EMAIL_PREFIX) && u.email.endsWith('@compoundiq.test'))
  for (const u of mine) {
    const clinicId = (u.app_metadata as Record<string, unknown>)['clinic_id'] as string | null | undefined
    const pharmacyId = (u.app_metadata as Record<string, unknown>)['pharmacy_id'] as string | null | undefined
    if (pharmacyId) {
      await db.from('pharmacy_onboarding_applications').delete().eq('pharmacy_id', pharmacyId)
      await db.from('pharmacies').delete().eq('pharmacy_id', pharmacyId)
    }
    if (clinicId) {
      const { data: providers } = await db.from('providers').select('provider_id').eq('clinic_id', clinicId)
      const ids = (providers ?? []).map(p => p.provider_id as string)
      if (ids.length) {
        await db.from('provider_npi_verifications').delete().in('provider_id', ids)
        await db.from('provider_state_licenses').delete().in('provider_id', ids)
        await db.from('providers').delete().in('provider_id', ids)
      }
      await db.from('clinic_onboarding_steps').delete().eq('clinic_id', clinicId)
      const { error: clinicError } = await db.from('clinics')
        .update({ deleted_at: new Date().toISOString(), is_active: false }).eq('clinic_id', clinicId)
      if (clinicError) throw new Error(`clinic cleanup: ${clinicError.message}`)
    }
    const factors = await db.auth.admin.mfa.listFactors({ userId: u.id })
    for (const f of factors.data?.factors ?? []) await db.auth.admin.mfa.deleteFactor({ userId: u.id, id: f.id })
    const { error: delError } = await db.auth.admin.deleteUser(u.id)
    if (delError) throw new Error(`deleteUser: ${delError.message}`)
  }
}

async function signIn(page: Page, address: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(address)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 15_000 })
}

async function startFromLogin(page: Page, choice: RegExp) {
  await page.goto('/login')
  await page.getByRole('link', { name: 'New to CompoundIQ? Get started' }).click()
  await expect(page).toHaveURL(/\/get-started$/)
  await page.getByRole('radio', { name: choice }).check()
}

async function fillCommon(page: Page, address: string, orgLabel: string, org: string) {
  await page.getByLabel('First name').fill('Dana')
  await page.getByLabel('Last name').fill('Ruiz')
  await page.getByLabel('Email', { exact: true }).fill(address)
  await page.getByLabel(orgLabel, { exact: true }).fill(org)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByLabel('Confirm password').fill(PASSWORD)
}

/** A write from the signed-in page: same origin, the session's cookies. */
async function tryWrite(page: Page, path: string, body: unknown): Promise<{ status: number; error: unknown }> {
  return page.evaluate(async ([p, b]) => {
    const res = await fetch(p as string, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
    const json = await res.json().catch(() => ({})) as { error?: unknown }
    return { status: res.status, error: json.error }
  }, [path, body] as const)
}

async function expectPendingReview(page: Page) {
  const banner = page.getByRole('region', { name: 'Account under review' })
  await expect(banner).toContainText(BANNER)
  await expect(banner.getByRole('link', { name: 'See your remaining setup steps' })).toHaveAttribute('href', '/onboarding')

  await page.goto('/new-prescription')
  await expect(page.getByRole('heading', { level: 1, name: 'New Prescription' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('region', { name: 'Account under review' })).toBeVisible()

  // Save as draft and Sign: refused on the server, in the banner's words.
  expect(await tryWrite(page, '/api/orders', {})).toEqual({ status: 403, error: BANNER })
  expect(await tryWrite(page, '/api/orders/batch-sign', { orderIds: [], signature: {} })).toEqual({ status: 403, error: BANNER })
}

test.describe('Self sign-up', () => {
  test.beforeAll(cleanup)
  test.afterAll(cleanup)

  test('/get-started is axe clean and reflows at 320px', async ({ page }) => {
    await page.goto('/get-started')
    for (const choice of [/solo practice/, /clinic or practice/, /compounding pharmacy/]) {
      await page.getByRole('radio', { name: choice }).check()
      const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
      expect(results.violations.map(v => v.id)).toEqual([])
    }
    await page.setViewportSize({ width: 320, height: 640 })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  })

  test('a solo provider: /login > Get started > the app with the banner; New Prescription opens; save and sign are refused', async ({ page }) => {
    const address = email('solo')
    await startFromLogin(page, /solo practice/)
    await fillCommon(page, address, 'Practice name', `E2E Solo Practice ${RUN}`)
    await page.getByLabel('NPI', { exact: true }).fill(fictionalNpi())
    await page.getByLabel('License 1 state').selectOption('TX')
    await page.getByLabel('License 1 number').fill('TX-E2E-1234')
    await page.getByLabel('License 1 expires').fill('2099-06-30')
    await page.getByRole('button', { name: 'Create account' }).click()

    await page.waitForURL('**/dashboard', { timeout: 30_000 })
    await expectPendingReview(page)

    // Stored as a self sign-up, a solo provider, linked to its own login.
    const db = e2eService()
    const { data: clinic } = await db.from('clinics').select('clinic_id, is_active, onboarding_status, signup_source, signup_kind').eq('name', `E2E Solo Practice ${RUN}`).single()
    expect(clinic).toEqual(expect.objectContaining({ is_active: false, onboarding_status: 'in_progress', signup_source: 'self_serve', signup_kind: 'solo_provider' }))
    const { data: provider } = await db.from('providers').select('user_id').eq('clinic_id', clinic!.clinic_id).single()
    expect(provider!.user_id).toBeTruthy()
  })

  test('a clinic: /login > Get started > the clinic wizard; the app shows the banner; save and sign are refused; ops sees it labelled and counted', async ({ page, browser }) => {
    const address = email('clinic')
    const name = `E2E Signup Clinic ${RUN}`
    await startFromLogin(page, /clinic or practice/)
    await fillCommon(page, address, 'Clinic or practice name', name)
    await page.getByRole('button', { name: 'Create account' }).click()

    await page.waitForURL('**/onboarding', { timeout: 30_000 })
    await page.goto('/dashboard')
    await expectPendingReview(page)

    // Ops: labelled, and counted on the tab.
    const ops = await (await browser.newContext()).newPage()
    await signIn(ops, TEST_USERS.opsAdmin.email, TEST_USERS.opsAdmin.password)
    await ops.goto('/ops/onboarding')
    await expect(ops.getByRole('link', { name: /^Clinic onboarding \d+ new$/ })).toBeVisible()
    const item = ops.getByRole('listitem').filter({ has: ops.getByRole('heading', { name }) })
    await expect(item.getByText('Signed up on their own')).toBeVisible({ timeout: 15_000 })
  })

  test('ops review: the account holder shows their email; an unverified NPI keeps Approve disabled until the license check is ticked', async ({ page, browser }) => {
    test.setTimeout(120_000)
    const address = email('unverified')
    const name = `E2E Unverified Practice ${RUN}`
    await startFromLogin(page, /solo practice/)
    await fillCommon(page, address, 'Practice name', name)
    await page.getByLabel('NPI', { exact: true }).fill(fictionalNpi())
    await page.getByLabel('License 1 state').selectOption('TX')
    await page.getByLabel('License 1 number').fill('TX-E2E-5678')
    await page.getByLabel('License 1 expires').fill('2099-06-30')
    await page.getByRole('button', { name: 'Create account' }).click()
    await page.waitForURL('**/dashboard', { timeout: 30_000 })

    // Test setup (service role): the clinic is submitted for review, and the
    // fictional NPI is recorded as not found in the registry (as NPPES would).
    const db = e2eService()
    const { data: clinic } = await db.from('clinics').select('clinic_id').eq('name', name).single()
    const { data: provider } = await db.from('providers').select('provider_id, npi_number').eq('clinic_id', clinic!.clinic_id).single()
    const { error: submitErr } = await db.from('clinics').update({ onboarding_status: 'submitted', onboarding_submitted_at: new Date().toISOString() }).eq('clinic_id', clinic!.clinic_id)
    expect(submitErr).toBeNull()
    await db.from('provider_npi_verifications').delete().eq('provider_id', provider!.provider_id)
    const { error: npiErr } = await db.from('provider_npi_verifications').insert({
      provider_id: provider!.provider_id, npi: provider!.npi_number, status: 'not_found', reason: 'No provider with this NPI in the registry.', source: 'nppes', checked_at: new Date().toISOString(),
    })
    expect(npiErr).toBeNull()

    const ops = await (await browser.newContext()).newPage()
    await signIn(ops, TEST_USERS.opsAdmin.email, TEST_USERS.opsAdmin.password)
    await ops.goto('/ops/onboarding')
    const card = ops.getByRole('listitem').filter({ has: ops.getByRole('heading', { level: 3, name }) })
    const providers = card.getByRole('list', { name: `Providers at ${name}` })
    await expect(providers).toContainText(address, { timeout: 15_000 })
    await expect(providers).toContainText('Account holder (signed up on their own)')
    await expect(card.getByText('Dana Ruiz’s NPI was not found in the national registry. Check their license with the state board before approving.')).toBeVisible()

    const approve = card.getByRole('button', { name: `Approve ${name}` })
    await expect(approve).toBeDisabled()
    const results = await new AxeBuilder({ page: ops }).withTags(WCAG_TAGS).analyze()
    expect(results.violations.map(v => v.id)).toEqual([])

    await card.getByRole('checkbox', { name: 'I checked this provider’s license with the state board' }).check()
    await expect(approve).toBeEnabled()

    // The review page: the account holder's email and the warning.
    const review = await ops.context().newPage()
    await review.goto(`/ops/onboarding/${clinic!.clinic_id}`)
    await expect(review.getByText('Account holder (signed up on their own)')).toBeVisible({ timeout: 15_000 })
    await expect(review.getByText(address)).toBeVisible()
    await expect(review.getByText(/Dana Ruiz’s NPI was not found in the national registry/)).toBeVisible()
    const reviewAxe = await new AxeBuilder({ page: review }).withTags(WCAG_TAGS).analyze()
    expect(reviewAxe.violations.map(v => v.id)).toEqual([])

    await approve.click()
    await expect(ops.getByText(`${name} approved. It can now sign and send orders.`)).toBeVisible({ timeout: 15_000 })
    const { data: event } = await db.from('clinic_onboarding_events').select('note').eq('clinic_id', clinic!.clinic_id).eq('event', 'approved').single()
    expect(event!.note).toContain('I checked this provider’s license with the state board')

    // Ordering opens on approval: the demo payout account is set, and the
    // clinic's admin (still signed in) sees + New Prescription enabled.
    expect(event!.note).toContain('Demo payout account set on approval')
    const { data: payouts } = await db.from('clinics').select('stripe_connect_account_id, stripe_connect_status').eq('clinic_id', clinic!.clinic_id).single()
    expect(payouts).toEqual({ stripe_connect_account_id: 'poc_placeholder', stripe_connect_status: 'ACTIVE' })
    await page.goto('/dashboard')
    await expect(page.getByRole('button', { name: '+ New Prescription' })).toBeEnabled({ timeout: 15_000 })
    await expect(page.getByText('Ordering opens at launch')).toHaveCount(0)
  })

  test('a pharmacy: /login > Get started > two-step setup for its portal; inactive, no orders; ops sees it labelled', async ({ page, browser }) => {
    const address = email('pharmacy')
    const name = `E2E Signup Pharmacy ${RUN}`
    await startFromLogin(page, /compounding pharmacy/)
    await fillCommon(page, address, 'Pharmacy name', name)
    await page.getByRole('button', { name: 'Create account' }).click()

    // Pharmacies always set up two-step sign-in first.
    await page.waitForURL(url => url.pathname === '/mfa/enroll' || url.pathname.startsWith('/pharmacy/onboarding'), { timeout: 30_000 })

    const db = e2eService()
    const { data: pharmacy } = await db.from('pharmacies').select('pharmacy_id, is_active, onboarding_status').eq('name', name).single()
    expect(pharmacy).toEqual(expect.objectContaining({ is_active: false, onboarding_status: 'onboarding' }))
    const { data: app } = await db.from('pharmacy_onboarding_applications').select('status, signup_source, invite_id').eq('pharmacy_id', pharmacy!.pharmacy_id).single()
    expect(app).toEqual({ status: 'in_progress', signup_source: 'self_serve', invite_id: null })

    const ops = await (await browser.newContext()).newPage()
    await signIn(ops, TEST_USERS.opsAdmin.email, TEST_USERS.opsAdmin.password)
    await ops.goto('/ops/onboarding/pharmacies')
    await expect(ops.getByRole('link', { name: /^Pharmacy onboarding \d+ new$/ })).toBeVisible()
    const row = ops.getByRole('row').filter({ hasText: name })
    await expect(row.getByText('Signed up on their own')).toBeVisible({ timeout: 15_000 })
  })
})
