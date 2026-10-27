import { test, expect, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { withPhoneE164 } from '../src/lib/patients/phone'
import { hashIntakeToken, newIntakeToken } from '../src/lib/intake/token'
import { generateCheckoutToken } from '../src/lib/auth/checkout-token'
import { cleanupTestOrders, TEST_IDS, TEST_USERS } from './fixtures/seed'
import { closeTestProposals, seedProposal, TEST_PATIENT_DOB } from './fixtures/proposals'

// ============================================================
// Patient pages on a phone (C-2026-10-25-08), E2E project only
// ============================================================
//
// Patients open their links on phones. The main patient flows at 390x844
// (touch): the plan (date of birth, options, choose, confirm), checkout
// (summary and the payment form container: no card is ever entered and
// nothing is paid), intake (every step, then submit), the clinic sign-up
// link (every step, then submit) and a link that is not valid. After every
// step:
//   - no horizontal overflow: document.scrollingElement.scrollWidth is at
//     most innerWidth (and the 390 px viewport, which a phone browser
//     would otherwise widen to fit overflowing content);
//   - every text input, select and textarea is at least 16 px (iOS zooms
//     the page into a smaller one on focus);
//   - the fields have the right type and autocomplete.
//
// Isolation: patients this spec creates have a mobile in its own range
// (+1 919 555 XXXX, used by no seed or other spec) and are deleted before
// and after, with this spec's own sign-up link. Orders and proposals use
// the shared cleanups (cleanupTestOrders, closeTestProposals).

const PHONE = { width: 390, height: 844 }
test.use({ viewport: PHONE, isMobile: true, hasTouch: true })

const SPEC_PREFIX = '+1919555'
let seq = 0
const freshMobile = () => `${SPEC_PREFIX}${String((Date.now() + ++seq * 7919) % 10_000).padStart(4, '0')}`

function admin() {
  return createClient(process.env['E2E_SUPABASE_URL']!, process.env['E2E_SUPABASE_SERVICE_ROLE_KEY']!)
}

let signupLinkId: string | null = null

async function cleanup(): Promise<void> {
  const db = admin()
  const patients = await db.from('patients').delete().eq('clinic_id', TEST_IDS.clinic).like('phone_e164', `${SPEC_PREFIX}%`)
  if (patients.error) throw new Error(`patient-pages-mobile cleanup: ${patients.error.message}`)
  if (signupLinkId) {
    const link = await db.from('clinic_signup_links').delete().eq('link_id', signupLinkId)
    if (link.error) throw new Error(`patient-pages-mobile link cleanup: ${link.error.message}`)
    signupLinkId = null
  }
  await closeTestProposals()
  await cleanupTestOrders()
}

test.beforeAll(cleanup)
test.afterAll(cleanup)

/** No horizontal scroll, and no input small enough for iOS to zoom on focus. */
async function expectFitsPhone(page: Page, where: string): Promise<void> {
  const m = await page.evaluate(() => {
    const se = document.scrollingElement ?? document.documentElement
    const fields = [...document.querySelectorAll<HTMLElement>('input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea')]
      .filter(el => el.getBoundingClientRect().width > 0 && !el.closest('[aria-hidden="true"]'))
      .map(el => ({ id: el.id || el.getAttribute('name') || el.tagName, fontSize: parseFloat(getComputedStyle(el).fontSize) }))
    return { scrollWidth: se.scrollWidth, innerWidth: window.innerWidth, fields }
  })
  expect(m.scrollWidth, `${where}: horizontal overflow`).toBeLessThanOrEqual(m.innerWidth)
  expect(m.scrollWidth, `${where}: wider than the phone`).toBeLessThanOrEqual(PHONE.width)
  expect(m.fields.filter(f => f.fontSize < 16), `${where}: inputs under 16px`).toEqual([])
}

test.describe('Patient pages on a phone (390x844)', () => {
  test('plan: date of birth, options, choose, confirm', async ({ page }) => {
    const { token } = await seedProposal('open')
    await page.goto(`/plan/${token}`)
    const dob = page.getByLabel('Date of birth')
    await expect(dob).toHaveAttribute('type', 'date')
    await expect(dob).toHaveAttribute('autocomplete', 'bday')
    await expectFitsPhone(page, 'plan: date of birth')
    await dob.fill(TEST_PATIENT_DOB)
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByRole('heading', { name: 'Choose your plan' })).toBeVisible()
    await expect(page.getByText(/^Total$/).first()).toBeVisible()
    await expectFitsPhone(page, 'plan: options')
    await page.getByRole('button', { name: 'Choose this plan' }).first().click()
    await expect(page.getByRole('heading', { name: 'Confirm your choice' })).toBeVisible()
    await expectFitsPhone(page, 'plan: confirm')
    await page.getByRole('button', { name: 'Confirm' }).click()
    await expect(page.getByRole('heading', { name: 'Sent to your provider for final approval' })).toBeVisible()
    await expectFitsPhone(page, 'plan: sent')
  })

  test('checkout: summary and payment form container (no card is entered)', async ({ page }) => {
    const db = admin()
    const { data: order, error } = await db.from('orders').insert({
      patient_id: TEST_IDS.patient, provider_id: TEST_IDS.provider, catalog_item_id: TEST_IDS.catalogItem,
      clinic_id: TEST_IDS.clinic, pharmacy_id: TEST_IDS.pharmacyTier1, status: 'AWAITING_PAYMENT', quantity: 1,
      wholesale_price_snapshot: 100, retail_price_snapshot: 200,
      sig_text: 'Test sig for the phone layout check, at least 10 chars', locked_at: new Date().toISOString(),
    }).select('order_id').single()
    if (error || !order) throw new Error(`checkout order: ${error?.message}`)
    const token = await generateCheckoutToken(order.order_id, TEST_IDS.patient, TEST_IDS.clinic)
    await page.goto(`/checkout/${token}`)
    await expect(page.getByTestId('checkout-amount-due')).toBeVisible()
    const email = page.getByLabel('Email (optional)')
    await expect(email).toBeVisible({ timeout: 20_000 })
    await expect(email).toHaveAttribute('type', 'email')
    await expect(email).toHaveAttribute('autocomplete', 'email')
    await expectFitsPhone(page, 'checkout')
  })

  test('intake: every step, then submit', async ({ page }) => {
    const db = admin()
    const { data, error } = await db.from('patients')
      .insert(withPhoneE164({ clinic_id: TEST_IDS.clinic, phone: freshMobile(), state: 'TX', intake_status: 'pending', source: 'staff', sms_opt_in: false }))
      .select('patient_id').single()
    if (error || !data) throw new Error(`intake patient: ${error?.message}`)
    const token = newIntakeToken()
    const link = await db.from('patient_intake_links').insert({
      clinic_id: TEST_IDS.clinic, patient_id: data.patient_id, token_hash: hashIntakeToken(token),
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    })
    if (link.error) throw new Error(`intake link: ${link.error.message}`)

    await page.goto(`/intake/${token}`)
    await runIntakeSteps(page, 'intake')
    await expect(page.getByRole('heading', { name: 'Thank you' })).toBeVisible()
    await expectFitsPhone(page, 'intake: done')
  })

  test('sign-up link: every step, then submit', async ({ page }) => {
    const db = admin()
    const { data: users } = await db.auth.admin.listUsers()
    const createdBy = users.users.find(u => u.email === TEST_USERS.clinicAdmin.email)?.id
    if (!createdBy) throw new Error('clinic admin user not found')
    // One active link per clinic: retire any open one, then add this
    // spec's own (deleted in cleanup). The page looks a link up by the
    // hash of its token.
    const revoked = await db.from('clinic_signup_links').update({ revoked_at: new Date().toISOString(), revoked_by: createdBy })
      .eq('clinic_id', TEST_IDS.clinic).is('revoked_at', null)
    if (revoked.error) throw new Error(`sign-up link revoke: ${revoked.error.message}`)
    const token = newIntakeToken()
    const { data: link, error } = await db.from('clinic_signup_links')
      .insert({ clinic_id: TEST_IDS.clinic, token_hash: hashIntakeToken(token), enabled: true, created_by: createdBy })
      .select('link_id').single()
    if (error || !link) throw new Error(`sign-up link: ${error?.message}`)
    signupLinkId = link.link_id

    await page.goto(`/join/${token}`)
    const mobile = page.getByLabel('Mobile number')
    await expect(mobile).toHaveAttribute('type', 'tel')
    await expect(mobile).toHaveAttribute('autocomplete', 'tel')
    await mobile.fill(freshMobile().replace('+1', ''))
    await runIntakeSteps(page, 'join')
    await expect(page.getByRole('heading', { name: 'Thank you' })).toBeVisible()
    await expectFitsPhone(page, 'join: done')
  })

  test('a link that is not valid', async ({ page }) => {
    await page.goto(`/plan/${'A'.repeat(43)}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expectFitsPhone(page, 'plan: not valid')
    await page.goto(`/intake/${newIntakeToken()}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expectFitsPhone(page, 'intake: not valid')
  })
})

/** Consent, details (typed), address, health, review, submit; checks after each step. */
async function runIntakeSteps(page: Page, where: string): Promise<void> {
  await expectFitsPhone(page, `${where}: consent`)
  await page.getByLabel('I have read the privacy notice.').check()
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page.getByRole('heading', { name: 'Your details' })).toBeVisible()
  await expectFitsPhone(page, `${where}: details (choose)`)
  await page.getByRole('button', { name: 'Type my details' }).click()
  const fields: Array<[string, string]> = [['First name', 'given-name'], ['Last name', 'family-name'], ['Date of birth', 'bday']]
  for (const [label, autocomplete] of fields) await expect(page.getByLabel(label)).toHaveAttribute('autocomplete', autocomplete)
  await expect(page.getByLabel('Date of birth')).toHaveAttribute('type', 'date')
  await page.getByLabel('First name').fill('Maximiliana-Alexandrina')
  await page.getByLabel('Last name').fill('Wolfeschlegelsteinhausenbergerdorff')
  await page.getByLabel('Date of birth').fill('1980-01-02')
  await page.getByLabel('Female').check()
  await expectFitsPhone(page, `${where}: details (typed)`)
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page.getByRole('heading', { name: 'Shipping address' })).toBeVisible()
  const address: Array<[string, string]> = [['Street address', 'address-line1'], ['City', 'address-level2'], ['State', 'address-level1'], ['ZIP code', 'postal-code']]
  for (const [label, autocomplete] of address) await expect(page.getByLabel(label)).toHaveAttribute('autocomplete', autocomplete)
  await page.getByLabel('Street address').fill('12345 Extraordinarily Long Boulevard Northwest')
  await page.getByLabel('City').fill('Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch')
  await page.getByLabel('State').selectOption('TX')
  await page.getByLabel('ZIP code').fill('78701')
  await expectFitsPhone(page, `${where}: address`)
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page.getByRole('heading', { name: 'Allergies and medications' })).toBeVisible()
  await page.getByLabel('No known drug allergies').check()
  await expectFitsPhone(page, `${where}: health`)
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page.getByRole('heading', { name: 'Check and submit' })).toBeVisible()
  await expectFitsPhone(page, `${where}: review (long name and city)`)
  await page.getByRole('button', { name: 'Submit' }).click()
}
