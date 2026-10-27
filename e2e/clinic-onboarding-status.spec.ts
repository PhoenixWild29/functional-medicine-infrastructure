import { test, expect, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { shardPrefix } from './fixtures/shard'

// ============================================================
// #248 submitted banner + checklist link; #245 demo payout label
// ============================================================
//
// #248: a clinic that has submitted for review, and is not approved yet,
// sees the banner say so on every clinic page, with a link to what it
// submitted (/onboarding, read-only now). Its setup checklist's "Enter
// your practice details" step links to /onboarding until approval, and to
// Settings once approved.
//
// #245: an approved clinic on the demo payout path has the placeholder
// account 'poc_placeholder_<clinic_id>'. Settings shows it as "Demo payout
// account", never the raw id.
//
// Data (service role, E2E project only): two clinics of this spec's own,
// each with a clinic_admin login (reserved @compoundiq.test emails with
// this run's id), so the shared test clinic is not changed. Cleanup in
// beforeAll and afterAll removes the logins and the clinics (soft-deleted
// when a row elsewhere still names the clinic).

const RUN = randomUUID().slice(0, 8)
// Per shard (fixtures/shard): cleanup sweeps this prefix, so each shard sweeps only its own.
const EMAIL_PREFIX = shardPrefix('e2e-onboarding-status-')
const PASSWORD = 'e2e onboarding status passphrase 7'
const SUBMITTED = "Submitted. We're reviewing your clinic; ordering opens once you're approved."

function e2eService() {
  return createClient(process.env['E2E_SUPABASE_URL']!, process.env['E2E_SUPABASE_SERVICE_ROLE_KEY']!)
}

async function cleanup() {
  const db = e2eService()
  const { data, error } = await db.auth.admin.listUsers({ perPage: 1000 })
  if (error) throw new Error(`listUsers: ${error.message}`)
  for (const u of data.users.filter(x => x.email?.startsWith(EMAIL_PREFIX) && x.email.endsWith('@compoundiq.test'))) {
    const clinicId = (u.app_metadata as Record<string, unknown>)['clinic_id'] as string | null | undefined
    const { error: delError } = await db.auth.admin.deleteUser(u.id)
    if (delError) throw new Error(`deleteUser: ${delError.message}`)
    if (!clinicId) continue
    await db.from('clinic_onboarding_steps').delete().eq('clinic_id', clinicId)
    const { error: clinicError } = await db.from('clinics').delete().eq('clinic_id', clinicId)
    if (clinicError) {
      const { error: softError } = await db.from('clinics')
        .update({ deleted_at: new Date().toISOString(), is_active: false }).eq('clinic_id', clinicId)
      if (softError) throw new Error(`clinic cleanup: ${softError.message}`)
    }
  }
}

/** A clinic of this spec's own and its clinic_admin login. */
async function seedClinic(kind: string, row: Record<string, unknown>): Promise<{ clinicId: string; email: string }> {
  const db = e2eService()
  const clinicId = randomUUID()
  const { error } = await db.from('clinics').insert({ clinic_id: clinicId, name: `E2E Onboarding Status ${kind} ${RUN}`, ...row })
  if (error) throw new Error(`clinic ${kind}: ${error.message}`)
  const email = `${EMAIL_PREFIX}${kind}-${RUN}@compoundiq.test`
  const { error: userError } = await db.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true,
    app_metadata: { app_role: 'clinic_admin', clinic_id: clinicId }, user_metadata: { full_name: 'Robin Okafor' },
  })
  if (userError) throw new Error(`clinic admin ${kind}: ${userError.message}`)
  return { clinicId, email }
}

async function signIn(page: Page, email: string) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 15_000 })
}

test.describe('Clinic onboarding status', () => {
  test.beforeAll(cleanup)
  test.afterAll(cleanup)

  test('#248 submitted, not approved: the banner says so and links to what was submitted; practice details links to /onboarding', async ({ page }) => {
    const { email } = await seedClinic('submitted', {
      is_active: false, onboarding_status: 'submitted', onboarding_submitted_at: new Date().toISOString(),
      signup_source: 'self_serve', signup_kind: 'clinic',
    })
    await signIn(page, email)
    await page.goto('/dashboard')

    const banner = page.getByRole('region', { name: 'Account under review' })
    await expect(banner).toContainText(SUBMITTED, { timeout: 15_000 })
    const viewSubmitted = banner.getByRole('link', { name: 'View what you submitted' })
    await expect(viewSubmitted).toHaveAttribute('href', '/onboarding')
    await expect(banner.getByRole('link', { name: 'See your remaining setup steps' })).toHaveCount(0)

    const card = page.getByRole('region', { name: 'Get set up' })
    await expect(card).toBeVisible({ timeout: 15_000 })
    await expect(card.getByRole('link', { name: /Enter your practice details/ })).toHaveAttribute('href', '/onboarding')

    // The banner is on every clinic page, not only the dashboard.
    await page.goto('/settings')
    await expect(page.getByRole('region', { name: 'Account under review' })).toContainText(SUBMITTED, { timeout: 15_000 })

    await page.getByRole('region', { name: 'Account under review' }).getByRole('link', { name: 'View what you submitted' }).click()
    await expect(page).toHaveURL(/\/onboarding$/, { timeout: 15_000 })
    await expect(page.getByText('Submitted. CompoundIQ is reviewing your clinic; you will be able to send orders once it is approved.')).toBeVisible({ timeout: 15_000 })
  })

  test('#248 approved: no banner; practice details links to Settings. #245: Settings shows "Demo payout account", never the raw id', async ({ page }) => {
    const db = e2eService()
    const { clinicId, email } = await seedClinic('approved', { is_active: true, onboarding_status: 'approved', stripe_connect_status: 'ACTIVE' })
    const placeholder = `poc_placeholder_${clinicId}`
    const { error } = await db.from('clinics').update({ stripe_connect_account_id: placeholder }).eq('clinic_id', clinicId)
    if (error) throw new Error(`payout placeholder: ${error.message}`)

    await signIn(page, email)
    await page.goto('/dashboard')
    const card = page.getByRole('region', { name: 'Get set up' })
    await expect(card).toBeVisible({ timeout: 15_000 })
    await expect(card.getByRole('link', { name: /Enter your practice details/ })).toHaveAttribute('href', '/settings#clinic-profile')
    await expect(page.getByRole('region', { name: 'Account under review' })).toHaveCount(0)

    await page.goto('/settings')
    const payouts = page.locator('#stripe-connect')
    await expect(payouts.getByRole('status').filter({ hasText: 'Payouts active' })).toContainText('Account: Demo payout account', { timeout: 15_000 })
    // Rendered text only (innerText): the id still travels in the page's
    // data for the client component, which is fine; it is never shown.
    const shown = await page.locator('body').innerText()
    expect(shown).not.toContain(placeholder)
    expect(shown).not.toContain('poc_placeholder')
  })
})
