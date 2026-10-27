import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { createClient } from '@supabase/supabase-js'
import { withPhoneE164 } from '../src/lib/patients/phone'
import { hashIntakeToken, newIntakeToken } from '../src/lib/intake/token'
import { TEST_IDS, TEST_USERS } from './fixtures/seed'

// ============================================================
// Patient Intake PR 2, end to end (E2E project only)
// ============================================================
//
//   - A patient opens their intake link, gives consent, types their
//     details, address and allergies, and submits. Every step: axe in
//     Chromium (contrast included) and reflow at 320 CSS px. The patient
//     ends 'complete' and the link is used (single use).
//   - A used link says so.
//   - Staff add a patient with only a mobile number and get the link to
//     copy or email.
//
// Isolation: the E2E database is shared and persistent. Every patient this
// spec creates has a mobile in its own range (+1 737 555 XXXX, SPEC_PREFIX,
// used by no seed or other spec), and is selected by its exact number. In
// beforeAll and afterAll the spec deletes its own patients (their intake
// links cascade): the SPEC_PREFIX range, plus the pending, unnamed rows
// earlier versions of this spec left in +1 512 555 XXXX. Seeded patients
// and other specs' patients are never touched.

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

function admin() {
  return createClient(process.env['E2E_SUPABASE_URL']!, process.env['E2E_SUPABASE_SERVICE_ROLE_KEY']!)
}

async function axeViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
  return results.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)
}

async function expectReflowsAt320(page: Page) {
  const before = page.viewportSize()
  await page.setViewportSize({ width: 320, height: 640 })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  if (before) await page.setViewportSize(before)
}

/** This spec's mobile range: +1 737 555 XXXX. */
const SPEC_PREFIX = '+1737555'
/** What earlier versions of this spec used (pending, unnamed rows only). */
const LEGACY_PREFIX = '+1512555'

let mobileSeq = 0
/**
 * A mobile in this spec's range, distinct within a run (a counter) and
 * unlikely to repeat across runs (from the clock). Leftovers from earlier
 * runs are deleted in beforeAll, so a repeat could not match them anyway.
 */
function freshMobile(): string {
  mobileSeq += 1
  return `${SPEC_PREFIX}${String((Date.now() + mobileSeq * 7919) % 10_000).padStart(4, '0')}`
}

/** The label Select Patient gives an unnamed patient with this mobile. */
function unnamedLabel(e164: string): string {
  return `New patient (mobile ending ${e164.slice(-4)})`
}

/** Delete this spec's patients in the test clinic (intake links cascade). */
async function deleteSpecPatients(): Promise<void> {
  const supabase = admin()
  const own = await supabase.from('patients').delete()
    .eq('clinic_id', TEST_IDS.clinic)
    .like('phone_e164', `${SPEC_PREFIX}%`)
  if (own.error) throw new Error(`intake.spec cleanup failed: ${own.error.message}`)
  const legacy = await supabase.from('patients').delete()
    .eq('clinic_id', TEST_IDS.clinic)
    .like('phone_e164', `${LEGACY_PREFIX}%`)
    .eq('intake_status', 'pending')
    .is('first_name', null)
    .is('last_name', null)
  if (legacy.error) throw new Error(`intake.spec legacy cleanup failed: ${legacy.error.message}`)
}

async function pendingPatientWithLink(): Promise<{ patientId: string; token: string }> {
  const supabase = admin()
  const { data, error } = await supabase
    .from('patients')
    .insert(withPhoneE164({ clinic_id: TEST_IDS.clinic, phone: freshMobile(), state: 'TX', intake_status: 'pending', source: 'staff', sms_opt_in: false }))
    .select('patient_id')
    .single()
  if (error || !data) throw new Error(`Failed to create a pending patient: ${error?.message}`)
  const token = newIntakeToken()
  const { error: linkError } = await supabase.from('patient_intake_links').insert({
    clinic_id: TEST_IDS.clinic, patient_id: data.patient_id, token_hash: hashIntakeToken(token),
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
  })
  if (linkError) throw new Error(`Failed to create an intake link: ${linkError.message}`)
  return { patientId: data.patient_id, token }
}

test.beforeAll(async () => { await deleteSpecPatients() })
test.afterAll(async () => { await deleteSpecPatients() })

test.describe('Patient Intake PR 2', () => {
  test('a patient completes intake: accessible at every step, then complete and the link used', async ({ page }) => {
    const { patientId, token } = await pendingPatientWithLink()
    await page.goto(`/intake/${token}`)
    await expect(page).toHaveTitle('Complete your details')
    await expect(page.getByRole('heading', { level: 1, name: 'Complete your details' })).toBeVisible({ timeout: 15_000 })
    expect(await axeViolations(page)).toEqual([])
    await expectReflowsAt320(page)

    // 1. Consent: the privacy notice is required.
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByRole('checkbox', { name: /I have read the privacy notice/ })).toHaveAttribute('aria-invalid', 'true')
    expect(await axeViolations(page)).toEqual([])
    await page.getByRole('checkbox', { name: /I have read the privacy notice/ }).check()
    await page.getByRole('button', { name: 'Continue' }).click()

    // 2. Details, typed.
    await expect(page.getByRole('heading', { level: 2, name: 'Your details' })).toBeFocused()
    expect(await axeViolations(page)).toEqual([])
    await page.getByRole('button', { name: 'Type my details' }).click()
    await page.getByLabel('First name').fill('Erin')
    await page.getByLabel('Last name').fill('Intake')
    await page.getByLabel('Date of birth').fill('1988-03-09')
    await page.getByRole('radio', { name: 'Prefer not to say' }).check()
    expect(await axeViolations(page)).toEqual([])
    await expectReflowsAt320(page)
    await page.getByRole('button', { name: 'Continue' }).click()

    // 3. Address.
    await expect(page.getByRole('heading', { level: 2, name: 'Shipping address' })).toBeFocused()
    await page.getByLabel('Street address').fill('100 Congress Ave')
    await page.getByLabel('City').fill('Austin')
    await page.getByLabel('State', { exact: true }).selectOption('TX')
    await page.getByLabel('ZIP code').fill('78701')
    expect(await axeViolations(page)).toEqual([])
    await expectReflowsAt320(page)
    await page.getByRole('button', { name: 'Continue' }).click()

    // 4. Allergies and medications.
    await page.getByRole('radio', { name: 'No known drug allergies' }).check()
    await page.getByLabel('Current medications (optional)').fill('None')
    expect(await axeViolations(page)).toEqual([])
    await page.getByRole('button', { name: 'Continue' }).click()

    // 5. Submit.
    await expect(page.getByRole('heading', { level: 2, name: 'Check and submit' })).toBeFocused()
    expect(await axeViolations(page)).toEqual([])
    await page.getByRole('button', { name: 'Submit' }).click()
    await expect(page.getByRole('heading', { level: 2, name: 'Thank you' })).toBeVisible({ timeout: 15_000 })
    expect(await axeViolations(page)).toEqual([])

    const { data: patient } = await admin()
      .from('patients')
      .select('intake_status, first_name, last_name, date_of_birth, sex, state, nkda, sms_opt_in, sms_consent_source, privacy_notice_version, intake_completed_at')
      .eq('patient_id', patientId)
      .single()
    expect(patient).toEqual(expect.objectContaining({
      intake_status: 'complete', first_name: 'Erin', last_name: 'Intake', date_of_birth: '1988-03-09', sex: 'unknown',
      state: 'TX', nkda: true, sms_opt_in: false, sms_consent_source: 'self_intake',
    }))
    expect(patient?.privacy_notice_version).toBeTruthy()
    expect(patient?.intake_completed_at).toBeTruthy()

    // Single use: the same link is no longer active (the neutral page).
    await page.goto(`/intake/${token}`)
    await expect(page.getByRole('heading', { level: 1, name: 'This link is no longer active' })).toBeVisible({ timeout: 15_000 })
    expect(await axeViolations(page)).toEqual([])
  })

  test('an unknown link gets the same neutral page', async ({ page }) => {
    await page.goto(`/intake/${newIntakeToken()}`)
    await expect(page.getByRole('heading', { level: 1, name: 'This link is no longer active' })).toBeVisible({ timeout: 15_000 })
    expect(await axeViolations(page)).toEqual([])
  })

  test('staff add a patient with only a mobile number and get the intake link', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Email').fill(TEST_USERS.provider.email)
    await page.getByLabel('Password').fill(TEST_USERS.provider.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 })

    await page.goto('/new-prescription')
    await page.getByRole('button', { name: '+ New patient' }).click()
    const form = page.getByRole('region', { name: 'New patient' })
    const mobile = freshMobile()
    await form.getByLabel('Mobile number').fill(mobile.slice(2))
    await form.getByLabel('State (optional)').selectOption('TX')
    expect(await axeViolations(page)).toEqual([])
    await form.getByRole('button', { name: 'Add patient' }).click()

    const panel = page.getByRole('region', { name: 'Intake link' })
    await expect(panel).toBeVisible({ timeout: 15_000 })
    const url = await panel.getByLabel('Intake link for the patient').inputValue()
    expect(url).toMatch(/\/intake\/[A-Za-z0-9_-]{43}$/)
    await expect(panel.getByRole('link', { name: 'Email this link' })).toHaveAttribute('href', /^mailto:/)
    // Exactly the patient this test created: the row's name starts with the
    // label for its own mobile (then DOB, chips and the number), so the
    // full label is matched, never a generic "New patient" pattern.
    const row = page.getByRole('button', { name: unnamedLabel(mobile) })
    await expect(row).toHaveCount(1)
    await expect(row).toHaveAttribute('aria-pressed', 'true')
    expect(await axeViolations(page)).toEqual([])

    // The row in the database: this mobile, this clinic, pending, unnamed.
    const { data: rows, error } = await admin().from('patients')
      .select('patient_id, intake_status, first_name, last_name, source')
      .eq('clinic_id', TEST_IDS.clinic)
      .eq('phone_e164', mobile)
    expect(error).toBeNull()
    expect(rows).toEqual([expect.objectContaining({ intake_status: 'pending', first_name: null, last_name: null, source: 'staff' })])
  })
})
