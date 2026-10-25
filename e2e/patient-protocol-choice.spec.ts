import { test, expect, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { seedStaticData, cleanupTestOrders, TEST_CATALOG, TEST_USERS } from './fixtures/seed'
import { TEST_PATIENT_DOB, closeTestProposals, latestChoice, latestTestProposal, proposalEvents, proposalLines, proposalRow } from './fixtures/proposals'

// ============================================================
// Patient protocol choice, PR 5: end to end
// ============================================================
//
// docs/design/patient-protocol-choice.md, section 6 row 5:
//   1. The provider builds three lines, groups them into two options for
//      the patient ("Foundation plan": the GLP-1 (required) and the plain
//      compound at Tier2, made optional; "Weight focus": the plain
//      compound at Tier1), and sends the plan for choice.
//   2. The plan link is taken from the UI with "Copy link" (clipboard
//      permission) and the QR code is shown. Both are recorded as delivery
//      events (the link never depends on texting; E2E has no Twilio).
//   3. The patient, on a phone viewport with no session, opens
//      /plan/<token>: one wrong date of birth (dob_failed), then the right
//      one; sees both options; unticks the optional item; chooses
//      "Foundation plan" and confirms.
//   4. The provider sees "Test chose Foundation plan (1 of 2 items)" under
//      "Plans ready to sign", opens Review and sign (the chosen line only,
//      fixed) and signs it.
//   5. The unchosen lines are CANCELLED and never signed; the proposal is
//      signed; the payment page loads (no card is entered: Stripe test mode
//      in E2E); and the plan link now says "Your provider has approved
//      your plan" (texting is off in E2E, so the payment link reaches the
//      patient from the clinic, not by text).
//
// No sleeps: every wait is a web-first assertion or expect.poll on the
// database. Setup and cleanup are service-role (fixtures/proposals.ts);
// a proposal is never deleted, so cleanup closes it and soft-deletes its
// orders. No accounts are created: the provider is the seeded E2E provider
// and the patient needs no login.

async function pickProviderIfListed(page: Page) {
  const providerButton = page.getByRole('button', { name: /Provider,\s*Test/i })
  if (await providerButton.count() > 0) await providerButton.click()
}

async function loginAsProvider(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(TEST_USERS.provider.email)
  await page.getByLabel('Password').fill(TEST_USERS.provider.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 })
}

async function startSession(page: Page) {
  await page.goto('/new-prescription')
  await page.getByLabel('Search patients').fill('Test')
  await page.getByRole('button', { name: /Patient,\s*Test/i }).click()
  await pickProviderIfListed(page)
  await page.getByRole('button', { name: 'Continue to Pharmacy Search' }).click()
  await expect(page).toHaveURL(/\/new-prescription\/search/, { timeout: 10_000 })
}

async function buildGlp1(page: Page, pharmacy: RegExp) {
  await page.getByLabel('Search medications').fill(TEST_CATALOG.glp1IngredientName)
  await page.getByRole('button', { name: new RegExp(TEST_CATALOG.glp1IngredientName, 'i') }).click()
  await page.getByRole('button', { name: new RegExp(TEST_CATALOG.glp1FormulationName, 'i') }).click()
  await page.getByLabel('Dose amount').fill('10')
  await page.getByLabel('Dose unit').selectOption('units')
  await page.getByLabel('Frequency').selectOption('QW')
  await page.getByLabel('Timing').selectOption('MORNING')
  await page.getByLabel('Duration').selectOption('30')
  await page.getByRole('button', { name: pharmacy }).click()
  await page.getByRole('button', { name: /Continue.*Set Retail Price/i }).click()
  await expect(page).toHaveURL(/\/new-prescription\/margin/, { timeout: 10_000 })
}

async function buildPlain(page: Page, pharmacy: RegExp) {
  await page.getByLabel('Search medications').fill(TEST_CATALOG.ingredientName)
  await page.getByRole('button', { name: new RegExp(TEST_CATALOG.ingredientName, 'i') }).click()
  await page.getByRole('button', { name: new RegExp(TEST_CATALOG.formulationName, 'i') }).click()
  await page.getByLabel('Dose amount').fill('10')
  await page.getByLabel('Dose unit').selectOption('mg')
  await page.getByLabel('Frequency').selectOption('QD')
  await page.getByLabel('Timing').selectOption({ index: 1 })
  await page.getByLabel('Duration').selectOption({ index: 1 })
  await page.getByRole('button', { name: pharmacy }).click()
  await page.getByRole('button', { name: /Continue.*Set Retail Price/i }).click()
  await expect(page).toHaveURL(/\/new-prescription\/margin/, { timeout: 10_000 })
}

async function addAndSearchAnother(page: Page, retail: string) {
  await page.locator('#retail-price').fill(retail)
  await page.getByRole('button', { name: 'Add & Search Another' }).click()
  await expect(page).toHaveURL(/\/new-prescription\/search/, { timeout: 10_000 })
}

/** C8: the GLP-1 line's clinical-difference reason on Review (never pre-selected). */
/** Three horizontal strokes across the signature pad (a single dot is refused). */
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

async function orderRows(ids: string[]) {
  const db = createClient(process.env['E2E_SUPABASE_URL']!, process.env['E2E_SUPABASE_SERVICE_ROLE_KEY']!)
  const { data, error } = await db.from('orders').select('order_id, status, provider_signature_hash_snapshot').in('order_id', ids)
  if (error) throw new Error(error.message)
  return new Map((data ?? []).map(r => [r.order_id as string, r]))
}

async function chooseClinicalDifference(page: Page) {
  const reason = page.getByLabel(/Clinical difference \(required\)/)
  await expect(reason).toHaveValue('', { timeout: 15_000 })
  await reason.selectOption(TEST_CATALOG.glp1ClinicalDifferenceOptions[0]!)
}

test.describe('Patient protocol choice: the provider proposes, the patient chooses on a phone', () => {
  test.beforeAll(async () => {
    await seedStaticData()
    await closeTestProposals()
  })

  test.afterAll(async () => {
    await closeTestProposals()
    await cleanupTestOrders()
  })

  test('two options, one optional item, copy link and QR; the patient fails the DOB once, unticks the optional item and chooses; the provider signs the choice', async ({ browser }) => {
    test.setTimeout(240_000)

    // ── 1. The provider builds three lines and groups them into two options ──
    const providerContext = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
    const page = await providerContext.newPage()
    await loginAsProvider(page)
    await startSession(page)
    await buildGlp1(page, /Test Pharmacy Tier4/)
    await addAndSearchAnother(page, '190.00')
    await buildPlain(page, /Test Pharmacy Tier2/)
    await addAndSearchAnother(page, '200.00')
    await buildPlain(page, /Test Pharmacy Tier1/)
    await page.locator('#retail-price').fill('180.00')
    await page.getByRole('button', { name: 'Review & Send (3)' }).click()
    await expect(page).toHaveURL(/\/new-prescription\/review/, { timeout: 10_000 })
    await chooseClinicalDifference(page)

    await page.getByLabel('Send the patient a plan to choose from, instead of signing now').check()
    const optionA = page.getByRole('group', { name: 'Option A' })
    await optionA.getByLabel('Option A name for the patient').fill('Foundation plan')
    await page.getByRole('button', { name: 'Add an option' }).click()
    await page.getByLabel('Option B name for the patient').fill('Weight focus')
    // The third line (plain compound at Tier1) moves to Option B.
    await optionA.getByLabel(`Option for ${TEST_CATALOG.formulationName}`).nth(1).selectOption({ label: 'Option B: Weight focus' })
    const optionB = page.getByRole('group', { name: 'Option B' })
    // exact: the line's name, not the select's hidden label "Option for <name>".
    await expect(optionB.getByText(TEST_CATALOG.formulationName, { exact: true })).toBeVisible()
    // The plain compound left in Option A becomes optional ("nice to have").
    await optionA.getByLabel(`Required: ${TEST_CATALOG.formulationName}`).uncheck()
    await expect(optionA.getByLabel(`Required: ${TEST_CATALOG.glp1FormulationName}`)).toBeChecked()

    await page.getByRole('button', { name: 'Send to patient for choice' }).click()
    const share = page.getByRole('region', { name: 'Share the plan link' })
    await expect(share).toBeVisible({ timeout: 20_000 })

    // The plan as stored: two options, the optional line not required.
    const proposal = await latestTestProposal()
    expect(proposal.status).toBe('sent')
    const options = await proposalLines(proposal.proposal_id)
    expect(options.map(o => o.label)).toEqual(['Foundation plan', 'Weight focus'])
    expect(options[0]!.lines).toHaveLength(2)
    expect(options[1]!.lines).toHaveLength(1)
    const glp1Line = options[0]!.lines.find(l => l.name === TEST_CATALOG.glp1FormulationName)!
    const optionalLine = options[0]!.lines.find(l => l.name === TEST_CATALOG.formulationName)!
    expect(glp1Line.required).toBe(true)
    expect(optionalLine.required).toBe(false)
    expect(options.flatMap(o => o.lines).every(l => l.status === 'DRAFT')).toBe(true)

    // ── 2. Copy link (from the clipboard) and the QR code ──
    await share.getByRole('button', { name: 'Copy link' }).click()
    await expect(share.getByRole('status')).toHaveText('Link copied.')
    const copied = await page.evaluate(() => navigator.clipboard.readText())
    await expect(share.getByLabel('Plan link')).toHaveValue(copied)
    const planPath = new URL(copied).pathname
    expect(planPath).toMatch(/^\/plan\/[A-Za-z0-9_-]{43}$/)
    await share.getByRole('button', { name: 'Show QR code' }).click()
    await expect(share.getByRole('img', { name: 'QR code for the plan link' })).toBeVisible()
    await expect.poll(() => proposalEvents(proposal.proposal_id)).toEqual(expect.arrayContaining(['link_copied', 'qr_shown']))

    // ── 3. The patient, on a phone, with no session ──
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    const patient = await phone.newPage()
    await patient.goto(planPath)
    await expect(patient.getByRole('heading', { level: 1, name: 'Your provider has a plan ready' })).toBeVisible({ timeout: 15_000 })
    await expect(patient.locator('body')).not.toContainText(TEST_CATALOG.glp1FormulationName)
    await expect(patient.locator('body')).not.toContainText('Foundation plan')

    // One wrong date of birth: counted, and the tries left are shown.
    await patient.getByLabel('Date of birth').fill('1979-12-31')
    await patient.getByRole('button', { name: 'Continue' }).click()
    // Scoped to the page's main: Next's route announcer is also role=alert.
    await expect(patient.getByRole('main').getByRole('alert')).toHaveText("That date of birth doesn't match. 4 tries left.")
    await expect.poll(async () => (await proposalRow(proposal.proposal_id)).dob_failures).toBe(1)
    await expect.poll(() => proposalEvents(proposal.proposal_id)).toContain('dob_failed')

    // The right one: both options.
    await patient.getByLabel('Date of birth').fill(TEST_PATIENT_DOB)
    await patient.getByRole('button', { name: 'Continue' }).click()
    await expect(patient.getByRole('heading', { level: 1, name: 'Choose your plan' })).toBeVisible({ timeout: 15_000 })
    const foundation = patient.getByRole('region', { name: 'Foundation plan' })
    await expect(foundation).toBeVisible()
    await expect(patient.getByRole('region', { name: 'Weight focus' })).toBeVisible()
    await expect.poll(() => proposalEvents(proposal.proposal_id)).toContain('viewed')

    // The required item is locked on; the optional one is ticked and can be unticked.
    const required = foundation.getByRole('checkbox', { name: new RegExp(TEST_CATALOG.glp1FormulationName) })
    await expect(required).toBeChecked()
    await expect(required).toBeDisabled()
    await expect(foundation.getByText('Included: your provider marked this as essential', { exact: true })).toHaveCount(1)
    const optional = foundation.getByRole('checkbox', { name: new RegExp(TEST_CATALOG.formulationName) })
    await expect(optional).toBeChecked()
    const total = foundation.getByTestId(`plan-total-${options[0]!.optionId}`)
    await expect(total).toHaveText(/^\$\d+\.\d{2}$/)
    const before = await total.textContent()
    await optional.uncheck()
    await expect(total).not.toHaveText(before!)
    await expect(foundation.getByText('Estimate: final price confirmed when your provider approves.', { exact: true })).toBeVisible()

    // Choose, confirm.
    await foundation.getByRole('button', { name: 'Choose this plan' }).click()
    const confirm = patient.getByRole('region', { name: 'Confirm your choice' })
    await expect(confirm.getByText('Foundation plan', { exact: true })).toBeVisible()
    await expect(confirm.getByText(TEST_CATALOG.glp1FormulationName, { exact: true })).toBeVisible()
    await expect(confirm.getByText(TEST_CATALOG.formulationName)).toHaveCount(0)
    await confirm.getByRole('button', { name: 'Confirm' }).click()
    await expect(patient.getByRole('heading', { level: 1, name: 'Sent to your provider for final approval' })).toBeVisible({ timeout: 15_000 })

    // Stored: chosen, Foundation plan, the GLP-1 only.
    await expect.poll(async () => (await proposalRow(proposal.proposal_id)).status).toBe('chosen')
    expect((await proposalRow(proposal.proposal_id)).chosen_option_id).toBe(options[0]!.optionId)
    expect(await latestChoice(proposal.proposal_id)).toEqual([glp1Line.orderId])
    expect(await proposalEvents(proposal.proposal_id)).toEqual(expect.arrayContaining(['sent', 'link_copied', 'qr_shown', 'dob_failed', 'viewed', 'chosen']))

    // ── 4. The provider sees the choice and signs it ──
    await page.goto(`/dashboard?tab=proposed&order=${glp1Line.orderId}`)
    await expect(page.getByRole('region', { name: 'Patient choice' }).getByText('The patient has chosen. Signing comes next.', { exact: true })).toBeVisible({ timeout: 15_000 })
    await page.goto('/dashboard')
    const queue = page.getByRole('region', { name: 'Plans ready to sign' })
    await expect(queue.getByText('Test chose Foundation plan (1 of 2 items)', { exact: true })).toBeVisible({ timeout: 15_000 })
    await queue.getByRole('link', { name: 'Review and sign: Test chose Foundation plan (1 of 2 items)' }).click()
    await expect(page).toHaveURL(`/new-prescription/sign?proposal=${proposal.proposal_id}`, { timeout: 15_000 })
    await expect(page.getByTestId(`select-${glp1Line.orderId}`)).toBeChecked({ timeout: 15_000 })
    await expect(page.locator('[data-testid^="select-"]')).toHaveCount(1)
    const send = page.getByRole('button', { name: 'Sign & Send 1 Prescription' })
    await drawSignature(page)
    await expect(page.getByText('Signature captured')).toBeVisible()
    await expect(send).toBeEnabled()
    await send.click()
    await expect(page).toHaveURL(/\/dashboard\?sent=1/, { timeout: 30_000 })

    // ── 5. Signed: only the chosen line; the rest cancelled, never signed ──
    await expect.poll(async () => (await proposalRow(proposal.proposal_id)).status).toBe('signed')
    expect(await proposalEvents(proposal.proposal_id)).toContain('signed')
    const unchosen = [optionalLine.orderId, options[1]!.lines[0]!.orderId]
    const rows = await orderRows([glp1Line.orderId, ...unchosen])
    expect(rows.get(glp1Line.orderId)).toEqual(expect.objectContaining({ status: 'AWAITING_PAYMENT' }))
    expect(rows.get(glp1Line.orderId)!.provider_signature_hash_snapshot).toMatch(/^[0-9a-f]{64}$/)
    for (const id of unchosen) expect(rows.get(id)).toEqual(expect.objectContaining({ status: 'CANCELLED', provider_signature_hash_snapshot: null }))

    // The payment page loads (no card is entered).
    const link = await page.request.post(`/api/orders/${glp1Line.orderId}/checkout-link`)
    expect(link.status()).toBe(200)
    const { checkoutUrl } = await link.json() as { checkoutUrl: string }
    await patient.goto(new URL(checkoutUrl).pathname)
    await expect(patient.getByTestId('checkout-amount-due')).toBeVisible({ timeout: 20_000 })

    // The plan link now shows the approved state, and nothing about the plan.
    await patient.goto(planPath)
    await expect(patient.getByRole('heading', { level: 1, name: 'Your provider has approved your plan' })).toBeVisible({ timeout: 15_000 })
    await expect(patient.locator('body')).not.toContainText(TEST_CATALOG.glp1FormulationName)

    await phone.close()
    await providerContext.close()
  })
})
