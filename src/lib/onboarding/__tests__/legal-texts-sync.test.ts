/**
 * @jest-environment node
 *
 * The legal texts shown in onboarding are the Markdown files under
 * src/content/legal/, word for word: the browser gets them from
 * legal-texts.generated.ts, and an acceptance records the SHA-256 of the
 * exact text. If the Markdown changes and the generated file is not
 * regenerated (node scripts/gen-legal-texts.mjs), this fails, so nobody
 * accepts text that differs from the file of record. The same holds for
 * the archived versions kept for "View text".
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as generated from '../legal-texts.generated'

const md = (rel: string) => readFileSync(join(process.cwd(), 'src', 'content', 'legal', rel), 'utf8').replace(/\r\n/g, '\n')

it.each([
  ['BAA_V1_0_TEXT', 'baa-v1.0.md'],
  ['CLINIC_TERMS_V1_0_TEXT', 'clinic-terms-v1.0.md'],
  ['PHARMACY_TERMS_V1_1_TEXT', 'pharmacy-terms-v1.1.md'],
  ['BAA_V0_1_ORIGINAL_TEXT', 'archive/baa-draft-v0.1-original.md'],
  ['BAA_V0_1_1_TEXT', 'archive/baa-draft-v0.1.1.md'],
  ['CLINIC_TERMS_DRAFT_2026_10_2_TEXT', 'archive/clinic-terms-draft-2026-10.2.md'],
  ['PHARMACY_TERMS_V0_1_TEXT', 'archive/pharmacy-terms-draft-v0.1.md'],
] as const)('%s is src/content/legal/%s exactly', (name, file) => {
  expect(generated[name]).toBe(md(file))
})

it('the current BAA has no notes for counsel', () => {
  expect(generated.BAA_V1_0_TEXT).not.toMatch(/Notes for counsel/i)
  expect(generated.BAA_V1_0_TEXT).not.toMatch(/remove before use/i)
})
