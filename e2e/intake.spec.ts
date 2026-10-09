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
// Each run uses a fresh mobile number; the rows it adds are soft-deleted
// afterwards.

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

/** A US mobile in the 555-01xx fiction range, unique per run. */
function freshMobile(): string {
  return `+1512555${String(100 + Math.floor(Math.random() * 9900)).padStart(4, '0')}`
}

const created: string[] = []

async function pendingPatientWithLink(): Promise<{ patientId: string; token: string }> {
  const supabase = admin()
  const { data, error } = await supabase
    .from('patients')
    .insert(withPhoneE164({ clinic_id: TEST_IDS.clinic, phone: freshMobile(), state: 'TX', intake_status: 'pending', source: 'staff', sms_opt_in: false }))
    .select('patient_id')
    .single()
  if (error || !data) throw new Error(`Failed to create a pending patient: ${error?.message}`)
  created.push(data.patient_id)
  const token = newIntakeToken()
  const { error: linkError } = await supabase.from('patient_intake_links').insert({
    clinic_id: TEST_IDS.clinic, patient_id: data.patient_id, token_hash: hashIntakeToken(token),
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
  })
  if (linkError) throw new Error(`Failed to create an intake link: ${linkError.message}`)
  return { patientId: data.patient_id, token }
}

test.afterAll(async () => {
  if (created.length === 0) return
  await admin().from('patients').update({ is_active: false, deleted_at: new Date().toISOString() }).in('patient_id', created)
})

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

    // Single use: the same link now says it was used.
    await page.goto(`/intake/${token}`)
    await expect(page.getByRole('heading', { level: 1, name: 'This link has already been used' })).toBeVisible({ timeout: 15_000 })
    expect(await axeViolations(page)).toEqual([])
  })

  test('an unknown link says it is not valid', async ({ page }) => {
    await page.goto(`/intake/${newIntakeToken()}`)
    await expect(page.getByRole('heading', { level: 1, name: 'This link is not valid' })).toBeVisible({ timeout: 15_000 })
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
    await form.getByLabel('Mobile number').fill(freshMobile().slice(2))
    await form.getByLabel('State (optional)').selectOption('TX')
    expect(await axeViolations(page)).toEqual([])
    await form.getByRole('button', { name: 'Add patient' }).click()

    const panel = page.getByRole('region', { name: 'Intake link' })
    await expect(panel).toBeVisible({ timeout: 15_000 })
    const url = await panel.getByLabel('Intake link for the patient').inputValue()
    expect(url).toMatch(/\/intake\/[A-Za-z0-9_-]{43}$/)
    await expect(panel.getByRole('link', { name: 'Email this link' })).toHaveAttribute('href', /^mailto:/)
    await expect(page.getByRole('button', { name: /New patient \(mobile ending \d{4}\)/ })).toHaveAttribute('aria-pressed', 'true')
    expect(await axeViolations(page)).toEqual([])

    const { data: rows } = await admin().from('patients').select('patient_id').eq('clinic_id', TEST_IDS.clinic).eq('intake_status', 'pending').is('first_name', null)
    for (const r of rows ?? []) created.push(r.patient_id)
  })
})
