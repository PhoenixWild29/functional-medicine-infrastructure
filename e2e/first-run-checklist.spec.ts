import { test, expect, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { seedStaticData, TEST_IDS, TEST_USERS } from './fixtures/seed'

// ============================================================
// First-run coaching: the clinic admin's setup checklist
// ============================================================
//
// The card at the top of the dashboard lists the admin's steps, each a
// link to where it is done and ticked from real data. "Hide checklist"
// stores the choice in the admin's user_metadata; "Show setup checklist"
// in the user menu brings it back.
//
// The test clinic's practice name is cleared for the run, so at least one
// step is to do and the checklist cannot be complete (complete is stored
// for good). The admin's coaching preferences are reset before and after.

function e2eService() {
  return createClient(process.env['E2E_SUPABASE_URL']!, process.env['E2E_SUPABASE_SERVICE_ROLE_KEY']!)
}

async function adminUser() {
  const { data, error } = await e2eService().auth.admin.listUsers({ perPage: 1000 })
  if (error) throw new Error(error.message)
  const u = data.users.find(x => x.email === TEST_USERS.clinicAdmin.email)
  if (!u) throw new Error('clinic admin test user not found')
  return u
}

async function resetCoaching() {
  const u = await adminUser()
  const meta = { ...(u.user_metadata ?? {}) }
  delete (meta as Record<string, unknown>)['coaching']
  const { error } = await e2eService().auth.admin.updateUserById(u.id, { user_metadata: meta })
  if (error) throw new Error(error.message)
}

async function signIn(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(TEST_USERS.clinicAdmin.email)
  await page.getByLabel('Password').fill(TEST_USERS.clinicAdmin.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  // The clinic admin lands on the Practice dashboard; the checklist is on /dashboard.
  await expect(page).toHaveURL(/\/practice$/, { timeout: 20_000 })
  await page.goto('/dashboard')
}

test.describe('First-run coaching: the clinic admin setup checklist', () => {
  let legalName: string | null = null

  test.beforeAll(async () => {
    await seedStaticData()
    const { data } = await e2eService().from('clinics').select('legal_name').eq('clinic_id', TEST_IDS.clinic).single()
    legalName = (data as { legal_name: string | null } | null)?.legal_name ?? null
    await e2eService().from('clinics').update({ legal_name: null }).eq('clinic_id', TEST_IDS.clinic)
    await resetCoaching()
  })

  test.afterAll(async () => {
    await e2eService().from('clinics').update({ legal_name: legalName }).eq('clinic_id', TEST_IDS.clinic)
    await resetCoaching()
  })

  test('the steps link to where they are done; Hide checklist, then Show setup checklist', async ({ page }) => {
    await signIn(page)

    const card = page.getByRole('region', { name: 'Get set up' })
    await expect(card).toBeVisible({ timeout: 15_000 })
    const practice = card.getByRole('link', { name: /Enter your practice details/ })
    await expect(practice).toHaveAttribute('href', '/settings#clinic-profile')
    await expect(practice).toContainText('To do')
    for (const [name, href] of [
      [/Accept the BAA and terms/, '/settings/agreements'],
      [/Add your team/, '/settings/team'],
      [/Add patients/, '/settings#patients'],
      [/Send your first prescription/, '/new-prescription'],
    ] as const) {
      await expect(card.getByRole('link', { name })).toHaveAttribute('href', href)
    }

    await card.getByRole('button', { name: 'Hide checklist' }).click()
    await expect(card).toHaveCount(0)

    // Stored, not just hidden on this page.
    await page.reload()
    await expect(page.getByRole('region', { name: 'Get set up' })).toHaveCount(0)

    await page.getByRole('button', { name: 'Show setup checklist' }).first().click()
    await expect(page.getByRole('region', { name: 'Get set up' })).toBeVisible({ timeout: 15_000 })

    // A step opens where it is done.
    await page.getByRole('region', { name: 'Get set up' }).getByRole('link', { name: /Accept the BAA and terms/ }).click()
    await expect(page).toHaveURL(/\/settings\/agreements/, { timeout: 15_000 })
  })
})
