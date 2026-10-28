import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { createClient } from '@supabase/supabase-js'
import { TEST_IDS, TEST_USERS } from './fixtures/seed'

// ============================================================
// Patient Intake PR 3: clinic sign-up link, end to end (E2E project only)
// ============================================================
//
// The clinic admin creates the clinic's sign-up link in Settings (link and
// QR code). A new patient opens it with no session, signs up through the
// self-intake steps with a mobile number, and is created in the clinic,
// complete, source signup_link, no SMS consent. The admin turns the link
// off (the page says it is no longer active), back on, then makes a new
// link (the old one stops working). axe in Chromium (contrast included)
// on Settings and every /join step.
//
// Isolation: the E2E database is shared and persistent. The patient has a
// mobile in this spec's own range (+1 646 555 XXXX, SPEC_PREFIX, used by
// no seed or other spec; intake.spec uses +1 737 555, patient-import.spec
// +1 626 555). In beforeAll and afterAll the spec deletes those patients in
// the test clinic, then the test clinic's sign-up links (no other spec
// uses them). Seeded patients and other specs' patients are never touched.

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

/** This spec's mobile range: +1 646 555 XXXX. */
const SPEC_PREFIX = '+1646555'
const MOBILE_TYPED = '(646) 555-0101'
const MOBILE_E164 = '+16465550101'
const INACTIVE = 'Sign-up links stop working when your clinic turns them off or makes a new one. Please contact your clinic if you need a new link or have questions.'

function admin() {
  return createClient(process.env['E2E_SUPABASE_URL']!, process.env['E2E_SUPABASE_SERVICE_ROLE_KEY']!)
}

async function axeViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
  return results.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)
}

/** Delete this spec's patients in the test clinic, then the clinic's sign-up links. */
async function deleteSpecData(): Promise<void> {
  const supabase = admin()
  const patients = await supabase.from('patients').delete()
    .eq('clinic_id', TEST_IDS.clinic)
    .like('phone_e164', `${SPEC_PREFIX}%`)
  if (patients.error) throw new Error(`patient-signup-link.spec cleanup failed: ${patients.error.message}`)
  const links = await supabase.from('clinic_signup_links').delete().eq('clinic_id', TEST_IDS.clinic)
  if (links.error) throw new Error(`patient-signup-link.spec link cleanup failed: ${links.error.message}`)
}

test.beforeAll(async () => { await deleteSpecData() })
test.afterAll(async () => { await deleteSpecData() })

test.describe('Patient Intake PR 3: clinic sign-up link', () => {
  test('the admin makes the link; a new patient signs up; off, on, and a new link', async ({ page, browser }) => {
    test.setTimeout(120_000)

    // ── The clinic admin: Settings > Patients > Patient sign-up link ──
    await page.goto('/login')
    await page.getByLabel('Email').fill(TEST_USERS.clinicAdmin.email)
    await page.getByLabel('Password').fill(TEST_USERS.clinicAdmin.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(/\/practice$/, { timeout: 15_000 })

    await page.goto('/settings')
    await page.getByTestId('settings-patients').getByRole('link', { name: 'Patient sign-up link' }).click()
    await expect(page).toHaveURL(/\/settings\/patients\/signup-link$/, { timeout: 15_000 })
    await expect(page.getByRole('heading', { level: 1, name: 'Patient sign-up link' })).toBeVisible({ timeout: 15_000 })
    expect(await axeViolations(page)).toEqual([])

    await page.getByRole('button', { name: 'Create a sign-up link' }).click()
    const linkField = page.getByLabel('Sign-up link', { exact: true })
    await expect(linkField).toHaveValue(/\/join\/[A-Za-z0-9_-]{43}$/, { timeout: 15_000 })
    await expect(page.getByRole('img', { name: 'QR code for the patient sign-up link' }).first()).toBeVisible()
    expect(await axeViolations(page)).toEqual([])
    const firstPath = new URL(await linkField.inputValue()).pathname

    // ── A new patient, no session ──
    const patientContext = await browser.newContext()
    const patient = await patientContext.newPage()
    const joinUrl = (p: string) => new URL(p, page.url()).toString()
    await patient.goto(joinUrl(firstPath))
    await expect(patient).toHaveTitle(/Sign up as a new patient/)
    await expect(patient.getByRole('heading', { level: 1, name: 'Sign up as a new patient' })).toBeVisible({ timeout: 15_000 })
    expect(await axeViolations(patient)).toEqual([])

    // 1. Consent and mobile: the mobile is required.
    await patient.getByRole('checkbox', { name: /I have read the privacy notice/ }).check()
    await patient.getByRole('button', { name: 'Continue' }).click()
    await expect(patient.getByLabel('Mobile number')).toHaveAttribute('aria-invalid', 'true')
    expect(await axeViolations(patient)).toEqual([])
    await patient.getByLabel('Mobile number').fill(MOBILE_TYPED)
    await patient.getByRole('button', { name: 'Continue' }).click()

    // 2. Details, typed.
    await expect(patient.getByRole('heading', { level: 2, name: 'Your details' })).toBeVisible()
    await patient.getByRole('button', { name: 'Type my details' }).click()
    await patient.getByLabel('First name').fill('Sana')
    await patient.getByLabel('Last name').fill('Signupspec')
    await patient.getByLabel('Date of birth').fill('1988-03-09')
    await patient.getByRole('radio', { name: 'Female' }).check()
    expect(await axeViolations(patient)).toEqual([])
    await patient.getByRole('button', { name: 'Continue' }).click()

    // 3. Address.
    await expect(patient.getByRole('heading', { level: 2, name: 'Shipping address' })).toBeVisible()
    await patient.getByLabel('Street address').fill('100 Congress Ave')
    await patient.getByLabel('City').fill('Austin')
    await patient.getByLabel('State').selectOption('TX')
    await patient.getByLabel('ZIP code').fill('78701')
    expect(await axeViolations(patient)).toEqual([])
    await patient.getByRole('button', { name: 'Continue' }).click()

    // 4. Allergies and medications.
    await expect(patient.getByRole('heading', { level: 2, name: 'Allergies and medications' })).toBeVisible()
    await patient.getByRole('radio', { name: 'No known drug allergies' }).check()
    expect(await axeViolations(patient)).toEqual([])
    await patient.getByRole('button', { name: 'Continue' }).click()

    // 5. Review and submit.
    await expect(patient.getByRole('heading', { level: 2, name: 'Check and submit' })).toBeVisible()
    await expect(patient.getByRole('main')).toContainText(MOBILE_TYPED)
    expect(await axeViolations(patient)).toEqual([])
    await patient.getByRole('button', { name: 'Submit' }).click()
    await expect(patient.getByRole('heading', { level: 2, name: 'Thank you' })).toBeVisible({ timeout: 15_000 })
    expect(await axeViolations(patient)).toEqual([])

    // The patient: in the test clinic, complete, from the sign-up link, no texts.
    const { data: rows, error } = await admin()
      .from('patients')
      .select('first_name, last_name, phone, phone_e164, state, nkda, intake_status, source, sms_opt_in, signup_link_id')
      .eq('clinic_id', TEST_IDS.clinic)
      .eq('phone_e164', MOBILE_E164)
    expect(error).toBeNull()
    expect(rows).toHaveLength(1)
    expect(rows?.[0]).toMatchObject({
      first_name: 'Sana', last_name: 'Signupspec', phone: MOBILE_E164, state: 'TX', nkda: true,
      intake_status: 'complete', source: 'signup_link', sms_opt_in: false,
    })
    expect(rows?.[0]?.signup_link_id).toEqual(expect.any(String))

    // ── Turn off: the patient page says the link is no longer active ──
    await page.reload()
    await expect(page.getByText(/Used 1 time\b/)).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: 'Turn off' }).click()
    await expect(page.getByText(/This link is off/)).toBeVisible({ timeout: 15_000 })
    expect(await axeViolations(page)).toEqual([])
    await patient.goto(joinUrl(firstPath))
    await expect(patient.getByRole('heading', { level: 1, name: 'This link is no longer active' })).toBeVisible({ timeout: 15_000 })
    await expect(patient.getByRole('main')).toContainText(INACTIVE)
    expect(await axeViolations(patient)).toEqual([])

    // ── Turn on, then make a new link: the old one stops working ──
    await page.getByRole('button', { name: 'Turn on' }).click()
    await expect(page.getByText(/This link is off/)).toHaveCount(0, { timeout: 15_000 })
    await page.getByRole('button', { name: 'Make a new link' }).click()
    await expect(page.getByText(/any printed QR codes will stop working/)).toBeVisible()
    expect(await axeViolations(page)).toEqual([])
    await page.getByRole('button', { name: 'Yes, make a new link' }).click()
    await expect(linkField).not.toHaveValue(new RegExp(`${firstPath}$`), { timeout: 15_000 })
    const secondPath = new URL(await linkField.inputValue()).pathname
    expect(secondPath).toMatch(/^\/join\/[A-Za-z0-9_-]{43}$/)

    await patient.goto(joinUrl(firstPath))
    await expect(patient.getByRole('main')).toContainText(INACTIVE, { timeout: 15_000 })
    await patient.goto(joinUrl(secondPath))
    await expect(patient.getByRole('heading', { level: 1, name: 'Sign up as a new patient' })).toBeVisible({ timeout: 15_000 })

    await patientContext.close()
  })
})
