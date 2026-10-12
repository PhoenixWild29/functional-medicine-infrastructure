/**
 * @jest-environment node
 *
 * Legal documents v1.0 (final). Clinics and pharmacies are offered v1.0 of
 * the BAA, the Clinic Terms of Service and the Pharmacy Terms of Service,
 * from src/content/legal/*-v1.0.md, with no draft flag or banner.
 *
 * Every version already accepted stays provable: its exact text is kept
 * in src/content/legal/archive/, byte for byte, and an acceptance record
 * (version + SHA-256) still resolves to that text on /settings/agreements
 * and /pharmacy/agreements. The hashes below are the ones recorded by
 * acceptances before v1.0; they must never change.
 *
 * Because the versions changed, an earlier acceptance now shows "a new
 * version is available" for all four agreements.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { scriptedDb } from '@/__tests__/helpers/scripted-db'
import * as texts from '../agreement-texts'
import { AGREEMENTS, PHARMACY_TERMS } from '../agreement-texts'
import { AGREEMENT_ARCHIVE } from '../agreement-archive'
import { verifiedAcceptedText, loadClinicAgreements } from '@/lib/agreements/clinic-agreements'
import { acceptedText, pharmacyAgreement } from '@/lib/pharmacy-onboarding/agreement'
import { listPharmacyAgreements } from '@/lib/pharmacy-onboarding/agreements-history'

const file = (rel: string) => readFileSync(join(process.cwd(), 'src', 'content', 'legal', rel), 'utf8').replace(/\r\n/g, '\n')
const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex')

describe('current versions are v1.0, final', () => {
  it.each([
    ['clinic BAA', AGREEMENTS.baa, 'baa-v1.0.md'],
    ['clinic terms', AGREEMENTS.terms, 'clinic-terms-v1.0.md'],
    ['pharmacy terms', PHARMACY_TERMS, 'pharmacy-terms-v1.0.md'],
  ] as const)('%s: version v1.0, the v1.0 file word for word, no draft flag', (_l, a, f) => {
    expect(a.version).toBe('v1.0')
    expect(a.text).toBe(file(f))
    expect('draft' in a).toBe(false)
  })

  it('the pharmacy BAA is the same v1.0 BAA', () => {
    expect(pharmacyAgreement('baa').version).toBe('v1.0')
    expect(pharmacyAgreement('baa').text).toBe(file('baa-v1.0.md'))
    expect(pharmacyAgreement('pharmacy_terms').version).toBe('v1.0')
  })

  it('there is no draft banner to render', () => {
    expect('DRAFT_BANNER' in texts).toBe(false)
    for (const a of [AGREEMENTS.baa, AGREEMENTS.terms, PHARMACY_TERMS]) {
      expect(a.text).not.toMatch(/DRAFT|Draft|pending legal review/)
    }
    const p = pharmacyAgreement('baa') as unknown as Record<string, unknown>
    expect(p['banner']).toBeUndefined()
    expect(p['draft']).toBeUndefined()
  })
})

// The SHA-256 each earlier version was accepted under. Never change these.
const ARCHIVED = [
  { key: 'baa',            version: 'v0.1',                  file: 'archive/baa-draft-v0.1-original.md',      sha: '14367b35e4b4ef51e6ed53d150275474635929a38c9bb900eef8d6e77ebc064e' },
  { key: 'baa',            version: 'v0.1.1',                file: 'archive/baa-draft-v0.1.1.md',             sha: 'b26c8364eaa68733a4d47ddd2d07fb554edc1a2f3fb4ed7b962f4bb16e5277d1' },
  { key: 'terms',          version: 'terms-draft-2026-10.2', file: 'archive/clinic-terms-draft-2026-10.2.md', sha: '6120b276352ef69e3af834e771641cfaa2dd69677ab0aa61564e5dd0591007be' },
  { key: 'pharmacy_terms', version: 'v0.1',                  file: 'archive/pharmacy-terms-draft-v0.1.md',    sha: '770a0ac610e73a63f1551805fd796b90b22ca6bc0b25b94a49f19a7a513d26c5' },
] as const

describe('archived versions: each accepted hash still resolves to its exact text', () => {
  it.each(ARCHIVED)('$key $version: the archived file has the recorded SHA-256', a => {
    expect(sha(file(a.file))).toBe(a.sha)
  })

  it('the archive lists exactly these versions, each with its file text', () => {
    expect(AGREEMENT_ARCHIVE.map(a => `${a.key}@${a.version}`).sort()).toEqual(ARCHIVED.map(a => `${a.key}@${a.version}`).sort())
    for (const a of ARCHIVED) {
      expect(AGREEMENT_ARCHIVE.find(x => x.key === a.key && x.version === a.version)!.text).toBe(file(a.file))
    }
  })

  it.each(ARCHIVED.filter(a => a.key !== 'pharmacy_terms'))('clinic "View text": $key $version', a => {
    const agreement = a.key as 'baa' | 'terms'
    expect(verifiedAcceptedText({ agreement, version: a.version, textSha256: a.sha })).toBe(file(a.file))
    expect(verifiedAcceptedText({ agreement, version: a.version, textSha256: 'f'.repeat(64) })).toBeNull()
  })

  it.each(ARCHIVED.filter(a => a.key !== 'terms'))('pharmacy "View text": $key $version', a => {
    const key = a.key as 'baa' | 'pharmacy_terms'
    expect(acceptedText(key, a.version, a.sha)).toBe(file(a.file))
    expect(acceptedText(key, a.version, 'f'.repeat(64))).toBeNull()
  })

  it('a version is never matched to another agreement\'s text', () => {
    expect(acceptedText('pharmacy_terms', 'v0.1', ARCHIVED[0].sha)).toBeNull()
    expect(verifiedAcceptedText({ agreement: 'terms', version: 'v0.1', textSha256: ARCHIVED[0].sha })).toBeNull()
  })

  it('v1.0 acceptances resolve to the v1.0 text', () => {
    expect(verifiedAcceptedText({ agreement: 'baa', version: 'v1.0', textSha256: sha(file('baa-v1.0.md')) })).toBe(file('baa-v1.0.md'))
    expect(verifiedAcceptedText({ agreement: 'terms', version: 'v1.0', textSha256: sha(file('clinic-terms-v1.0.md')) })).toBe(file('clinic-terms-v1.0.md'))
    expect(acceptedText('pharmacy_terms', 'v1.0', sha(file('pharmacy-terms-v1.0.md')))).toBe(file('pharmacy-terms-v1.0.md'))
  })
})

describe('earlier acceptances see "a new version is available"', () => {
  const row = (agreement: string, version: string, s: string) => ({
    acceptance_id: `${agreement}-${version}`, agreement, template_version: version, text_sha256: s,
    signer_name: 'Lauren Perkins', signer_title: 'Owner', accepted_at: '2026-10-11T12:00:00Z',
  })

  it('clinic: BAA v0.1.1 and terms terms-draft-2026-10.2 → update available to v1.0', async () => {
    const db = scriptedDb(c => (c.table === 'agreement_acceptances'
      ? { data: [row('baa', 'v0.1.1', ARCHIVED[1].sha), row('terms', 'terms-draft-2026-10.2', ARCHIVED[2].sha)] }
      : undefined))
    const a = await loadClinicAgreements(db.client as never, 'c-1')
    expect(a.baa).toEqual(expect.objectContaining({ updateAvailable: true, current: expect.objectContaining({ version: 'v1.0' }) }))
    expect(a.terms).toEqual(expect.objectContaining({ updateAvailable: true, current: expect.objectContaining({ version: 'v1.0' }) }))
  })

  it('pharmacy: BAA v0.1.1 and terms v0.1 → new version available', async () => {
    const pr = (key: string, version: string, s: string) => ({ ...row(key, version, s), template_key: key })
    const db = scriptedDb(c => {
      if (c.table !== 'pharmacy_agreement_acceptances') return undefined
      return c.filters['template_key'] === 'baa' ? { data: [pr('baa', 'v0.1.1', ARCHIVED[1].sha)] } : { data: [pr('pharmacy_terms', 'v0.1', ARCHIVED[3].sha)] }
    })
    const res = await listPharmacyAgreements(db.client as never, 'ph-1')
    if (!res.ok) throw new Error('read failed')
    for (const a of res.agreements) {
      expect(a).toEqual(expect.objectContaining({ currentVersion: 'v1.0', acceptedCurrent: false, newVersionAvailable: true }))
    }
  })
})
