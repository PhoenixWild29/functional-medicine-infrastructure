/**
 * @jest-environment node
 *
 * The legal templates shown in onboarding are the Markdown files under
 * src/content/legal/, word for word: the browser gets them from
 * legal-texts.generated.ts, and an acceptance records the SHA-256 of the
 * exact text. If the Markdown changes and the generated file is not
 * regenerated (node scripts/gen-legal-texts.mjs), this fails, so nobody
 * accepts text that differs from the file of record.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BAA_V0_1_TEXT } from '../legal-texts.generated'

it('the BAA v0.1 shown in onboarding is src/content/legal/baa-draft-v0.1.md exactly', () => {
  const md = readFileSync(join(process.cwd(), 'src', 'content', 'legal', 'baa-draft-v0.1.md'), 'utf8').replace(/\r\n/g, '\n')
  expect(BAA_V0_1_TEXT).toBe(md)
})
