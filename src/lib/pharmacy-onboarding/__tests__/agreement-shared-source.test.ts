/**
 * @jest-environment node
 *
 * The pharmacy BAA comes from the shared onboarding source
 * (src/lib/onboarding/agreement-texts.ts, AGREEMENTS.baa, generated from
 * src/content/legal/), never a copy pinned here. When the shared text and
 * version change (as v0.1.1 to v1.0 did), the pharmacy flow shows,
 * hashes and records the new ones with no edit here. (The mocked text
 * below stands for any next version.)
 */

import { createHash } from 'node:crypto'

const NEW_TEXT = '# Business Associate Agreement\n\n_Version 2.0_\n\nBody of the next version.\n'
jest.mock('@/lib/onboarding/agreement-texts', () => ({
  AGREEMENTS: {
    baa:   { key: 'baa', title: 'Business Associate Agreement', version: 'v2.0', text: '# Business Associate Agreement\n\n_Version 2.0_\n\nBody of the next version.\n' },
    terms: { key: 'terms', title: 'Terms of Service', version: 't', text: 't' },
  },
}))

import { AGREEMENT, agreementText, agreementTextSha256 } from '../agreement'
import { validateAcceptance } from '../validate'

it('version, title and text are the shared ones', () => {
  expect(AGREEMENT.version).toBe('v2.0')
  expect(AGREEMENT.key).toBe('baa')
  expect(AGREEMENT.title).toBe('Business Associate Agreement')
  expect(agreementText()).toBe(NEW_TEXT)
  expect(agreementTextSha256()).toBe(createHash('sha256').update(NEW_TEXT, 'utf8').digest('hex'))
})

it('an acceptance is recorded against the shared version and its hash', () => {
  const sha = createHash('sha256').update(NEW_TEXT, 'utf8').digest('hex')
  const r = validateAcceptance({ signerName: 'Dana Ruiz', signerTitle: 'PIC', templateVersion: 'v2.0', textSha256: sha, accept: true })
  expect(r).toEqual(expect.objectContaining({ ok: true }))
  const stale = validateAcceptance({ signerName: 'Dana Ruiz', signerTitle: 'PIC', templateVersion: 'v1.0', textSha256: sha, accept: true })
  expect(stale).toEqual(expect.objectContaining({ ok: false }))
})
