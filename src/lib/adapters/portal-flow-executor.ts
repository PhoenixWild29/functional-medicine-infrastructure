// ============================================================
// Portal Flow Executor — WO-20
// ============================================================
//
// Executes an ordered list of Playwright automation steps defined
// as JSONB in pharmacy_portal_configs.login_flow, submit_flow,
// and status_check_flow.
//
// Step actions supported:
//   navigate  — page.goto(url)
//   fill      — page.fill(selector, value)  with {username}/{password} substitution
//   click     — page.click(selector)
//   wait      — page.waitForTimeout(ms)
//   waitFor   — page.waitForSelector(selector, { timeout })
//   select    — page.selectOption(selector, value)
//   check     — page.check(selector)
//   screenshot — capture and return screenshot bytes
//   getText   — returns innerText(selector); stored in step result
//
// HC-14: Credentials are substituted at execution time from server
// memory only — never stored in the browser session, cookie, or
// localStorage. The {username} and {password} placeholders are
// replaced in the `value` field of `fill` steps.
//
// HIPAA: PHI field values (patient name, DOB, etc.) flow through
// `fill` steps. They are never logged — only the selector is logged,
// not the value.

import type { Page } from 'playwright'

// ============================================================
// TYPES
// ============================================================

export type FlowStepAction =
  | 'navigate'
  | 'fill'
  | 'click'
  | 'wait'
  | 'waitFor'
  | 'select'
  | 'check'
  | 'screenshot'
  | 'getText'

export interface FlowStep {
  action:    FlowStepAction
  url?:      string       // navigate
  selector?: string       // fill, click, waitFor, select, check, getText
  value?:    string       // fill, select — supports {username}, {password}, {fieldName}
  ms?:       number       // wait
  timeout?:  number       // waitFor timeout override (default: PLAYWRIGHT_TIMEOUT_MS)
}

export interface FlowCredentials {
  username: string
  password: string
}

export interface FlowFieldValues {
  [key: string]: string   // e.g. { patientFirstName: 'Jane', patientLastName: 'Doe' }
}

export interface FlowStepResult {
  action:        FlowStepAction
  selector?:     string
  success:       boolean
  screenshotBytes?: Uint8Array  // only set for 'screenshot' steps
  textContent?:  string         // only set for 'getText' steps
  error?:        string
}

// Default per-step timeout (ms)
const DEFAULT_STEP_TIMEOUT_MS = 15_000

// ============================================================
// VALUE SUBSTITUTION
// ============================================================
// Replaces {username}, {password}, and any {fieldName} placeholders
// in step value strings with actual values from creds/fieldValues.
// HC-14: substituted value is never logged.

function substituteValue(
  template: string,
  creds: FlowCredentials,
  fieldValues: FlowFieldValues
): string {
  let result = template
  result = result.replace(/\{username\}/g, creds.username)
  result = result.replace(/\{password\}/g, creds.password)

  for (const [key, val] of Object.entries(fieldValues)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), val)
  }

  return result
}

// ============================================================
// EXECUTE FLOW
// ============================================================
//
// Runs all steps in order. On step failure, throws with the step
// index and action for the caller to build a PORTAL_ERROR record.
//
// Returns results for all steps (including screenshot bytes if any
// 'screenshot' step was included).

export async function executeFlow(
  page: Page,
  steps: FlowStep[],
  creds: FlowCredentials,
  fieldValues: FlowFieldValues = {}
): Promise<FlowStepResult[]> {
  const results: FlowStepResult[] = []

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!
    const timeout = step.timeout ?? DEFAULT_STEP_TIMEOUT_MS

    try {
      switch (step.action) {

        case 'navigate': {
          if (!step.url) throw new Error(`step ${i} (navigate): url is required`)
          await page.goto(step.url, { timeout, waitUntil: 'domcontentloaded' })
          results.push({ action: 'navigate', url: step.url, success: true })
          break
        }

        case 'fill': {
          if (!step.selector) throw new Error(`step ${i} (fill): selector is required`)
          if (!step.value)    throw new Error(`step ${i} (fill): value is required`)
          const filledValue = substituteValue(step.value, creds, fieldValues)
          await page.fill(step.selector, filledValue, { timeout })
          // HC-14 / HIPAA: log selector only, never the substituted value
          results.push({ action: 'fill', selector: step.selector, success: true })
          break
        }

        case 'click': {
          if (!step.selector) throw new Error(`step ${i} (click): selector is required`)
          await page.click(step.selector, { timeout })
          results.push({ action: 'click', selector: step.selector, success: true })
          break
        }

        case 'wait': {
          const ms = step.ms ?? 1_000
          await page.waitForTimeout(ms)
          results.push({ action: 'wait', success: true })
          break
        }

        case 'waitFor': {
          if (!step.selector) throw new Error(`step ${i} (waitFor): selector is required`)
          await page.waitForSelector(step.selector, { timeout })
          results.push({ action: 'waitFor', selector: step.selector, success: true })
          break
        }

        case 'select': {
          if (!step.selector) throw new Error(`step ${i} (select): selector is required`)
          if (!step.value)    throw new Error(`step ${i} (select): value is required`)
          const selectedValue = substituteValue(step.value, creds, fieldValues)
          // NB-07: use proper SelectOptionOptions import rather than a cast
          await page.selectOption(step.selector, selectedValue, { timeout })
          results.push({ action: 'select', selector: step.selector, success: true })
          break
        }

        case 'check': {
          if (!step.selector) throw new Error(`step ${i} (check): selector is required`)
          await page.check(step.selector, { timeout })
          results.push({ action: 'check', selector: step.selector, success: true })
          break
        }

        case 'screenshot': {
          const screenshotBytes = await page.screenshot({ type: 'png', fullPage: false })
          results.push({ action: 'screenshot', success: true, screenshotBytes })
          break
        }

        case 'getText': {
          if (!step.selector) throw new Error(`step ${i} (getText): selector is required`)
          const text = await page.innerText(step.selector, { timeout })
          results.push({ action: 'getText', selector: step.selector, success: true, textContent: text })
          break
        }

        default: {
          const unknown = (step as FlowStep).action
          throw new Error(`step ${i}: unknown action '${unknown}'`)
        }
      }

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      results.push({ action: step.action, selector: step.selector, success: false, error: msg })
      // Re-throw so caller can catch and record PORTAL_ERROR
      throw new Error(
        `[portal-flow] step ${i} (${step.action}${step.selector ? ` selector=${step.selector}` : ''}) failed: ${msg}`
      )
    }
  }

  return results
}
