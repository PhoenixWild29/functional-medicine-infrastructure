import path from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { TEST_USERS } from './fixtures/seed'
import { totpCode } from './fixtures/totp'
import { MAX_REQUEST_BYTES } from '../src/lib/uploads/limits'

// ============================================================
// #250: the 4 MB limit on uploads through a Vercel Function
// ============================================================
//
// Vercel refuses request bodies over about 4.5 MB before the function
// runs, so the browser checks the file first: a file just over 4 MB gets
// a plain message and nothing is sent. A small file still goes through.
// Checked in the pharmacy onboarding license upload and in Settings >
// Patients > Import.
//
// Data (service role, E2E project only):
// - Pharmacy: a pharmacy in onboarding, its application, one TX license
//   with no document and a pharmacy_admin login (TOTP enrolled at first
//   sign-in, as pharmacy-onboarding-a11y does). afterAll removes the
//   stored document, the license, the application, the login and the
//   pharmacy. The small upload writes one license_document_uploaded row
//   to pharmacy_onboarding_events, which is append-only; it names this
//   spec's fixed pharmacy id, with no foreign key, and stays.
// - Import: the small file is the spec fixture, and only the parse step
//   runs, which writes nothing.

const PH_ID = 'aaaaaaaa-0000-0000-0000-0000000000c1'
const PH_APP_ID = 'aaaaaaaa-0000-0000-0000-0000000000c2'
const PH_ADMIN = { email: 'test-pharmacy-upload-limit@compoundiq.test', password: 'TestPassword123!' }
const JUST_OVER = MAX_REQUEST_BYTES + 1024
// LICENSE_DOCUMENT_BUCKET in lib/pharmacy-onboarding/application (a server
// module, not imported here).
const LICENSE_DOCUMENT_BUCKET = 'pharmacy-license-documents'
const SAMPLE_CSV = path.join(__dirname, 'fixtures', 'patients-import-sample.csv')

function e2eService() {
  return createClient(process.env['E2E_SUPABASE_URL']!, process.env['E2E_SUPABASE_SERVICE_ROLE_KEY']!)
}

/** Records the requests to one path, so a test can assert none was sent. */
function watchRequests(page: Page, fragment: string): string[] {
  const seen: string[] = []
  page.on('request', r => { if (r.url().includes(fragment)) seen.push(`${r.method()} ${r.url()}`) })
  return seen
}

/** A minimal one-page PDF: small, and a real PDF type. */
const SMALL_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
)

test.describe('#250 4 MB upload limit: pharmacy license document', () => {
  let adminUserId: string | null = null

  async function removeFactors() {
    if (!adminUserId) return
    const db = e2eService()
    const factors = await db.auth.admin.mfa.listFactors({ userId: adminUserId })
    if (factors.error) throw new Error(`listFactors: ${factors.error.message}`)
    for (const f of factors.data.factors) {
      const { error } = await db.auth.admin.mfa.deleteFactor({ userId: adminUserId, id: f.id })
      if (error) throw new Error(`deleteFactor: ${error.message}`)
    }
  }

  async function removeDocuments() {
    const bucket = e2eService().storage.from(LICENSE_DOCUMENT_BUCKET)
    const { data, error } = await bucket.list(`${PH_ID}/TX`)
    if (error) throw new Error(`list documents: ${error.message}`)
    const paths = (data ?? []).map(f => `${PH_ID}/TX/${f.name}`)
    if (paths.length) {
      const { error: removeError } = await bucket.remove(paths)
      if (removeError) throw new Error(`remove documents: ${removeError.message}`)
    }
  }

  test.beforeAll(async () => {
    const db = e2eService()
    const { error: phErr } = await db.from('pharmacies').upsert({
      pharmacy_id: PH_ID, name: 'Upload Limit Pharmacy', slug: 'upload-limit-pharmacy', integration_tier: 'TIER_4_FAX',
      is_active: false, onboarding_status: 'onboarding', email: PH_ADMIN.email,
    }, { onConflict: 'pharmacy_id' })
    if (phErr) throw new Error(`pharmacy: ${phErr.message}`)

    const appMetadata = { app_role: 'pharmacy_admin', clinic_id: null, pharmacy_id: PH_ID }
    const { data: { users } } = await db.auth.admin.listUsers({ perPage: 1000 })
    const existing = users.find(u => u.email === PH_ADMIN.email)
    if (existing) {
      const { error } = await db.auth.admin.updateUserById(existing.id, { password: PH_ADMIN.password, app_metadata: appMetadata })
      if (error) throw new Error(`pharmacy admin: ${error.message}`)
      adminUserId = existing.id
    } else {
      const { data, error } = await db.auth.admin.createUser({ email: PH_ADMIN.email, password: PH_ADMIN.password, email_confirm: true, app_metadata: appMetadata })
      if (error || !data.user) throw new Error(`pharmacy admin: ${error?.message}`)
      adminUserId = data.user.id
    }
    await removeFactors()

    const { error: appErr } = await db.from('pharmacy_onboarding_applications').upsert({
      application_id: PH_APP_ID, pharmacy_id: PH_ID, admin_user_id: adminUserId, status: 'in_progress', steps_completed: [],
    }, { onConflict: 'application_id' })
    if (appErr) throw new Error(`application: ${appErr.message}`)

    // One license with no document yet: its upload control is on the step.
    await removeDocuments()
    const { error: licErr } = await db.from('pharmacy_state_licenses').upsert({
      pharmacy_id: PH_ID, state_code: 'TX', license_number: 'TX-E2E-UPLOAD', expiration_date: '2099-12-31',
      sterile_compounding: false, is_active: false, deleted_at: null, verification_status: 'pending', document_path: null,
    }, { onConflict: 'pharmacy_id,state_code' })
    if (licErr) throw new Error(`license: ${licErr.message}`)
  })

  test.afterAll(async () => {
    const db = e2eService()
    await removeDocuments()
    await db.from('pharmacy_state_licenses').delete().eq('pharmacy_id', PH_ID)
    await db.from('pharmacy_onboarding_applications').delete().eq('application_id', PH_APP_ID)
    if (adminUserId) {
      await removeFactors()
      await db.auth.admin.deleteUser(adminUserId)
    }
    await db.from('pharmacies').delete().eq('pharmacy_id', PH_ID)
  })

  test('a file just over 4 MB: the message, and nothing sent; a small PDF uploads', async ({ page }) => {
    // First sign-in of a pharmacy_admin: enroll TOTP, then the wizard.
    await page.goto('/login')
    await page.getByLabel('Email address').fill(PH_ADMIN.email)
    await page.getByLabel('Password', { exact: true }).fill(PH_ADMIN.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(/\/mfa\/enroll/, { timeout: 15_000 })
    const secret = (await page.getByTestId('mfa-manual-key').innerText()).replace(/\s+/g, '')
    await page.getByLabel('6-digit code').fill(totpCode(secret))
    await page.getByRole('button', { name: /Verify/ }).click()
    await expect(page).toHaveURL(/\/pharmacy\/onboarding/, { timeout: 15_000 })

    await page.getByRole('navigation', { name: 'Onboarding steps' }).getByRole('button', { name: /^\d*\s*State licenses/ }).click()
    await expect(page.locator('#step-heading')).toHaveText('State licenses')
    const input = page.getByLabel('Upload the TX license document')
    await expect(page.getByText('PDF, PNG or JPEG, up to 4 MB.')).toBeVisible()

    const uploads = watchRequests(page, '/api/pharmacy/onboarding/licenses/TX/document')
    await input.setInputFiles({ name: 'license-scan.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(JUST_OVER, 0x20) })
    await expect(page.getByRole('main').getByRole('alert')).toHaveText('The file must be under 4 MB.')
    expect(uploads).toEqual([])

    await input.setInputFiles({ name: 'license.pdf', mimeType: 'application/pdf', buffer: SMALL_PDF })
    await expect(page.getByText('Document uploaded. PDF, PNG or JPEG, up to 4 MB.')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByLabel('Replace the TX license document')).toBeVisible()
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0)
    expect(uploads).toHaveLength(1)

    const { data: license } = await e2eService().from('pharmacy_state_licenses')
      .select('document_path').eq('pharmacy_id', PH_ID).eq('state_code', 'TX').single()
    expect(license!.document_path).toMatch(new RegExp(`^${PH_ID}/TX/.+\\.pdf$`))
  })
})

test.describe('#250 4 MB upload limit: Settings > Patients > Import', () => {
  test('a CSV just over 4 MB: the message, and nothing sent; the sample file goes on to the columns', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Email').fill(TEST_USERS.clinicAdmin.email)
    await page.getByLabel('Password').fill(TEST_USERS.clinicAdmin.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(/\/practice$/, { timeout: 15_000 })

    await page.goto('/settings/patients/import')
    await expect(page.getByRole('heading', { level: 1, name: 'Import patients' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('A .csv file up to 4 MB and 5,000 patients, with a header row.')).toBeVisible()

    const parses = watchRequests(page, '/api/patients/import/parse')
    const header = 'first_name,last_name,date_of_birth,mobile\n'
    const big = Buffer.concat([Buffer.from(header), Buffer.alloc(JUST_OVER - header.length, 0x61)])
    await page.getByLabel('CSV file').setInputFiles({ name: 'too-big.csv', mimeType: 'text/csv', buffer: big })
    await page.getByRole('button', { name: 'Upload and check columns' }).click()
    // Scoped to main: Next's route announcer is also role=alert.
    await expect(page.getByRole('main').getByRole('alert')).toHaveText('The file is larger than 4 MB. Split it into smaller files.')
    await expect(page.getByLabel('CSV file')).toHaveAttribute('aria-invalid', 'true')
    expect(parses).toEqual([])

    await page.getByLabel('CSV file').setInputFiles(SAMPLE_CSV)
    await page.getByRole('button', { name: 'Upload and check columns' }).click()
    await expect(page.getByRole('heading', { level: 2, name: 'Match the columns' })).toBeVisible({ timeout: 15_000 })
    expect(parses).toHaveLength(1)
  })
})
