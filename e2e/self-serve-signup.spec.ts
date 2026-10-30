import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { TEST_IDS, TEST_USERS } from './fixtures/seed'
import { npiChecksumValid } from '../src/lib/providers/npi'
import { demoPayoutsOnApproval } from '../src/lib/clinics/demo-payouts'
import { shardPrefix } from './fixtures/shard'
import { e2ePassword } from './fixtures/test-password'

// ============================================================
// Self sign-up: /login > Get started > lands in the app, pending review
// ============================================================
//
// For each entry point (solo provider, clinic, pharmacy): the visitor signs
// up from /login with no invite and lands in the product at once. A clinic
// under review sees the banner on every page; New Prescription opens, and
// saving a draft or signing is refused on the server with the banner's
// words. A pharmacy goes straight to its portal (no two-step setup: the
// same rule as every role, and REQUIRE_MFA is off in E2E) and stays inactive. Ops sees each one labelled "Signed up on
// their own", with a new count on the tab.
//
// Data: reserved @compoundiq.test emails with this run's id. Cleanup in
// beforeAll and afterAll (service role, E2E project only) removes the
// logins, providers, licenses, wizard steps, pharmacies and applications.
// A clinic's onboarding events are append-only (and keep their clinic), so
// a signed-up clinic is soft-deleted (deleted_at): it leaves the ops lists
// and the new count.

const RUN = randomUUID().slice(0, 8)
// Per shard (fixtures/shard): cleanup sweeps this prefix, so each shard sweeps only its own.
const EMAIL_PREFIX = shardPrefix('e2e-signup-')
const email = (kind: string) => `${EMAIL_PREFIX}${kind}-${RUN}@compoundiq.test`
const PASSWORD = e2ePassword()
const BANNER = "We're verifying your licenses. You can look around; ordering opens once you're approved and payouts are set up."
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

/** The provider this run adds to the approved test clinic, holding an NPI (M3). */
const HOLDER_LICENSE = `TX-E2E-HOLD-${RUN}`

async function cleanup() {
  const db = e2eService()
  await db.from('providers').delete().eq('clinic_id', TEST_IDS.clinic).like('license_number', 'TX-E2E-HOLD-%')
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

/** A submitted solo self sign-up: clinic, confirmed clinic_admin login, provider (unclaimed, as sign-up stores it). */
async function seedSubmittedSignup(kind: string, name: string, npiNumber: string) {
  const db = e2eService()
  const now = new Date().toISOString()
  const { data: clinic, error: clinicErr } = await db.from('clinics').insert({
    name, is_active: false, onboarding_status: 'submitted', onboarding_submitted_at: now, signup_source: 'self_serve', signup_kind: 'solo_provider',
  }).select('clinic_id').single()
  if (clinicErr || !clinic) throw new Error(`clinic: ${clinicErr?.message}`)
  const { data: login, error: loginErr } = await db.auth.admin.createUser({
    email: email(kind), password: PASSWORD, email_confirm: true,
    app_metadata: { app_role: 'clinic_admin', clinic_id: clinic.clinic_id }, user_metadata: { full_name: 'Dana Ruiz' },
  })
  if (loginErr || !login.user) throw new Error(`login: ${loginErr?.message}`)
  const { data: provider, error: providerErr } = await db.from('providers').insert({
    clinic_id: clinic.clinic_id, user_id: login.user.id, first_name: 'Dana', last_name: 'Ruiz', npi_number: npiNumber,
    license_state: 'TX', license_number: `TX-E2E-${kind}`, signature_on_file: false, is_active: true, npi_claimed: false,
  }).select('provider_id').single()
  if (providerErr || !provider) throw new Error(`provider: ${providerErr?.message}`)
  return { clinicId: clinic.clinic_id as string, userId: login.user.id, providerId: provider.provider_id as string }
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

    // Test setup with the service role, not /get-started: every CI sign-up
    // shares one IP, and the public form is rate limited. These are the rows
    // a solo-provider self sign-up writes (lib/signup/self-serve): an
    // inactive self_serve clinic, its confirmed clinic_admin login, and the
    // provider linked to that login with a license. Then, as for review: the
    // clinic is submitted, and the fictional NPI is recorded as not found in
    // the registry (as NPPES would). Cleanup finds it by the login's email.
    const db = e2eService()
    const now = new Date().toISOString()
    const { data: clinic, error: clinicErr } = await db.from('clinics').insert({
      name, is_active: false, onboarding_status: 'submitted', onboarding_submitted_at: now, signup_source: 'self_serve', signup_kind: 'solo_provider',
    }).select('clinic_id').single()
    expect(clinicErr).toBeNull()
    const { data: login, error: loginErr } = await db.auth.admin.createUser({
      email: address, password: PASSWORD, email_confirm: true,
      app_metadata: { app_role: 'clinic_admin', clinic_id: clinic!.clinic_id }, user_metadata: { full_name: 'Dana Ruiz' },
    })
    expect(loginErr).toBeNull()
    const userId = login.user!.id
    const npiNumber = fictionalNpi()
    const { data: provider, error: providerErr } = await db.from('providers').insert({
      clinic_id: clinic!.clinic_id, user_id: userId, first_name: 'Dana', last_name: 'Ruiz', npi_number: npiNumber,
      license_state: 'TX', license_number: 'TX-E2E-5678', signature_on_file: false, is_active: true,
    }).select('provider_id').single()
    expect(providerErr).toBeNull()
    const { error: licenseErr } = await db.from('provider_state_licenses').insert({
      provider_id: provider!.provider_id, state: 'TX', license_number: 'TX-E2E-5678', expires_on: '2099-06-30', verified_at: now, verified_by: userId, source: 'manual',
    })
    expect(licenseErr).toBeNull()
    const { error: npiErr } = await db.from('provider_npi_verifications').insert({
      provider_id: provider!.provider_id, npi: npiNumber, status: 'not_found', reason: 'No provider with this NPI in the registry.', source: 'nppes', checked_at: now,
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

    // H1: with a live Stripe key (or DEMO_PAYOUTS_ON_APPROVAL=false) approval
    // never sets a demo payout account; the clinic connects its own Stripe.
    if (!demoPayoutsOnApproval()) {
      expect(event!.note ?? '').not.toContain('Demo payout account set on approval')
      const { data: none } = await db.from('clinics').select('stripe_connect_account_id').eq('clinic_id', clinic!.clinic_id).single()
      expect(none!.stripe_connect_account_id ?? null).toBeNull()
      return
    }

    // Ordering opens on approval: the clinic's own demo payout account is set
    // (unique per clinic; Sunrise keeps 'poc_placeholder'), and the clinic's
    // admin sees + New Prescription enabled.
    expect(event!.note).toContain('Demo payout account set on approval')
    const { data: payouts } = await db.from('clinics').select('stripe_connect_account_id, stripe_connect_status').eq('clinic_id', clinic!.clinic_id).single()
    expect(payouts).toEqual({ stripe_connect_account_id: `poc_placeholder_${clinic!.clinic_id}`, stripe_connect_status: 'ACTIVE' })
    await signIn(page, address, PASSWORD)
    await page.goto('/dashboard')
    await expect(page.getByRole('button', { name: '+ New Prescription' })).toBeEnabled({ timeout: 15_000 })
    await expect(page.getByText('Ordering opens at launch')).toHaveCount(0)
  })

  test('a pharmacy: /login > Get started > straight to its portal; inactive, no orders; ops sees it labelled', async ({ page, browser }) => {
    const address = email('pharmacy')
    const name = `E2E Signup Pharmacy ${RUN}`
    await startFromLogin(page, /compounding pharmacy/)
    await fillCommon(page, address, 'Pharmacy name', name)
    await page.getByRole('button', { name: 'Create account' }).click()

    // No two-step setup first: the same rule as every role (REQUIRE_MFA is off in E2E).
    await page.waitForURL(url => url.pathname.startsWith('/pharmacy/onboarding'), { timeout: 30_000 })

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

  // Security review M3: an NPI an approved clinic's provider holds does
  // not block (or reveal anything at) sign-up; ops sees it and cannot
  // approve, and sees how many other pending sign-ups name it.
  test('NPI squatting: the sign-up goes through; ops sees the NPI is held elsewhere and Approve is refused', async ({ page, browser }) => {
    test.setTimeout(120_000)
    const db = e2eService()
    const npiNumber = fictionalNpi()
    // The approved test clinic holds the NPI (claimed by default).
    const { error: holdErr } = await db.from('providers').insert({
      clinic_id: TEST_IDS.clinic, first_name: 'Hold', last_name: 'Er', npi_number: npiNumber,
      license_state: 'TX', license_number: HOLDER_LICENSE, signature_on_file: false, is_active: true,
    })
    expect(holdErr).toBeNull()
    // Another pending sign-up names it too.
    await seedSubmittedSignup('npi-other', `E2E NPI Other ${RUN}`, npiNumber)

    // The public form: the same answer as any NPI.
    const address = email('npi')
    const name = `E2E NPI Practice ${RUN}`
    await startFromLogin(page, /solo practice/)
    await fillCommon(page, address, 'Practice name', name)
    await page.getByLabel('NPI', { exact: true }).fill(npiNumber)
    await page.getByLabel('License 1 state').selectOption('TX')
    await page.getByLabel('License 1 number').fill('TX-E2E-4321')
    await page.getByLabel('License 1 expires').fill('2099-06-30')
    await page.getByRole('button', { name: 'Create account' }).click()
    await page.waitForURL('**/dashboard', { timeout: 30_000 })

    const { data: clinic } = await db.from('clinics').select('clinic_id').eq('name', name).single()
    const { data: mine } = await db.from('providers').select('npi_claimed').eq('clinic_id', clinic!.clinic_id).single()
    expect(mine!.npi_claimed).toBe(false)
    await db.from('clinics').update({ onboarding_status: 'submitted', onboarding_submitted_at: new Date().toISOString() }).eq('clinic_id', clinic!.clinic_id)

    const ops = await (await browser.newContext()).newPage()
    await signIn(ops, TEST_USERS.opsAdmin.email, TEST_USERS.opsAdmin.password)
    await ops.goto('/ops/onboarding')
    const card = ops.getByRole('listitem').filter({ has: ops.getByRole('heading', { level: 3, name }) })
    await expect(card.getByText('Dana Ruiz’s NPI is already registered to a provider at an approved clinic. Approve is refused until this is resolved with the provider.')).toBeVisible({ timeout: 15_000 })
    await expect(card.getByText('NPI also claimed by 1 other pending sign-up.')).toBeVisible()
    await expect(card.getByRole('button', { name: `Approve ${name}` })).toBeDisabled()
    const results = await new AxeBuilder({ page: ops }).withTags(WCAG_TAGS).analyze()
    expect(results.violations.map(v => v.id)).toEqual([])

    // The server refuses it too, and nothing changes.
    const refused = await ops.evaluate(async (id: string) => {
      const res = await fetch(`/api/ops/onboarding/clinics/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'approve', licenseChecked: true }) })
      return { status: res.status, code: ((await res.json()) as { code?: string }).code }
    }, clinic!.clinic_id as string)
    expect(refused).toEqual({ status: 409, code: 'NPI_REGISTERED_ELSEWHERE' })
    const { data: still } = await db.from('clinics').select('onboarding_status, is_active').eq('clinic_id', clinic!.clinic_id).single()
    expect(still).toEqual({ onboarding_status: 'submitted', is_active: false })
  })

  test('ops deletes an unapproved self sign-up: logins and provider rows gone, the clinic closed, recorded', async ({ browser }) => {
    test.setTimeout(120_000)
    const db = e2eService()
    const name = `E2E Delete Practice ${RUN}`
    const seeded = await seedSubmittedSignup('delete', name, fictionalNpi())

    const ops = await (await browser.newContext()).newPage()
    await signIn(ops, TEST_USERS.opsAdmin.email, TEST_USERS.opsAdmin.password)
    await ops.goto(`/ops/onboarding/${seeded.clinicId}`)
    await ops.getByRole('button', { name: 'Delete this sign-up' }).click({ timeout: 15_000 })
    await expect(ops.getByText(`Delete ${name}? Its logins, provider records and licenses are removed, and the clinic is closed. This cannot be undone.`)).toBeVisible()
    await ops.getByRole('button', { name: `Yes, delete ${name}` }).click()
    await ops.waitForURL(url => url.pathname === '/ops/onboarding', { timeout: 15_000 })

    const { data: clinic } = await db.from('clinics').select('deleted_at, is_active').eq('clinic_id', seeded.clinicId).single()
    expect(clinic!.deleted_at).not.toBeNull()
    expect(clinic!.is_active).toBe(false)
    const { data: providers } = await db.from('providers').select('provider_id').eq('clinic_id', seeded.clinicId)
    expect(providers).toEqual([])
    const { data: gone } = await db.auth.admin.getUserById(seeded.userId)
    expect(gone?.user ?? null).toBeNull()
    const { data: events } = await db.from('clinic_onboarding_events').select('event, actor_role').eq('clinic_id', seeded.clinicId).eq('event', 'signup_deleted')
    expect(events).toEqual([{ event: 'signup_deleted', actor_role: 'ops_admin' }])
    // Off the queue.
    await expect(ops.getByRole('heading', { level: 3, name })).toHaveCount(0)
  })
})
