/**
 * @jest-environment node
 *
 * The pharmacy BAA comes from the shared onboarding source
 * (src/lib/onboarding/agreement-texts.ts, AGREEMENTS.baa, generated from
 * src/content/legal/), never a copy pinned here. When the shared text and
 * version change (v0.1 to v0.1.1, "Notes for counsel" removed), the
 * pharmacy flow shows, hashes and records the new ones with no edit here.
 */

import { createHash } from 'node:crypto'

const NEW_TEXT = '# Business Associate Agreement\n\n_Draft v0.1.1_\n\nBody without the counsel notes.\n'
jest.mock('@/lib/onboarding/agreement-texts', () => ({
  AGREEMENTS: {
    baa:   { key: 'baa', title: 'Business Associate Agreement', version: 'v0.1.1', draft: true, text: '# Business Associate Agreement\n\n_Draft v0.1.1_\n\nBody without the counsel notes.\n' },
    terms: { key: 'terms', title: 'Terms of Service', version: 't', draft: true, text: 't' },
  },
  DRAFT_BANNER: 'Draft, pending legal review',
}))

import { AGREEMENT, agreementText, agreementTextSha256 } from '../agreement'
import { validateAcceptance } from '../validate'

it('version, title and text are the shared ones', () => {
  expect(AGREEMENT.version).toBe('v0.1.1')
  expect(AGREEMENT.key).toBe('baa')
  expect(AGREEMENT.title).toBe('Business Associate Agreement')
  expect(AGREEMENT.banner).toBe('Draft, pending legal review')
  expect(agreementText()).toBe(NEW_TEXT)
  expect(agreementText()).not.toContain('Notes for counsel')
  expect(agreementTextSha256()).toBe(createHash('sha256').update(NEW_TEXT, 'utf8').digest('hex'))
})

it('an acceptance is recorded against the shared version and its hash', () => {
  const sha = createHash('sha256').update(NEW_TEXT, 'utf8').digest('hex')
  const r = validateAcceptance({ signerName: 'Dana Ruiz', signerTitle: 'PIC', templateVersion: 'v0.1.1', textSha256: sha, accept: true })
  expect(r).toEqual(expect.objectContaining({ ok: true }))
  const stale = validateAcceptance({ signerName: 'Dana Ruiz', signerTitle: 'PIC', templateVersion: 'v0.1', textSha256: sha, accept: true })
  expect(stale).toEqual(expect.objectContaining({ ok: false }))
})
