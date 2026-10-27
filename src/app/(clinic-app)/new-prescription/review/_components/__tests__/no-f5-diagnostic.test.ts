/**
 * TODO sweep: the F5 signature diagnostic ("[F5-diag]" console.log plus a
 * Sentry breadcrumb on every pen down and pen up) was added to compare
 * this canvas side by side with draft-sign-form.tsx during a walkthrough.
 * draft-sign-form.tsx no longer exists, so there is nothing to compare
 * against; the instrumentation only logged to the provider's browser
 * console. The F5 fix itself stays: capture on both onBegin and onEnd
 * (readSignaturePad) and the "did not register" check on Sign & Send.
 */

import fs from 'node:fs'
import path from 'node:path'

const FORM = path.join(__dirname, '..', 'batch-review-form.tsx')

it('batch-review-form ships no F5 diagnostic logging', () => {
  const src = fs.readFileSync(FORM, 'utf8')
  expect(src).not.toContain('F5-diag')
  expect(src).not.toContain('logSignatureEvent')
  expect(src).not.toMatch(/draft-sign-form\.tsx/)
})

it('the signature is still read when the pen lifts (the F5 fix stays)', () => {
  const src = fs.readFileSync(FORM, 'utf8')
  expect(src).toMatch(/onEnd=\{\(\) => \{[\s\S]*?readSignaturePad\(\)/)
})
