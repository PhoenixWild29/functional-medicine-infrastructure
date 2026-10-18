import { test, expect, type Browser, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { createClient } from '@supabase/supabase-js'
import { npiChecksumValid } from '../src/lib/providers/npi'
import { TEST_IDS, TEST_USERS } from './fixtures/seed'

// ============================================================
// Team invites for approved clinics, end to end (E2E project only)
// ============================================================
//
// In the test clinic, the clinic admin adds a provider (name, email, NPI,
// a state license) and invites a medical assistant from Settings > Team;
// both accept their invite links (no session); the admin deactivates the
// medical assistant, who is then signed out and cannot sign in again.
// axe in Chromium (contrast included) on the Team page at each step.
//
// Isolation: the E2E database is shared and persistent. Every login this
// spec creates has an email starting team-e2e- (used by no seed or other
// spec), and the provider's last name is Teamspec. In beforeAll and
// afterAll the spec deletes, in the test clinic only: those invites, those
// provider rows (licenses and NPI checks first), then those logins. The
// clinic's audit events are append-only and stay.

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']
const EMAIL_PREFIX = 'team-e2e-'
const LAST_NAME = 'Teamspec'
const PASSWORD = 'Team-e2e-Passw0rd!'
const RUN = Date.now().toString(36)
const PROVIDER_EMAIL = `${EMAIL_PREFIX}${RUN}-provider@compoundiq.test`
const MA_EMAIL = `${EMAIL_PREFIX}${RUN}-ma@compoundiq.test`

function admin() {
  return createClient(process.env['E2E_SUPABASE_URL']!, process.env['E2E_SUPABASE_SERVICE_ROLE_KEY']!)
}

async function axeViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
  return results.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)
}

/** A 10-digit NPI with a valid check digit, unlikely to repeat across runs. */
function freshNpi(): string {
  const body = `1${String(Date.now() % 100_000_000).padStart(8, '0')}`
  for (let d = 0; d <= 9; d++) if (npiChecksumValid(`${body}${d}`)) return `${body}${d}`
  throw new Error('no check digit')
}

async function deleteSpecData(): Promise<void> {
  const supabase = admin()
  const invites = await supabase.from('onboarding_invites').delete().eq('clinic_id', TEST_IDS.clinic).like('email', `${EMAIL_PREFIX}%`)
  if (invites.error) throw new Error(`team-invites.spec invite cleanup failed: ${invites.error.message}`)

  const { data: providers, error: pErr } = await supabase.from('providers').select('provider_id').eq('clinic_id', TEST_IDS.clinic).eq('last_name', LAST_NAME)
  if (pErr) throw new Error(`team-invites.spec provider read failed: ${pErr.message}`)
  const ids = (providers ?? []).map(p => p.provider_id as string)
  if (ids.length) {
    for (const table of ['provider_state_licenses', 'provider_npi_verifications']) {
      const r = await supabase.from(table).delete().in('provider_id', ids)
      if (r.error) throw new Error(`team-invites.spec ${table} cleanup failed: ${r.error.message}`)
    }
    const r = await supabase.from('providers').delete().in('provider_id', ids)
    if (r.error) throw new Error(`team-invites.spec provider cleanup failed: ${r.error.message}`)
  }

  const { data: list, error: lErr } = await supabase.auth.admin.listUsers({ perPage: 1000 })
  if (lErr) throw new Error(`team-invites.spec user list failed: ${lErr.message}`)
  for (const u of list.users) {
    if (!u.email?.startsWith(EMAIL_PREFIX) || u.app_metadata?.['clinic_id'] !== TEST_IDS.clinic) continue
    const r = await supabase.auth.admin.deleteUser(u.id)
    if (r.error) throw new Error(`team-invites.spec user cleanup failed: ${r.error.message}`)
  }
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

async function accept(browser: Browser, link: string, base: string, expectedName: string | null) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(new URL(new URL(link).pathname, base).toString())
  await expect(page.getByRole('heading', { level: 1, name: /Join .* on CompoundIQ/ })).toBeVisible({ timeout: 15_000 })
  if (expectedName) await expect(page.getByLabel('Full name')).toHaveValue(expectedName)
  else await page.getByLabel('Full name').fill('Tess Teamspec')
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByLabel('Confirm password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).not.toHaveURL(/\/onboard\//, { timeout: 20_000 })
  return { context, page }
}

test.beforeAll(async () => { await deleteSpecData() })
test.afterAll(async () => { await deleteSpecData() })

test.describe('Team invites', () => {
  test('the admin adds a provider and an MA; both accept; the MA is deactivated and cannot sign in', async ({ page, browser }) => {
    test.setTimeout(180_000)

    // ── The clinic admin: Settings > Team ──
    await signIn(page, TEST_USERS.clinicAdmin.email, TEST_USERS.clinicAdmin.password)
    await expect(page).toHaveURL(/\/practice$/, { timeout: 15_000 })
    await page.goto('/settings/team')
    await expect(page.getByRole('heading', { level: 1, name: 'Team' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('table', { name: 'Team members' })).toBeVisible()
    expect(await axeViolations(page)).toEqual([])

    // Add a provider.
    const addProvider = page.getByRole('region', { name: 'Add a provider' })
    await addProvider.getByLabel('First name').fill('Tess')
    await addProvider.getByLabel('Last name').fill(LAST_NAME)
    await addProvider.getByLabel('Email').fill(PROVIDER_EMAIL)
    await addProvider.getByLabel('NPI').fill(freshNpi())
    await addProvider.getByLabel('License 1 state').selectOption('TX')
    await addProvider.getByLabel('License 1 number').fill('TX-E2E-1')
    await addProvider.getByLabel('License 1 expires on').fill('2031-01-31')
    await addProvider.getByRole('button', { name: 'Add provider' }).click()
    const providerLinkField = page.getByLabel(`Invite link for Tess ${LAST_NAME}`)
    await expect(providerLinkField).toHaveValue(/\/onboard\/join\//, { timeout: 30_000 })
    const providerLink = await providerLinkField.inputValue()
    expect(await axeViolations(page)).toEqual([])

    // Invite a medical assistant.
    const invite = page.getByRole('region', { name: 'Invite a medical assistant or clinic admin' })
    await invite.getByLabel('Name').fill(`Mo ${LAST_NAME}`)
    await invite.getByLabel('Email').fill(MA_EMAIL)
    await invite.getByLabel('Role').selectOption('medical_assistant')
    await invite.getByRole('button', { name: 'Create invite' }).click()
    const maLinkField = page.getByLabel(`Invite link for Mo ${LAST_NAME}`)
    await expect(maLinkField).toHaveValue(/\/onboard\/join\//, { timeout: 15_000 })
    const maLink = await maLinkField.inputValue()

    await page.reload()
    const pending = page.getByRole('table', { name: 'Pending invites' })
    await expect(pending).toContainText(PROVIDER_EMAIL, { timeout: 15_000 })
    await expect(pending).toContainText(MA_EMAIL)
    expect(await axeViolations(page)).toEqual([])

    // ── Both accept (no session), created confirmed ──
    const provider = await accept(browser, providerLink, page.url(), null)
    const ma = await accept(browser, maLink, page.url(), `Mo ${LAST_NAME}`)

    const { data: users } = await admin().auth.admin.listUsers({ perPage: 1000 })
    const maUser = users.users.find(u => u.email === MA_EMAIL)
    const providerUser = users.users.find(u => u.email === PROVIDER_EMAIL)
    expect(maUser?.app_metadata).toMatchObject({ app_role: 'medical_assistant', clinic_id: TEST_IDS.clinic })
    expect(providerUser?.app_metadata).toMatchObject({ app_role: 'provider', clinic_id: TEST_IDS.clinic })
    expect(maUser?.email_confirmed_at).toBeTruthy()
    const { data: linked } = await admin().from('providers').select('user_id, is_active').eq('clinic_id', TEST_IDS.clinic).eq('last_name', LAST_NAME).single()
    expect(linked).toEqual({ user_id: providerUser?.id, is_active: true })

    // ── The admin deactivates the medical assistant ──
    await page.reload()
    const members = page.getByRole('table', { name: 'Team members' })
    await expect(members).toContainText(MA_EMAIL, { timeout: 15_000 })
    await expect(members).toContainText(PROVIDER_EMAIL)
    await members.getByRole('button', { name: `Deactivate Mo ${LAST_NAME}` }).click()
    await expect(page.getByText(`Mo ${LAST_NAME} will not be able to sign in`)).toBeVisible()
    expect(await axeViolations(page)).toEqual([])
    await page.getByRole('button', { name: 'Yes, deactivate' }).click()
    await expect(members.getByRole('button', { name: `Reactivate Mo ${LAST_NAME}` })).toBeVisible({ timeout: 15_000 })
    expect(await axeViolations(page)).toEqual([])

    const { data: after } = await admin().auth.admin.getUserById(maUser!.id)
    expect(after.user?.app_metadata?.['deactivated_at']).toEqual(expect.any(String))

    // The MA's open session is refused on the next page, and sign-in is refused.
    await ma.page.goto('/dashboard')
    await expect(ma.page).toHaveURL(/\/login\?error=deactivated/, { timeout: 15_000 })
    await expect(ma.page.getByRole('main').getByRole('alert')).toContainText('Your access has been turned off.')
    await signIn(ma.page, MA_EMAIL, PASSWORD)
    await expect(ma.page.getByRole('main').getByRole('alert')).toContainText('Your access has been turned off.', { timeout: 15_000 })
    await expect(ma.page).toHaveURL(/\/login/)

    await provider.context.close()
    await ma.context.close()
  })
})
