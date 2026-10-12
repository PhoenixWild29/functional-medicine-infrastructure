import path from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { createClient } from '@supabase/supabase-js'
import { TEST_IDS, TEST_USERS } from './fixtures/seed'

// ============================================================
// Patient Intake PR 5: CSV import, end to end (E2E project only)
// ============================================================
//
// The clinic admin uploads e2e/fixtures/patients-import-sample.csv, maps
// the one column the header did not give away (date of birth), reviews the
// rows, and imports. Every screen: axe in Chromium (contrast included).
// The sample has 5 rows: 3 ready (one email-only), 1 that needs fixing
// (30 February) and 1 possible duplicate of an earlier row in the file.
//
// Isolation: the E2E database is shared and persistent. Every patient in
// the sample has a mobile in this spec's own range (+1 626 555 XXXX,
// SPEC_PREFIX, used by no seed or other spec; intake.spec uses
// +1 737 555) or, for the email-only row, an @patient-import.e2e.test
// email. In beforeAll and afterAll the spec deletes those patients in the
// test clinic, then the sample file's import batches there. Seeded
// patients and other specs' patients are never touched.

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

/** This spec's mobile range: +1 626 555 XXXX. */
const SPEC_PREFIX = '+1626555'
/** This spec's email domain (the email-only row has no mobile). */
const SPEC_EMAIL_DOMAIN = '@patient-import.e2e.test'
const SAMPLE_FILE = 'patients-import-sample.csv'
const SAMPLE_PATH = path.join(__dirname, 'fixtures', SAMPLE_FILE)

function admin() {
  return createClient(process.env['E2E_SUPABASE_URL']!, process.env['E2E_SUPABASE_SERVICE_ROLE_KEY']!)
}

async function axeViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
  return results.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)
}

/** Delete this spec's patients in the test clinic, then the sample's batches. */
async function deleteSpecData(): Promise<void> {
  const supabase = admin()
  const byMobile = await supabase.from('patients').delete()
    .eq('clinic_id', TEST_IDS.clinic)
    .like('phone_e164', `${SPEC_PREFIX}%`)
  if (byMobile.error) throw new Error(`patient-import.spec cleanup failed: ${byMobile.error.message}`)
  const byEmail = await supabase.from('patients').delete()
    .eq('clinic_id', TEST_IDS.clinic)
    .like('email', `%${SPEC_EMAIL_DOMAIN}`)
  if (byEmail.error) throw new Error(`patient-import.spec cleanup failed: ${byEmail.error.message}`)
  const batches = await supabase.from('patient_import_batches').delete()
    .eq('clinic_id', TEST_IDS.clinic)
    .eq('file_name', SAMPLE_FILE)
  if (batches.error) throw new Error(`patient-import.spec batch cleanup failed: ${batches.error.message}`)
}

test.beforeAll(async () => { await deleteSpecData() })
test.afterAll(async () => { await deleteSpecData() })

test.describe('Patient Intake PR 5: CSV import', () => {
  test('the clinic admin imports a CSV: accessible at every step, all checked before anything is saved', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Email').fill(TEST_USERS.clinicAdmin.email)
    await page.getByLabel('Password').fill(TEST_USERS.clinicAdmin.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(/\/practice$/, { timeout: 15_000 })

    // Settings links the clinic admin to the import.
    await page.goto('/settings')
    await page.getByTestId('settings-patients').getByRole('link', { name: 'Import patients' }).click()
    await expect(page).toHaveURL(/\/settings\/patients\/import$/, { timeout: 15_000 })
    await expect(page).toHaveTitle(/Import patients/)
    await expect(page.getByRole('heading', { level: 1, name: 'Import patients' })).toBeVisible({ timeout: 15_000 })
    expect(await axeViolations(page)).toEqual([])

    // 1. Upload: no file is an error, announced.
    await page.getByRole('button', { name: 'Upload and check columns' }).click()
    await expect(page.getByRole('alert')).toContainText('Choose a .csv file')
    await expect(page.getByLabel('CSV file')).toHaveAttribute('aria-invalid', 'true')
    expect(await axeViolations(page)).toEqual([])
    await page.getByLabel('CSV file').setInputFiles(SAMPLE_PATH)
    await page.getByRole('button', { name: 'Upload and check columns' }).click()

    // 2. Columns: detected from the header, except the date of birth.
    await expect(page.getByRole('heading', { level: 2, name: 'Match the columns' })).toBeFocused({ timeout: 15_000 })
    await expect(page.getByLabel(/^First name/)).toHaveValue('0')
    await expect(page.getByLabel(/^Mobile number/)).toHaveValue('3')
    await expect(page.getByLabel(/^Date of birth/)).toHaveValue('')
    expect(await axeViolations(page)).toEqual([])
    await page.getByRole('button', { name: 'Check rows' }).click()
    await expect(page.getByRole('alert')).toContainText('date of birth')
    expect(await axeViolations(page)).toEqual([])
    await page.getByLabel(/^Date of birth/).selectOption({ label: 'Pt Birth Dt' })
    await page.getByRole('button', { name: 'Check rows' }).click()

    // 3. Review: counts, each row's problem, possible duplicates left out.
    await expect(page.getByRole('heading', { level: 2, name: 'Review before importing' })).toBeFocused({ timeout: 15_000 })
    const counts = page.getByTestId('import-counts')
    await expect(counts).toContainText('3 ready')
    await expect(counts).toContainText('1 needs fixing')
    await expect(counts).toContainText('1 possible duplicate')
    const table = page.getByRole('table', { name: `Rows in ${SAMPLE_FILE}` })
    await expect(table).toContainText('Date of birth is not a real date.')
    await expect(table).toContainText('Possible duplicate of row 2 in this file (same mobile and date of birth)')
    await expect(page.getByRole('checkbox', { name: 'Include row 4' })).toBeDisabled()
    await expect(page.getByRole('checkbox', { name: 'Include row 5' })).not.toBeChecked()
    await expect(page.getByRole('checkbox', { name: 'Include row 2' })).toBeChecked()
    expect(await axeViolations(page)).toEqual([])

    // Nothing is written before Import.
    const before = await admin().from('patients').select('patient_id').eq('clinic_id', TEST_IDS.clinic).eq('last_name', 'Importspec')
    expect(before.error).toBeNull()
    expect(before.data).toEqual([])

    // 4. Import.
    await page.getByRole('button', { name: 'Import 3 patients' }).click()
    await expect(page.getByRole('status')).toContainText('Imported 3 patients', { timeout: 15_000 })
    expect(await axeViolations(page)).toEqual([])

    // The patients: complete, csv_import, no SMS consent, from one batch.
    const { data: rows, error } = await admin()
      .from('patients')
      .select('first_name, phone, phone_e164, email, state, zip, nkda, allergies, intake_status, source, sms_opt_in, import_batch_id')
      .eq('clinic_id', TEST_IDS.clinic)
      .eq('last_name', 'Importspec')
      .order('first_name')
    expect(error).toBeNull()
    expect(rows?.map(r => r.first_name)).toEqual(['Ada', 'Ben', 'Dee'])
    for (const r of rows ?? []) {
      expect(r.intake_status).toBe('complete')
      expect(r.source).toBe('csv_import')
      expect(r.sms_opt_in).toBe(false)
      expect(r.import_batch_id).toBe(rows?.[0]?.import_batch_id)
    }
    const [ada, ben, dee] = rows ?? []
    expect(ada?.phone_e164).toBe('+16265550101')
    expect(ada?.allergies).toEqual(['Penicillin', 'Sulfa'])
    expect(ben?.phone).toBeNull()
    expect(ben?.state).toBe('TX')
    expect(ben?.nkda).toBe(true)
    expect(dee?.zip).toBe('78701-1234')

    // The batch, for audit.
    const { data: batch } = await admin()
      .from('patient_import_batches')
      .select('clinic_id, file_name, total_rows, imported_rows, excluded_rows, duplicates_confirmed')
      .eq('batch_id', ada?.import_batch_id ?? '')
      .single()
    expect(batch).toEqual({
      clinic_id: TEST_IDS.clinic, file_name: SAMPLE_FILE,
      total_rows: 5, imported_rows: 3, excluded_rows: 2, duplicates_confirmed: 0,
    })
  })
})
