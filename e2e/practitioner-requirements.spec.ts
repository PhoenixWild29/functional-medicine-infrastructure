import { test, expect, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { seedStaticData, cleanupTestOrders, cleanupTestFavorites, TEST_IDS, TEST_USERS, TEST_CATALOG } from './fixtures/seed'
import { dispenseQuantity } from '../src/lib/orders/rx-details'
import { buildPrescriptionPdfBytes, type PrescriptionPdfData } from '../src/lib/adapters/prescription-pdf'

// ============================================================
// The practitioner's requirements, end to end (B-2026-10-25-10)
// ============================================================
//
// One walk through what the NP asked for, so the bundle's PR run proves
// them together. Seed tables only (e2e/fixtures/seed.ts):
//   1. A GLP-1 injectable (the seed's GLP-1 analogue, 5 mg/mL) at Tier2,
//      80 units weekly for 90 days: no single vial holds it, so the
//      builder suggests 2 x 5 mL vials. Days supply, refills, clinical
//      difference (required, chosen), syringes, cold-chain shipping,
//      diagnosis and special instructions are set on Review, and Review
//      shows the dispense with its vials.
//   2. A second line at another pharmacy (Tier4): the price page shows
//      the double-shipping notice.
//   Both lines are saved as drafts by the clinic admin for the test
//   provider (a provider's Review offers Sign & Send, not Save as
//   Draft), so the provider then finds them under Drafts.
//   3. The patient has no allergies recorded: Sign all opens the batch
//      page with every draft for the patient; signing stops at "Record
//      allergies or mark NKDA before signing"; NKDA is marked inline and
//      signing goes on. Both orders are signed.
//   4. The fax PDF for the signed GLP-1 order says "Quantity: 2 vials".
//      There is no UI path to the outbound Rx PDF in E2E (it is built
//      when a paid Tier 4 order is faxed), so this builds it from the
//      signed order with the app's own quantity rule (dispenseQuantity)
//      and PDF builder (buildPrescriptionPdfBytes), as submitTier4Fax
//      does. Jest covers the adapter end of it
//      (src/lib/adapters/__tests__/rx-quantity-payloads.test.ts).
//   5. Favorites: Frequently used shows the dose just ordered; Make
//      favorite for this patient; the favorite opens the dose step with
//      the dropdowns filled.
// No card is entered anywhere.
//
// Locators are test ids, labels and roles inside named regions, never
// getByRole('alert') (Next's route announcer also has that role).
//
// Data: "Patient, Test" is put in the "allergies not recorded" state
// first and back to NKDA afterwards (the seeded state other specs sign
// with). Test orders and favorites are cleaned before and after.

const svc = () => createClient(process.env['E2E_SUPABASE_URL']!, process.env['E2E_SUPABASE_SERVICE_ROLE_KEY']!)

const SPECIAL_INSTRUCTIONS = 'Keep refrigerated. Deliver to the clinic front desk.'
const CLINICAL_DIFFERENCE = TEST_CATALOG.glp1ClinicalDifferenceOptions[0]!

/** Signs in fresh (any earlier session's cookies cleared first). */
async function loginAs(page: Page, user: { email: string; password: string; role: string }) {
  await page.context().clearCookies()
  await page.goto('/login')
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill(user.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  // The clinic admin lands on the Practice dashboard; a provider on /dashboard.
  await expect(page).toHaveURL(user.role === 'clinic_admin' ? /\/practice$/ : /\/dashboard/, { timeout: 15_000 })
}

/**
 * Step 0 for "Patient, Test", landing on the builder. A clinic admin
 * picks the test provider (the one with a login) when a list is shown;
 * a provider login has no list.
 */
async function startSession(page: Page) {
  await page.goto('/new-prescription')
  await page.getByLabel('Search patients').fill('Test')
  await page.getByRole('button', { name: /Patient,\s*Test/i }).click()
  const provider = page.getByRole('button', { name: /Provider,\s*Test/i })
  if (await provider.count() > 0) await provider.click()
  await page.getByRole('button', { name: 'Continue to Pharmacy Search' }).click()
  await expect(page).toHaveURL(/\/new-prescription\/search/, { timeout: 10_000 })
}

/** The same strokes the WO-99 spec draws: three across 80% of the pad. */
async function drawSignature(page: Page) {
  const pad = page.locator('canvas[aria-label="Provider signature pad"]')
  await pad.scrollIntoViewIfNeeded()
  const box = (await pad.boundingBox())!
  for (let i = 0; i < 3; i++) {
    const y = box.y + box.height * (0.25 + 0.25 * i)
    await page.mouse.move(box.x + box.width * 0.1, y)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.5, y + 6, { steps: 8 })
    await page.mouse.move(box.x + box.width * 0.9, y, { steps: 8 })
    await page.mouse.up()
  }
}

async function setAllergiesNotRecorded() {
  const { error } = await svc().from('patients')
    .update({ allergies: null, nkda: false, allergies_updated_at: null })
    .eq('patient_id', TEST_IDS.patient)
  if (error) throw new Error(`practitioner-requirements: allergies reset failed: ${error.message}`)
}

async function restoreNkda() {
  await svc().from('patients')
    .update({ allergies: [], nkda: true, allergies_updated_at: new Date().toISOString() })
    .eq('patient_id', TEST_IDS.patient)
}

async function patientOrders() {
  const { data } = await svc()
    .from('orders')
    .select('order_id, status, formulation_id, pharmacy_id, quantity, package_label, package_count, days_supply, dispense_quantity, dispense_unit, refills, syringe_option, shipping_type, clinical_difference, diagnosis_code, diagnosis_text, special_instructions, sig_text, medication_snapshot, provider_npi_snapshot, locked_at, created_at, order_number')
    .eq('clinic_id', TEST_IDS.clinic)
    .eq('patient_id', TEST_IDS.patient)
    .eq('is_active', true)
    .order('created_at', { ascending: true })
  return data ?? []
}

test.describe("Practitioner's requirements, end to end", () => {
  test.beforeAll(async () => {
    await seedStaticData()
  })

  test.beforeEach(async () => {
    await cleanupTestOrders()
    await cleanupTestFavorites()
    await setAllergiesNotRecorded()
  })

  test.afterEach(async () => {
    await cleanupTestOrders()
    await cleanupTestFavorites()
    await restoreNkda()
  })

  test('GLP-1 with every Rx detail, two pharmacies, Sign all with NKDA inline, the PDF quantity, and Frequently used to a patient favorite', async ({ page }) => {
    // One walk; each step depends on the one before it.
    test.setTimeout(240_000)
    // The clinic admin writes both lines and saves them for the test provider.
    await loginAs(page, TEST_USERS.clinicAdmin)
    await startSession(page)

    await test.step('GLP-1 injectable: 80 units weekly for 90 days, the builder suggests 2 x 5 mL vials', async () => {
      await page.getByLabel('Search medications').fill(TEST_CATALOG.glp1IngredientName)
      await page.getByRole('button', { name: new RegExp(TEST_CATALOG.glp1IngredientName, 'i') }).click()
      await page.getByRole('button', { name: new RegExp(TEST_CATALOG.glp1FormulationName, 'i') }).click()
      await page.getByLabel('Dose amount').fill('80')
      await page.getByLabel('Dose unit').selectOption('units')
      await page.getByLabel('Frequency').selectOption('QW')
      await page.getByLabel('Timing').selectOption('MORNING')
      await page.getByLabel('Duration').selectOption('90')

      const tier2 = page.getByRole('button', { name: /Test Pharmacy Tier2/ })
      await expect(tier2.getByTestId('pharmacy-suggested-package')).toHaveText('2 × 5 mL vials')
      await tier2.click()
      await page.getByRole('button', { name: /Continue.*Set Retail Price/i }).click()
      await expect(page).toHaveURL(/\/new-prescription\/margin/, { timeout: 10_000 })

      // Days supply and the vials, on the price page.
      await expect(page.getByTestId('days-supply-value')).toHaveText('90 days')
      await expect(page.getByTestId('dispense-value')).toHaveText('9.6 mL')
      await expect(page.getByTestId('package-summary')).toHaveText('Package: 2 × 5 mL vials (suggested for 90 days) · $570.00')
      await expect(page.getByLabel('Number of packages')).toHaveValue('2')

      await page.locator('#retail-price').fill('700.00')
      await page.getByRole('button', { name: 'Add & Search Another' }).click()
      await expect(page).toHaveURL(/\/new-prescription\/search/, { timeout: 10_000 })
    })

    await test.step('a second line at another pharmacy: the price page warns about the second shipping charge', async () => {
      await page.getByLabel('Search medications').fill(TEST_CATALOG.ingredientName)
      await page.getByRole('button', { name: new RegExp(TEST_CATALOG.ingredientName, 'i') }).click()
      await page.getByRole('button', { name: new RegExp(TEST_CATALOG.formulationName, 'i') }).click()
      await page.getByLabel('Dose amount').fill('10')
      await page.getByLabel('Dose unit').selectOption('mg')
      await page.getByLabel('Frequency').selectOption('QD')
      await page.getByLabel('Timing').selectOption({ index: 1 })
      await page.getByLabel('Duration').selectOption({ index: 1 })
      await page.getByRole('button', { name: /Test Pharmacy Tier4/ }).click()
      await page.getByRole('button', { name: /Continue.*Set Retail Price/i }).click()
      await expect(page).toHaveURL(/\/new-prescription\/margin/, { timeout: 10_000 })

      const notice = page.getByTestId('multi-pharmacy-notice')
      await expect(notice).toBeVisible({ timeout: 15_000 })
      await expect(notice.getByTestId('multi-pharmacy-message')).toContainText('2 pharmacies → 2 shipping charges')

      await page.locator('#retail-price').fill('200.00')
      await page.getByRole('button', { name: 'Review & Send (2)' }).click()
      await expect(page).toHaveURL(/\/new-prescription\/review/, { timeout: 10_000 })
    })

    await test.step('Review: refills, clinical difference, syringes, cold chain, diagnosis, special instructions; the dispense with its vials', async () => {
      // The GLP-1 row opens by itself: its clinical difference is required.
      const row = page.locator('[data-testid^="rx-details-"]').filter({ hasText: '90-day supply' })
      await expect(row).toHaveCount(1, { timeout: 15_000 })
      await expect(row).toHaveAttribute('data-expanded', 'true')

      // Quantity and unit: 9.6 mL as 2 x 5 mL vials.
      await expect(row.locator('[data-testid^="rx-dispense-"]')).toHaveText('9.6 mL (2 × 5 mL vials)')

      const reason = row.getByLabel(/Clinical difference \(required\)/)
      await expect(reason).toHaveValue('')
      await reason.selectOption(CLINICAL_DIFFERENCE)
      await row.getByLabel('Refills').selectOption('2')
      await row.getByLabel('Syringe option').selectOption('insulin_syringe')
      await expect(row.getByLabel('Shipping')).toHaveValue('cold_chain')
      await row.getByLabel('Diagnosis code').fill('E66.9')
      await row.getByLabel('Diagnosis', { exact: true }).fill('Obesity, unspecified')
      await row.getByLabel('Special instructions (optional)').fill(SPECIAL_INSTRUCTIONS)
      await expect(row).toContainText('90-day supply · dispense 9.6 mL (2 × 5 mL vials) · 2 refills')
      await expect(row).toContainText('clinical difference set')

      // The allergy notice is advisory here; signing is where it is required.
      await expect(page.getByTestId('allergy-notice')).toBeVisible()
      await page.getByRole('button', { name: /Save as Draft: Provider Signs Later/ }).click()
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 })

      await expect.poll(async () => (await patientOrders()).map(o => o.status), { timeout: 15_000 }).toEqual(['DRAFT', 'DRAFT'])
    })

    let glp1OrderId = ''
    await test.step('Sign all signs every draft for the patient, after NKDA is marked inline', async () => {
      const drafts = await patientOrders()
      const ids = drafts.map(o => o.order_id)
      glp1OrderId = drafts.find(o => o.formulation_id === TEST_IDS.glp1Formulation)!.order_id

      // The provider signs everything saved for them.
      await loginAs(page, TEST_USERS.provider)
      await page.goto('/dashboard?tab=drafts')
      const signAll = page.getByTestId('sign-all-drafts')
      await expect(signAll).toHaveText('Sign all (2)', { timeout: 15_000 })
      await signAll.click()
      await expect(page).toHaveURL(/\/new-prescription\/sign\?orders=/, { timeout: 15_000 })
      for (const id of ids) await expect(page.getByTestId(`select-${id}`)).toBeChecked({ timeout: 15_000 })

      await drawSignature(page)
      await expect(page.getByText('Signature captured')).toBeVisible()
      const send = page.getByRole('button', { name: 'Sign & Send 2 Prescriptions' })
      await expect(send).toBeEnabled({ timeout: 15_000 })
      await send.click()

      const prompt = page.getByTestId('allergies-required-prompt')
      await expect(prompt).toContainText('Record allergies or mark NKDA before signing', { timeout: 15_000 })
      await expect(page).toHaveURL(/\/new-prescription\/sign\?orders=/)
      await prompt.getByLabel('No known drug allergies (NKDA)').check()
      await prompt.getByRole('button', { name: 'Save allergies' }).click()
      await expect(page).toHaveURL(/\/dashboard\?sent=2/, { timeout: 30_000 })

      const { data: patient } = await svc().from('patients').select('allergies, nkda').eq('patient_id', TEST_IDS.patient).single()
      expect(patient).toEqual({ allergies: [], nkda: true })

      const signed = await patientOrders()
      expect(signed.map(o => o.status)).toEqual(['AWAITING_PAYMENT', 'AWAITING_PAYMENT'])
      expect(signed.find(o => o.order_id === glp1OrderId)).toEqual(expect.objectContaining({
        pharmacy_id:          TEST_IDS.pharmacyTier2,
        package_label:        '5 mL vial',
        package_count:        2,
        quantity:             2,
        days_supply:          90,
        dispense_quantity:    9.6,
        refills:              2,
        syringe_option:       'insulin_syringe',
        shipping_type:        'cold_chain',
        clinical_difference:  CLINICAL_DIFFERENCE,
        diagnosis_code:       'E66.9',
        diagnosis_text:       'Obesity, unspecified',
        special_instructions: SPECIAL_INSTRUCTIONS,
      }))
    })

    await test.step('the Rx PDF of the signed order says "Quantity: 2 vials"', async () => {
      const order = (await patientOrders()).find(o => o.order_id === glp1OrderId)!
      const q = dispenseQuantity(order as Parameters<typeof dispenseQuantity>[0])
      expect(q).toEqual({ quantity: 2, unit: 'vial' })
      const med = order.medication_snapshot as Record<string, unknown> | null
      const data: PrescriptionPdfData = {
        providerFirstName: 'Test', providerLastName: 'Provider', providerNpi: order.provider_npi_snapshot ?? '1234567890',
        providerDea: null, providerLicenseState: 'TX',
        patientFirstName: 'Test', patientLastName: 'Patient', patientDateOfBirth: '1980-01-01',
        patientAddressLine1: '1 Test St', patientAddressLine2: null, patientCity: 'Austin', patientState: 'TX', patientZip: '78701',
        patientAllergies: [], patientNkda: true,
        medicationName: String(med?.['medication_name'] ?? ''), medicationForm: String(med?.['form'] ?? ''), medicationDose: String(med?.['dose'] ?? ''),
        quantity: q.quantity, quantityUnit: q.unit,
        sigText: order.sig_text ?? null,
        daysSupply: order.days_supply, dispenseQuantity: order.dispense_quantity, dispenseUnit: order.dispense_unit,
        refills: order.refills, syringeOption: order.syringe_option, shippingType: order.shipping_type,
        clinicalDifference: order.clinical_difference, diagnosisCode: order.diagnosis_code, diagnosisText: order.diagnosis_text,
        specialInstructions: order.special_instructions,
        packageLabel: order.package_label, packageCount: order.package_count,
        orderNumber: order.order_number ?? null, orderDate: order.locked_at ?? order.created_at,
        clinicName: 'Test Clinic', pharmacyName: 'Test Pharmacy Tier2',
      } as PrescriptionPdfData
      const text = new TextDecoder().decode(buildPrescriptionPdfBytes(data))
      expect(text).toContain('Quantity: 2 vials')
      expect(text).toContain('2 x 5 mL vials')
    })

    await test.step('Frequently used shows the dose just ordered; Make favorite for this patient; the favorite opens the dose step filled', async () => {
      await startSession(page)
      await page.getByRole('button', { name: /^Favorites \(\d+\)$/ }).click()

      const item = page.getByTestId('favorites-frequent').getByTestId('frequent-item').filter({ hasText: TEST_CATALOG.glp1FormulationName })
      await expect(item).toHaveCount(1, { timeout: 15_000 })
      await expect(item).toContainText('80 units')
      await expect(item).toContainText('weekly')
      await expect(item).toContainText('Test Pharmacy Tier2')

      await item.getByRole('button', { name: `Make ${TEST_CATALOG.glp1FormulationName} a favorite` }).click()
      const dialog = page.getByRole('dialog', { name: `Make ${TEST_CATALOG.glp1FormulationName} a favorite` })
      await dialog.getByRole('radio', { name: /^Only for / }).check()
      await dialog.getByRole('button', { name: 'Save favorite' }).click()
      await expect(dialog).toHaveCount(0, { timeout: 10_000 })

      await expect.poll(async () => {
        const { data } = await svc().from('provider_favorites')
          .select('patient_id, pharmacy_id')
          .eq('provider_id', TEST_IDS.provider)
          .eq('formulation_id', TEST_IDS.glp1Formulation)
        return data ?? []
      }, { timeout: 10_000 }).toEqual([{ patient_id: TEST_IDS.patient, pharmacy_id: TEST_IDS.pharmacyTier2 }])

      // The patient's own favorites come first, in their own group.
      const patientGroup = page.getByTestId('favorites-panel').locator('[data-testid^="favorite-group-For "]')
      await expect(patientGroup).toHaveCount(1, { timeout: 10_000 })
      const preset = patientGroup.getByTestId('favorite-preset').filter({ hasText: /^80 units/ })
      await expect(preset).toHaveCount(1)
      await preset.click()

      // The dose step, with the dropdowns filled from the favorite.
      await expect(page.getByLabel('Dose amount')).toHaveValue('80', { timeout: 10_000 })
      await expect(page).toHaveURL(/\/new-prescription\/search/)
      await expect(page.getByLabel('Dose unit')).toHaveValue('units')
      await expect(page.getByLabel('Frequency')).toHaveValue('QW')
    })
  })
})
