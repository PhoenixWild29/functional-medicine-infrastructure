// ============================================================
// Pharmacy BAA: the v0.1 draft template
// ============================================================
//
// The text is src/content/legal/baa-draft-v0.1.md (PR #213), read as
// committed. DRAFT, pending legal review: shown with that banner wherever
// it appears. The acceptance record (pharmacy_agreement_acceptances,
// append-only) stores the key, the version and the SHA-256 of this exact
// text, so what was accepted can be proven later. A new text is a new file
// and a new version: an acceptance of an older version is refused, never
// carried over.
//
// Exact text: the file's bytes as committed. .gitattributes pins
// src/content/legal/*.md to LF, and CRLF is folded to LF here as well, so a
// Windows checkout hashes the same as production. next.config.ts traces the
// file into every function that reads it.
//
// Server only (node:fs).

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

export const AGREEMENT = {
  key:     'baa',
  version: 'v0.1',
  draft:   true,
  banner:  'Draft, pending legal review',
  title:   'Business Associate Agreement',
  path:    'src/content/legal/baa-draft-v0.1.md',
} as const

let cached: string | null = null

/** The agreement text, exactly as committed. */
export function agreementText(): string {
  if (cached === null) {
    cached = readFileSync(join(process.cwd(), AGREEMENT.path), 'utf8').replace(/\r\n/g, '\n')
  }
  return cached
}

export function agreementTextSha256(text: string = agreementText()): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}
