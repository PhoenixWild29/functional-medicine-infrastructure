/**
 * @jest-environment node
 *
 * Decision 9 (docs/decisions/before-real-patients-2026-10-25.md): no
 * clinical difference reason is pre-selected (C8: a signed prescription
 * records the provider's decision, not a default). The comment above
 * STANDARD_CLINICAL_DIFFERENCE_OPTIONS said "First entry is the
 * pre-selected default", which the code never did; it must say what the
 * code does.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = readFileSync(join(process.cwd(), 'src', 'lib', 'orders', 'rx-details.ts'), 'utf8')
const doc = SRC.slice(SRC.lastIndexOf('/**', SRC.indexOf('export const STANDARD_CLINICAL_DIFFERENCE_OPTIONS')), SRC.indexOf('export const STANDARD_CLINICAL_DIFFERENCE_OPTIONS'))

it('the comment on the standard reasons says none is pre-selected', () => {
  expect(doc).not.toMatch(/pre-selected default/i)
  expect(doc).toMatch(/none is pre-selected/i)
})
