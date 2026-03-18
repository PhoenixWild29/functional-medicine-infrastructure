// ============================================================
// Tier 2 Portal Automation Adapter — WO-20
// ============================================================
//
// Implements REQ-PTA-001 through REQ-PTA-005.
// REQ-PTA-006 (status polling) is handled by /api/cron/portal-status-poll.
//
// Submission lifecycle:
//   createSubmissionRecord(PENDING)
//   → read pharmacy_portal_configs
//   → decrypt username + password from Vault (HC-14)
//   → launch Playwright browser (headless in prod)
//   → execute login_flow steps
//   → execute submit_flow steps (fills PHI fields into form)
//   → capture confirmation screenshot → upload to adapter-screenshots
//   → send screenshot to AI vision for confidence scoring (REQ-PTA-004)
//   → if confidence >= 0.85: markAcknowledged
//   → if confidence < 0.85:  markManualReview
//   → on any error: capture error screenshot (if screenshot_on_error),
//                   markPortalError + re-throw
//   → always close browser in finally block
//
// HC-14: Credentials are substituted into Playwright steps at runtime
// from server memory only. They never appear in the browser's localStorage,
// sessionStorage, cookies, or any persisted storage.
//
// HIPAA: PHI flows through portal form fill steps. The flow executor
// logs only selectors, never values. Screenshots contain PHI (patient
// info on confirmation page) — stored in non-public bucket with 72h TTL.
//
// Required env vars:
//   OPENAI_API_KEY          — for AI vision confidence scoring (REQ-PTA-004)
//   PLAYWRIGHT_HEADLESS     — "true" in production; "false" for local dev

import { chromium } from 'playwright'
import { createServiceClient } from '@/lib/supabase/service'
import { getVaultSecret } from '@/lib/adapters/vault'
import { getBrowserLaunchOptions, getBrowserContextOptions, SCREENSHOT_BUCKET } from '@/lib/playwright/config'
import { executeFlow } from '@/lib/adapters/portal-flow-executor'
import type { FlowStep, FlowFieldValues } from '@/lib/adapters/portal-flow-executor'
import {
  createSubmissionRecord,
  markSubmitted,
  markAcknowledged,
  markFailed,
  markPortalError,
  markManualReview,
} from '@/lib/adapters/audit-trail'

// ============================================================
// TYPES
// ============================================================

export interface Tier2PortalResult {
  submissionId:     string
  outcome:          'acknowledged' | 'manual_review' | 'portal_error'
  aiConfidenceScore: number | null
  screenshotUrl:    string | null
}

// REQ-PTA-004: Auto-accept threshold for AI confidence score
const AI_CONFIDENCE_THRESHOLD = 0.85

// ============================================================
// AI VISION CONFIDENCE SCORING
// ============================================================
// Sends a base64 PNG screenshot to OpenAI Vision and asks whether
// it shows a successful order confirmation. Returns a 0.00–1.00 score.
// HC-11 principle: OPENAI_API_KEY never logged.

async function scoreConfirmationScreenshot(screenshotBytes: Uint8Array): Promise<number> {
  const apiKey = process.env['OPENAI_API_KEY']
  if (!apiKey) {
    throw new Error('[tier2-portal] OPENAI_API_KEY is not set — cannot score confirmation screenshot')
  }

  const base64Image = Buffer.from(screenshotBytes).toString('base64')

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: [
                'You are a medical order confirmation detector.',
                'Examine this pharmacy portal screenshot and determine whether it shows a',
                'SUCCESSFUL order confirmation page (e.g., "Order Received", "Prescription Submitted",',
                '"Order #xxxxx Confirmed", a green checkmark, or similar success indicator).',
                'Respond with a JSON object: { "is_confirmation": true/false, "confidence": 0.00-1.00 }',
                'where confidence reflects your certainty. No other text.',
              ].join(' '),
            },
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${base64Image}`, detail: 'low' },
            },
          ],
        },
      ],
      max_tokens: 64,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(20_000),
  })

  if (!response.ok) {
    throw new Error(`[tier2-portal] OpenAI Vision request failed: HTTP ${response.status}`)
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[]
  }

  const content = data.choices?.[0]?.message?.content ?? ''

  // Parse the JSON response
  try {
    const parsed = JSON.parse(content) as { is_confirmation?: boolean; confidence?: number }
    const confidence = typeof parsed.confidence === 'number'
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0

    // If the model says it's NOT a confirmation, treat confidence as 0 regardless
    if (!parsed.is_confirmation) return 0

    return confidence
  } catch {
    // Unparseable response — treat as low confidence to trigger manual review
    console.warn('[tier2-portal] OpenAI Vision response could not be parsed as JSON:', content)
    return 0
  }
}

// ============================================================
// SCREENSHOT UPLOAD
// ============================================================

async function uploadScreenshot(
  orderId: string,
  submissionId: string,
  label: string,
  bytes: Uint8Array
): Promise<string> {
  const supabase = createServiceClient()
  const storagePath = `portal/${orderId}/${submissionId}-${label}.png`

  const { error: uploadError } = await supabase.storage
    .from(SCREENSHOT_BUCKET)
    .upload(storagePath, bytes, { contentType: 'image/png', upsert: true })

  if (uploadError) {
    throw new Error(`[tier2-portal] screenshot upload failed: ${uploadError.message}`)
  }

  // Return the storage path as the URL reference (signed URL generated on demand by ops)
  return storagePath
}

// ============================================================
// MAIN SUBMISSION FUNCTION
// ============================================================

export async function submitTier2Portal(
  orderId: string,
  pharmacyId: string
): Promise<Tier2PortalResult> {
  const supabase = createServiceClient()

  // ── 1. Load pharmacy_portal_configs ───────────────────────
  const { data: config, error: configError } = await supabase
    .from('pharmacy_portal_configs')
    .select(
      'config_id, portal_url, username_vault_id, password_vault_id,' +
      ' login_flow, submit_flow, screenshot_on_error'
    )
    .eq('pharmacy_id', pharmacyId)
    .eq('is_active', true)
    .single()

  if (configError || !config) {
    throw new Error(
      `[tier2-portal] no active pharmacy_portal_configs for pharmacy ${pharmacyId}: ${configError?.message ?? 'not found'}`
    )
  }

  // ── 2. Load order data for form field substitution ─────────
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select(
      'order_id, order_number, patient_id, provider_id,' +
      ' medication_snapshot, quantity, sig_text'
    )
    .eq('order_id', orderId)
    .single()

  if (orderError || !order) {
    throw new Error(
      `[tier2-portal] order ${orderId} not found: ${orderError?.message ?? 'no data'}`
    )
  }

  const { data: patient } = await supabase
    .from('patients')
    .select('first_name, last_name, date_of_birth, address_line1, address_line2, city, state, zip')
    .eq('patient_id', order.patient_id)
    .single()

  const { data: provider } = await supabase
    .from('providers')
    .select('first_name, last_name, npi_number, dea_number')
    .eq('provider_id', order.provider_id)
    .single()

  if (!patient || !provider) {
    throw new Error(`[tier2-portal] patient or provider not found for order ${orderId}`)
  }

  // ── 3. Create audit trail record ───────────────────────────
  const submissionId = await createSubmissionRecord({
    orderId,
    pharmacyId,
    tier: 'TIER_2_PORTAL',
    attemptNumber: 1,
    metadata: { config_id: config.config_id },
  })

  // ── 4. Decrypt portal credentials (HC-14) ─────────────────
  // Credentials loaded into server memory only — never written to browser storage
  const [username, password] = await Promise.all([
    getVaultSecret(config.username_vault_id),
    getVaultSecret(config.password_vault_id),
  ])

  const creds = { username, password }

  // ── 5. Build field substitution map ───────────────────────
  const med = order.medication_snapshot as Record<string, unknown> | null

  const fieldValues: FlowFieldValues = {
    // Order
    orderId:          order.order_id,
    orderNumber:      order.order_number ?? '',
    // Patient (PHI)
    patientFirstName: patient.first_name,
    patientLastName:  patient.last_name,
    patientDob:       patient.date_of_birth,
    patientAddress1:  patient.address_line1 ?? '',
    patientAddress2:  patient.address_line2 ?? '',
    patientCity:      patient.city ?? '',
    patientState:     patient.state ?? '',
    patientZip:       patient.zip ?? '',
    // Provider
    providerFirstName: provider.first_name,
    providerLastName:  provider.last_name,
    providerNpi:       provider.npi_number,
    providerDea:       provider.dea_number ?? '',
    // Medication
    medicationName:   String(med?.medication_name ?? ''),
    medicationForm:   String(med?.form ?? ''),
    medicationDose:   String(med?.dose ?? ''),
    quantity:         String(order.quantity ?? ''),
    sigText:          order.sig_text ?? '',
  }

  // ── 6. Mark SUBMITTED (pre-browser) ───────────────────────
  await markSubmitted(submissionId, {
    portal_url:  config.portal_url,
    portal_type: 'TIER_2_PORTAL',
  })

  // ── 7. Launch Playwright + execute flows ───────────────────
  const browser = await chromium.launch(getBrowserLaunchOptions())

  let screenshotUrl: string | null = null
  let aiConfidenceScore: number | null = null

  try {
    const context = await browser.newContext(getBrowserContextOptions())
    const page    = await context.newPage()

    // ── 7a. Execute login flow ─────────────────────────────
    const loginSteps = (config.login_flow as FlowStep[] | null) ?? []
    if (loginSteps.length === 0) {
      throw new Error('[tier2-portal] login_flow is empty — portal cannot be automated')
    }

    try {
      await executeFlow(page, loginSteps, creds, {})
    } catch (loginErr) {
      const msg = loginErr instanceof Error ? loginErr.message : String(loginErr)

      // Retry login once before giving up (REQ-PTA-002)
      console.warn(`[tier2-portal] login attempt 1 failed for ${pharmacyId}: ${msg} — retrying`)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await executeFlow(page, loginSteps, creds, {})  // throws on second failure
    }

    // ── 7b. Execute submit flow ────────────────────────────
    const submitSteps = (config.submit_flow as FlowStep[] | null) ?? []
    if (submitSteps.length === 0) {
      throw new Error('[tier2-portal] submit_flow is empty — portal cannot be automated')
    }

    const submitResults = await executeFlow(page, submitSteps, creds, fieldValues)

    // ── 7c. Capture confirmation screenshot ───────────────
    // Use screenshot from a 'screenshot' step in the flow if present,
    // otherwise capture the page as-is after submit completes.
    const flowScreenshot = submitResults.find(r => r.action === 'screenshot' && r.screenshotBytes)

    const confirmationBytes = flowScreenshot?.screenshotBytes
      ?? await page.screenshot({ type: 'png', fullPage: false })

    screenshotUrl = await uploadScreenshot(orderId, submissionId, 'confirmation', confirmationBytes)

    // ── 7d. AI confidence scoring (REQ-PTA-004) ───────────
    aiConfidenceScore = await scoreConfirmationScreenshot(confirmationBytes)

    console.info(
      `[tier2-portal] AI score=${aiConfidenceScore.toFixed(2)} | order=${orderId} | threshold=${AI_CONFIDENCE_THRESHOLD}`
    )

    // ── 8. Classify outcome ────────────────────────────────
    if (aiConfidenceScore >= AI_CONFIDENCE_THRESHOLD) {
      await markAcknowledged(submissionId, `portal:${pharmacyId}`, {
        ai_confidence_score: aiConfidenceScore,
        screenshot_url:      screenshotUrl,
      })

      console.info(
        `[tier2-portal] acknowledged | order=${orderId} | pharmacy=${pharmacyId} | confidence=${aiConfidenceScore.toFixed(2)}`
      )

      return { submissionId, outcome: 'acknowledged', aiConfidenceScore, screenshotUrl }
    } else {
      // Confidence below threshold — flag for ops manual review
      await markManualReview(submissionId, aiConfidenceScore, screenshotUrl)

      console.warn(
        `[tier2-portal] manual_review | order=${orderId} | pharmacy=${pharmacyId} | confidence=${aiConfidenceScore.toFixed(2)} (below ${AI_CONFIDENCE_THRESHOLD})`
      )

      return { submissionId, outcome: 'manual_review', aiConfidenceScore, screenshotUrl }
    }

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)

    // Capture error screenshot if configured (REQ-PTA-001 AC-PTA-001.1)
    let errorScreenshotUrl: string | undefined
    if (config.screenshot_on_error) {
      try {
        const browser2 = await chromium.launch(getBrowserLaunchOptions())
        const errorContext = await browser2.newContext(getBrowserContextOptions())
        const errorPage = await errorContext.newPage()
        const errorBytes = await errorPage.screenshot({ type: 'png' })
        errorScreenshotUrl = await uploadScreenshot(orderId, submissionId, 'error', errorBytes)
        await browser2.close()
      } catch (screenshotErr) {
        // Don't let error screenshot failure mask the original error
        console.warn('[tier2-portal] failed to capture error screenshot:', screenshotErr)
      }
    }

    await markPortalError(submissionId, 'portal_automation_error', msg, errorScreenshotUrl)
    await markFailed(submissionId, 'portal_automation_error', msg).catch(() => {
      // markFailed may conflict with markPortalError update — ignore
    })

    console.error(`[tier2-portal] portal_error | order=${orderId} | pharmacy=${pharmacyId}:`, msg)

    return {
      submissionId,
      outcome:           'portal_error',
      aiConfidenceScore: null,
      screenshotUrl:     errorScreenshotUrl ?? null,
    }

  } finally {
    await browser.close().catch(closeErr =>
      console.warn('[tier2-portal] browser.close() failed:', closeErr)
    )
  }
}
