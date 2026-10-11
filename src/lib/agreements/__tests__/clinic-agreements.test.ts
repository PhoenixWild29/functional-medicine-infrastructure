/**
 * @jest-environment node
 *
 * A clinic's agreements after onboarding (/settings/agreements):
 *   - the text a clinic accepted is shown only when it is known AND its
 *     SHA-256 matches the acceptance (BAA v0.1 is kept, verbatim, in the
 *     archive: #218 replaced it with v0.1.1)
 *   - each agreement: current version, every acceptance (newest first),
 *     and whether a newer version than the latest acceptance is available
 *   - a new acceptance is recorded exactly as the onboarding wizard does:
 *     the current version and the SHA-256 of the server's copy of the
 *     text; a stale version is refused
 *   - the dashboard notice is for the clinic admin only
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { scriptedDb, type ScriptedCall } from '@/__tests__/helpers/scripted-db'
import { AGREEMENTS } from '@/lib/onboarding/agreement-texts'
import { BAA_V0_1_0_ARCHIVED_TEXT } from '@/lib/onboarding/legal-texts.generated'
import {
  agreementTextFor, loadClinicAgreements, recordAgreementAcceptance, loadAgreementNotice, verifiedAcceptedText,
} from '../clinic-agreements'

const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex')
const CLINIC = 'c0000000-0000-4000-8000-000000000001'
const V01_SHA = '14367b35e4b4ef51e6ed53d150275474635929a38c9bb900eef8d6e77ebc064e'

const row = (over: Record<string, unknown>) => ({
  acceptance_id: 'a1', agreement: 'baa', template_version: AGREEMENTS.baa.version, text_sha256: sha(AGREEMENTS.baa.text),
  signer_name: 'Jo Park', signer_title: 'Owner', accepted_at: '2026-10-10T13:00:00Z', ...over,
})

function db(rows: Array<Record<string, unknown>>, extra?: (c: ScriptedCall) => unknown) {
  return scriptedDb(c => {
    const e = extra?.(c)
    if (e) return e as never
    if (c.table === 'agreement_acceptances' && c.op === 'select') {
      const wanted = c.filters['acceptance_id']
      const pick = wanted ? rows.filter(r => r['acceptance_id'] === wanted) : rows
      return { data: c.single ? pick[0] ?? null : pick }
    }
    return undefined
  })
}

describe('the texts a clinic may have accepted', () => {
  it('BAA v0.1 is archived word for word (the hash v0.1 acceptances recorded)', () => {
    expect(sha(BAA_V0_1_0_ARCHIVED_TEXT)).toBe(V01_SHA)
    const md = readFileSync(join(process.cwd(), 'src', 'content', 'legal', 'archive', 'baa-draft-v0.1.0.md'), 'utf8').replace(/\r\n/g, '\n')
    expect(BAA_V0_1_0_ARCHIVED_TEXT).toBe(md)
  })

  it('looks a text up by agreement and version; the current versions are the live templates', () => {
    expect(agreementTextFor('baa', 'v0.1')).toBe(BAA_V0_1_0_ARCHIVED_TEXT)
    expect(agreementTextFor('baa', AGREEMENTS.baa.version)).toBe(AGREEMENTS.baa.text)
    expect(agreementTextFor('terms', AGREEMENTS.terms.version)).toBe(AGREEMENTS.terms.text)
    expect(agreementTextFor('baa', 'v9')).toBeNull()
  })

  it('a text is shown only when its hash matches the acceptance', () => {
    expect(verifiedAcceptedText({ agreement: 'baa', version: 'v0.1', textSha256: V01_SHA })).toBe(BAA_V0_1_0_ARCHIVED_TEXT)
    expect(verifiedAcceptedText({ agreement: 'baa', version: 'v0.1', textSha256: '0'.repeat(64) })).toBeNull()
    expect(verifiedAcceptedText({ agreement: 'baa', version: 'v9', textSha256: V01_SHA })).toBeNull()
  })
})

describe('loadClinicAgreements', () => {
  it('lists each agreement: current version, acceptances newest first, and no update when the latest is current', async () => {
    const d = db([
      row({ acceptance_id: 'a2', agreement: 'baa' }),
      row({ acceptance_id: 'a3', agreement: 'terms', template_version: AGREEMENTS.terms.version, text_sha256: sha(AGREEMENTS.terms.text), accepted_at: '2026-10-10T14:00:00Z' }),
      row({ acceptance_id: 'a1', agreement: 'baa', template_version: 'v0.1', text_sha256: V01_SHA, accepted_at: '2026-10-02T13:00:00Z' }),
    ])
    const r = await loadClinicAgreements(d.client, CLINIC)
    expect(r.baa.current).toEqual({ title: 'Business Associate Agreement', version: AGREEMENTS.baa.version })
    expect(r.baa.acceptances.map(a => a.acceptanceId)).toEqual(['a2', 'a1'])
    expect(r.baa.acceptances[1]).toEqual(expect.objectContaining({ version: 'v0.1', signerName: 'Jo Park', signerTitle: 'Owner', acceptedAt: '2026-10-02T13:00:00Z' }))
    expect(r.baa.updateAvailable).toBe(false)
    expect(r.terms.updateAvailable).toBe(false)
    expect(d.to('agreement_acceptances')[0]!.filters['clinic_id']).toBe(CLINIC)
  })

  it('a newer current version than the latest acceptance is an update', async () => {
    const r = await loadClinicAgreements(db([row({ template_version: 'v0.1', text_sha256: V01_SHA })]).client, CLINIC)
    expect(r.baa.updateAvailable).toBe(true)
    expect(r.baa.latest!.version).toBe('v0.1')
  })

  it('nothing accepted yet: no acceptances, not reported as an update', async () => {
    const r = await loadClinicAgreements(db([]).client, CLINIC)
    expect(r.terms.acceptances).toEqual([])
    expect(r.terms.latest).toBeNull()
    expect(r.terms.updateAvailable).toBe(false)
  })

  it('a read that fails throws', async () => {
    await expect(loadClinicAgreements(db([], () => ({ error: { message: 'down' } })).client, CLINIC)).rejects.toThrow()
  })
})

describe('recordAgreementAcceptance', () => {
  it('records the current version and the SHA-256 of the server copy of the text', async () => {
    const d = db([])
    const r = await recordAgreementAcceptance(d.client, { clinicId: CLINIC, userId: 'u-1', agreement: 'baa', version: AGREEMENTS.baa.version, signerName: ' Jo Park ', signerTitle: 'Owner' })
    expect(r).toEqual({ ok: true, version: AGREEMENTS.baa.version })
    const [ins] = d.to('agreement_acceptances', 'insert')
    expect(ins!.payload).toEqual({
      clinic_id: CLINIC, agreement: 'baa', template_version: AGREEMENTS.baa.version, text_sha256: sha(AGREEMENTS.baa.text),
      signer_name: 'Jo Park', signer_title: 'Owner', user_id: 'u-1',
    })
  })

  it('a version that is not the current one is refused (409), nothing written', async () => {
    const d = db([])
    const r = await recordAgreementAcceptance(d.client, { clinicId: CLINIC, userId: 'u-1', agreement: 'baa', version: 'v0.1', signerName: 'Jo', signerTitle: 'Owner' })
    expect(r).toEqual(expect.objectContaining({ ok: false, status: 409 }))
    expect(d.to('agreement_acceptances', 'insert')).toEqual([])
  })

  it('missing signer details are refused (400) with field errors', async () => {
    const r = await recordAgreementAcceptance(db([]).client, { clinicId: CLINIC, userId: 'u-1', agreement: 'terms', version: AGREEMENTS.terms.version, signerName: ' ', signerTitle: '' })
    expect(r).toEqual(expect.objectContaining({ ok: false, status: 400, errors: { signerName: expect.any(String), signerTitle: expect.any(String) } }))
  })

  it('a failed write is reported (500)', async () => {
    const r = await recordAgreementAcceptance(db([], c => (c.op === 'insert' ? { error: { message: 'down' } } : undefined)).client, { clinicId: CLINIC, userId: 'u-1', agreement: 'terms', version: AGREEMENTS.terms.version, signerName: 'Jo', signerTitle: 'Owner' })
    expect(r).toEqual(expect.objectContaining({ ok: false, status: 500 }))
  })
})

describe('loadAgreementNotice (dashboard banner)', () => {
  const admin = { id: 'u', app_metadata: { app_role: 'clinic_admin', clinic_id: CLINIC } }

  it('the clinic admin: the agreements with a newer version', async () => {
    const n = await loadAgreementNotice(db([row({ template_version: 'v0.1', text_sha256: V01_SHA })]).client, admin)
    expect(n).toEqual({ agreements: [{ key: 'baa', title: 'Business Associate Agreement', version: AGREEMENTS.baa.version }] })
  })

  it('nothing to update: no notice', async () => {
    expect(await loadAgreementNotice(db([row({})]).client, admin)).toBeNull()
  })

  it.each(['provider', 'medical_assistant', 'ops_admin'])('a %s: no notice, nothing read', async role => {
    const d = db([row({ template_version: 'v0.1' })])
    expect(await loadAgreementNotice(d.client, { id: 'u', app_metadata: { app_role: role, clinic_id: CLINIC } })).toBeNull()
    expect(d.calls).toEqual([])
  })

  it('a role only in user_metadata is not trusted', async () => {
    const d = db([row({ template_version: 'v0.1' })])
    expect(await loadAgreementNotice(d.client, { id: 'u', user_metadata: { app_role: 'clinic_admin', clinic_id: CLINIC }, app_metadata: {} })).toBeNull()
  })

  it('a read that fails: no notice (ordering is never blocked)', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    expect(await loadAgreementNotice(db([], () => ({ error: { message: 'down' } })).client, admin)).toBeNull()
  })
})
