// ============================================================
// Provider-signature drawing helper for E2E tests
// ============================================================
//
// The provider signature canvas on /new-prescription/review uses the
// `react-signature-canvas` package, which wraps `signature_pad` internally.
// Since signature_pad v3 (2020), that library listens for pointerdown /
// pointermove / pointerup events — NOT mousedown/mousemove/mouseup.
//
// Playwright's page.mouse.* dispatches MouseEvents. On Chromium the browser
// normally synthesises corresponding PointerEvents automatically, but in
// headless mode the synthesis is inconsistent around pointerType / pressure
// / isPrimary — which are the exact properties signature_pad uses to
// validate a stroke. The result: the mouse pattern executes but the
// library never sees a valid stroke, onEnd never fires, and the
// "Signature captured" state flag stays false.
//
// Fix: dispatch PointerEvents directly on the <canvas> element, with an
// explicit pressure value and a zigzag stroke (10 intermediate points)
// that satisfies any minDistance threshold the library may apply.
//
// This helper also asserts that "Signature captured" text appears after
// the stroke — if the drawing mechanism silently fails in the future,
// the assertion will fail loudly here instead of deep in a caller.

import { expect, type Page } from '@playwright/test'

export async function drawTestSignature(page: Page): Promise<void> {
  const canvas = page.locator('canvas[aria-label="Provider signature pad"]').first()
  await expect(canvas).toBeVisible({ timeout: 15_000 })

  const box = await canvas.boundingBox()
  if (!box) {
    throw new Error('drawTestSignature: canvas bounding box not found')
  }

  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2

  await canvas.dispatchEvent('pointerdown', {
    clientX:     cx - 30,
    clientY:     cy,
    pressure:    0.5,
    pointerType: 'mouse',
    isPrimary:   true,
  })

  for (let i = 0; i < 10; i++) {
    await canvas.dispatchEvent('pointermove', {
      clientX:     cx - 30 + (i * 6),
      clientY:     cy + (i % 2 === 0 ? -5 : 5),
      pressure:    0.5,
      pointerType: 'mouse',
      isPrimary:   true,
    })
  }

  await canvas.dispatchEvent('pointerup', {
    clientX:     cx + 30,
    clientY:     cy,
    pressure:    0,
    pointerType: 'mouse',
    isPrimary:   true,
  })

  // Component renders "Signature captured" (no checkmark prefix) once
  // setSignatureCaptured(true) fires from SignatureCanvas's onEnd callback.
  // See src/app/(clinic-app)/new-prescription/review/_components/batch-review-form.tsx:299
  await expect(page.getByText('Signature captured')).toBeVisible({ timeout: 5_000 })
}
