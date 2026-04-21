// ============================================================
// Provider-signature drawing helper for E2E tests
// ============================================================
//
// Draws a test signature on the provider signature canvas at
// /new-prescription/review.
//
// # Why page.evaluate() instead of Playwright's mouse/pointer APIs
//
// react-signature-canvas ^1.0.6 wraps signature_pad v4, which listens
// ONLY to pointer events (pointerdown on canvas; pointermove + pointerup
// on document after the stroke starts). Both page.mouse.* and
// locator.dispatchEvent() have engine-level quirks in headless CI that
// cause signature_pad to receive malformed or missing events:
//
//   - page.mouse.down() dispatches a MouseEvent. Chromium's input pipeline
//     normally synthesises a matching PointerEvent, but in headless mode
//     the synthesis is inconsistent around pointerType/pressure/isPrimary —
//     exactly the fields signature_pad checks to validate a stroke.
//
//   - locator.dispatchEvent('pointerdown', { clientX, ... }) constructs a
//     plain Event (not a PointerEvent), because Playwright's injected
//     dispatcher has no explicit handling for pointer event types. All
//     coordinate properties are silently dropped. signature_pad's
//     _createPoint(event) then reads event.clientX → undefined → NaN → no
//     valid points in the stroke → endStroke never fires → onEnd never
//     called → setSignatureCaptured(true) never runs.
//
// Using page.evaluate() lets us construct real PointerEvent objects via
// the native Web API in the browser context. These are indistinguishable
// from browser-synthesised events as far as signature_pad is concerned.
//
// # Dispatch topology
//
// - pointerdown → dispatched on the canvas element (where signature_pad's
//   initial listener is attached).
// - pointermove / pointerup → dispatched on `document`, because
//   signature_pad's _strokeBegin() attaches those listeners to document
//   (a common pattern for drawing libs, so the pointer is tracked even
//   when it leaves the canvas bounds).
//
// # Stroke shape
//
// 12 points in a zigzag pattern, ~84px horizontal span, ±10px vertical
// oscillation. This exceeds signature_pad's default minDistance threshold
// (5px) at every step and guarantees multiple valid points in the stroke.

import { expect, type Page } from '@playwright/test'

export async function drawTestSignature(page: Page): Promise<void> {
  const canvas = page.locator('canvas[aria-label="Provider signature pad"]').first()
  await expect(canvas).toBeVisible({ timeout: 15_000 })

  await page.evaluate(() => {
    const el = document.querySelector<HTMLCanvasElement>(
      'canvas[aria-label="Provider signature pad"]'
    )
    if (!el) throw new Error('drawTestSignature: canvas not found in DOM')

    const rect = el.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2

    const common: PointerEventInit = {
      bubbles:     true,
      cancelable:  true,
      composed:    true,
      pointerType: 'mouse',
      isPrimary:   true,
      view:        window,
    }

    // 1. pointerdown on the canvas — signature_pad's initial listener fires,
    //    _strokeBegin() runs, document listeners attached for move+up.
    el.dispatchEvent(new PointerEvent('pointerdown', {
      ...common,
      clientX: cx - 40,
      clientY: cy,
      pressure: 0.5,
    }))

    // 2. pointermove dispatched on document — where signature_pad attached
    //    its listener in step 1. Zigzag keeps every point above minDistance.
    for (let i = 0; i < 12; i++) {
      document.dispatchEvent(new PointerEvent('pointermove', {
        ...common,
        clientX: cx - 40 + (i * 7),
        clientY: cy + (i % 2 === 0 ? -10 : 10),
        pressure: 0.5,
      }))
    }

    // 3. pointerup on document finalises the stroke and fires endStroke,
    //    which react-signature-canvas forwards to the `onEnd` prop.
    document.dispatchEvent(new PointerEvent('pointerup', {
      ...common,
      clientX: cx + 44,
      clientY: cy,
      pressure: 0,
    }))
  })

  // onEnd → setSignatureCaptured(true) renders the conditional span.
  // See src/app/(clinic-app)/new-prescription/review/_components/batch-review-form.tsx:299
  await expect(page.getByText('Signature captured')).toBeVisible({ timeout: 5_000 })
}
