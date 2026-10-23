import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { TEST_IDS, TEST_USERS } from './fixtures/seed'

// ============================================================
// Patient Intake PR 4: face-sheet fill, end to end (E2E project only)
// ============================================================
//
// New Prescription > Select Patient > + New patient > Drop a face sheet:
// staff choose a PDF; the values prefill the form and say "From face
// sheet"; staff edit one and click Add patient; the patient is saved
// through POST /api/patients (pending, with the intake link).
//
// The read is MOCKED: the browser's POST /api/patients/face-sheet is
// answered by page.route, so no face sheet ever reaches Claude from E2E
// (the E2E job sets a placeholder ANTHROPIC_API_KEY only so the page
// offers the entry point). The save is real.
//
// Isolation: the patient has a mobile in this spec's own range
// (+1 415 555 XXXX, used by no seed or other spec) and a last name unique
// to the run. beforeAll and afterAll delete this spec's patients in the
// test clinic (their intake links cascade).

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']
const SPEC_PREFIX = '+1415555'
const RUN = randomUUID().replace(/[^a-f]/g, '').slice(0, 6) || 'abcdef'
const LAST_NAME = `Facesheet${RUN}`
const MOBILE = `${SPEC_PREFIX}${String(Date.now() % 10_000).padStart(4, '0')}`

function admin() {
  return createClient(process.env['E2E_SUPABASE_URL']!, process.env['E2E_SUPABASE_SERVICE_ROLE_KEY']!)
}

async function deleteSpecPatients() {
  const { error } = await admin().from('patients').delete().eq('clinic_id', TEST_IDS.clinic).like('phone_e164', `${SPEC_PREFIX}%`)
  if (error) throw new Error(`face-sheet-fill.spec cleanup failed: ${error.message}`)
}

async function axeViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
  return results.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)
}

const MOCK = {
  fields: {
    firstName: 'Jordan', lastName: LAST_NAME, dateOfBirth: '1979-11-02', sex: 'male', mobile: MOBILE, email: `jordan.${RUN}@example.test`,
    addressLine1: '500 Congress Ave', addressLine2: null, city: 'Austin', state: 'TX', zip: '78701',
    allergies: ['Penicillin'], nkda: false, currentMedications: 'Metformin 500 mg twice daily',
  },
  filled: ['firstName', 'lastName', 'dateOfBirth', 'sex', 'mobile', 'email', 'addressLine1', 'city', 'state', 'zip', 'allergies', 'currentMedications'],
}

test.beforeAll(deleteSpecPatients)
test.afterAll(deleteSpecPatients)

test.describe('Patient Intake PR 4: face-sheet fill', () => {
  test('drop a face sheet: the form is prefilled for review, nothing saves until Add patient, then it saves as usual', async ({ page }) => {
    let faceSheetCalls = 0
    await page.route('**/api/patients/face-sheet', async route => {
      faceSheetCalls += 1
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK) })
    })
    let saves = 0
    page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/patients') saves += 1 })

    await page.goto('/login')
    await page.getByLabel('Email').fill(TEST_USERS.provider.email)
    await page.getByLabel('Password').fill(TEST_USERS.provider.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 })

    await page.goto('/new-prescription')
    await page.getByRole('button', { name: '+ New patient' }).click()
    const form = page.getByRole('region', { name: 'New patient' })
    const drop = form.getByRole('group', { name: 'Drop a face sheet' })
    await expect(drop).toBeVisible()
    expect(await axeViolations(page)).toEqual([])

    await drop.getByLabel('Choose a face sheet file').setInputFiles({
      name: 'face-sheet.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n% E2E placeholder, never read\n'),
    })
    await expect(form.getByRole('status')).toHaveText('Filled 12 fields from the face sheet. Check each one before you add the patient.')
    expect(faceSheetCalls).toBe(1)

    await expect(form.getByLabel(/^Last name/)).toHaveValue(LAST_NAME)
    await expect(form.getByLabel(/^Date of birth/)).toHaveValue('1979-11-02')
    await expect(form.getByLabel(/^Drug allergies/)).toHaveValue('Penicillin')
    await expect(form.getByLabel(/^First name/)).toHaveAccessibleName(/From face sheet/)
    await expect(form.getByLabel(/^Address line 2/)).not.toHaveAccessibleName(/From face sheet/)
    expect(await axeViolations(page)).toEqual([])
    // Reviewed, not saved.
    expect(saves).toBe(0)

    await form.getByLabel(/^City/).fill('Round Rock')
    await form.getByRole('button', { name: 'Add patient' }).click()
    await expect(page.getByRole('region', { name: 'Intake link' })).toBeVisible({ timeout: 15_000 })
    expect(saves).toBe(1)

    // Saved through the usual path: pending, source staff, the reviewed values.
    const { data: rows, error } = await admin().from('patients')
      .select('first_name, last_name, date_of_birth, sex, city, zip, allergies, nkda, current_medications, intake_status, source')
      .eq('clinic_id', TEST_IDS.clinic).eq('phone_e164', MOBILE)
    expect(error).toBeNull()
    expect(rows).toEqual([expect.objectContaining({
      first_name: 'Jordan', last_name: LAST_NAME, date_of_birth: '1979-11-02', sex: 'male', city: 'Round Rock', zip: '78701',
      allergies: ['Penicillin'], nkda: false, current_medications: 'Metformin 500 mg twice daily',
      intake_status: 'pending', source: 'staff',
    })])
  })
})
