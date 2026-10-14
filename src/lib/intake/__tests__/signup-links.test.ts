/**
 * @jest-environment node
 *
 * Patient Intake PR 3: a clinic's standing sign-up link.
 *
 *   - The token is derived from the link id with a server secret (HMAC),
 *     so the link can be shown again to staff, but the database keeps only
 *     its SHA-256 (token_hash), like the intake links. A stolen row cannot
 *     be turned into a working link.
 *   - One active link per clinic: making a new link revokes the old one
 *     (the old link stops working).
 *   - A link that is turned off or revoked is 'inactive'; an unknown or
 *     malformed token is 'invalid' (malformed: no database read); a
 *     database error is 'unavailable', never shown as inactive.
 */

import { createHash } from 'node:crypto'
import { scriptedDb, DB_DOWN, type ScriptedCall, type ScriptedAnswer } from '@/__tests__/helpers/scripted-db'
import {
  SIGNUP_DAILY_CAP, signupToken, signupUrl, getSignupLink, createSignupLink, setSignupLinkEnabled, resolveSignupLink,
} from '../signup-links'
import { hashIntakeToken, isWellFormedIntakeToken } from '../token'

const CLINIC_ID = 'aaaaaaaa-aaaa-4aaa-9aaa-aaaaaaaaaaaa'
const LINK_ID = 'c1000000-0000-4000-8000-000000000001'
const USER_ID = 'u1000000-0000-4000-8000-000000000001'
const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

let script: (c: ScriptedCall) => ScriptedAnswer | undefined = () => undefined
let db = scriptedDb(c => script(c))

beforeEach(() => {
  process.env['JWT_SECRET'] = 'test-secret-for-signup-links-0123456789'
  process.env['APP_BASE_URL'] = 'https://app.test/'
  db = scriptedDb(c => script(c))
  script = () => undefined
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

const row = (over: Record<string, unknown> = {}) => ({
  link_id: LINK_ID, clinic_id: CLINIC_ID, enabled: true, revoked_at: null,
  use_count: 3, last_used_at: '2026-10-13T10:00:00+00:00', created_at: '2026-10-01T10:00:00+00:00',
  clinics: { name: 'Test Clinic' }, ...over,
})

describe('the token', () => {
  it('is well formed (43 base64url characters), and the same for the same link', () => {
    const t = signupToken(LINK_ID)
    expect(isWellFormedIntakeToken(t)).toBe(true)
    expect(signupToken(LINK_ID)).toBe(t)
  })

  it('differs per link and per server secret', () => {
    const t = signupToken(LINK_ID)
    expect(signupToken('c1000000-0000-4000-8000-000000000002')).not.toBe(t)
    process.env['JWT_SECRET'] = 'another-secret-entirely-9876543210'
    expect(signupToken(LINK_ID)).not.toBe(t)
  })

  it('is not the link id and cannot be read from it without the secret', () => {
    expect(signupToken(LINK_ID)).not.toContain(LINK_ID)
    expect(signupToken(LINK_ID)).not.toBe(Buffer.from(LINK_ID).toString('base64url'))
  })

  it('is stored only as its SHA-256 (hex), the same hash as intake links', () => {
    const t = signupToken(LINK_ID)
    expect(hashIntakeToken(t)).toBe(sha256(t))
    expect(hashIntakeToken(t)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('the link is /join/<token> on the app base URL', () => {
    expect(signupUrl('T'.repeat(43))).toBe(`https://app.test/join/${'T'.repeat(43)}`)
  })

  it('caps sign-ups at 50 new patients per link per day', () => {
    expect(SIGNUP_DAILY_CAP).toBe(50)
  })
})

describe('createSignupLink', () => {
  it('revokes the clinic’s active link, then stores a new one by hash only', async () => {
    script = c => (c.op === 'insert' ? { data: row({ link_id: (c.payload as { link_id: string }).link_id, use_count: 0, last_used_at: null }) } : undefined)
    const r = await createSignupLink(db.client, { clinicId: CLINIC_ID, createdBy: USER_ID })
    expect(r.ok).toBe(true)

    const [revoke] = db.to('clinic_signup_links', 'update')
    expect(revoke?.filters).toMatchObject({ clinic_id: CLINIC_ID, 'revoked_at:is': null })
    expect(revoke?.payload).toMatchObject({ revoked_by: USER_ID })
    expect((revoke?.payload as { revoked_at: string }).revoked_at).toEqual(expect.any(String))

    const [insert] = db.to('clinic_signup_links', 'insert')
    const payload = insert?.payload as Record<string, unknown>
    expect(payload).toMatchObject({ clinic_id: CLINIC_ID, created_by: USER_ID, enabled: true })
    const token = signupToken(payload['link_id'] as string)
    expect(payload['token_hash']).toBe(sha256(token))
    expect(Object.values(payload)).not.toContain(token)
    expect(payload).not.toHaveProperty('token')
    if (r.ok) expect(r.link.url).toBe(`https://app.test/join/${token}`)
  })

  it('the revoke runs before the insert', async () => {
    script = c => (c.op === 'insert' ? { data: row() } : undefined)
    await createSignupLink(db.client, { clinicId: CLINIC_ID, createdBy: USER_ID })
    const ops = db.calls.filter(c => c.table === 'clinic_signup_links').map(c => c.op)
    expect(ops.indexOf('update')).toBeLessThan(ops.indexOf('insert'))
  })

  it('a database error: not ok, and nothing is inserted when the revoke failed', async () => {
    script = c => (c.op === 'update' ? DB_DOWN : undefined)
    expect((await createSignupLink(db.client, { clinicId: CLINIC_ID, createdBy: USER_ID })).ok).toBe(false)
    expect(db.to('clinic_signup_links', 'insert')).toHaveLength(0)
  })
})

describe('getSignupLink', () => {
  it('reads the clinic’s active (not revoked) link and shows its URL again', async () => {
    script = c => (c.table === 'clinic_signup_links' ? { data: row() } : undefined)
    const r = await getSignupLink(db.client, CLINIC_ID)
    expect(db.to('clinic_signup_links')[0]?.filters).toMatchObject({ clinic_id: CLINIC_ID, 'revoked_at:is': null })
    expect(r).toEqual({
      ok: true,
      link: {
        linkId: LINK_ID, enabled: true, useCount: 3, lastUsedAt: '2026-10-13T10:00:00+00:00', createdAt: '2026-10-01T10:00:00+00:00',
        url: `https://app.test/join/${signupToken(LINK_ID)}`,
      },
    })
  })

  it('no link yet: ok, null', async () => {
    expect(await getSignupLink(db.client, CLINIC_ID)).toEqual({ ok: true, link: null })
  })

  it('a database error: not ok', async () => {
    script = () => DB_DOWN
    expect(await getSignupLink(db.client, CLINIC_ID)).toEqual({ ok: false })
  })
})

describe('setSignupLinkEnabled', () => {
  it('turns the clinic’s active link off (or on), scoped to the clinic', async () => {
    script = c => (c.op === 'update' ? { data: row({ enabled: false }) } : undefined)
    const r = await setSignupLinkEnabled(db.client, { clinicId: CLINIC_ID, enabled: false })
    const [u] = db.to('clinic_signup_links', 'update')
    expect(u?.payload).toEqual({ enabled: false })
    expect(u?.filters).toMatchObject({ clinic_id: CLINIC_ID, 'revoked_at:is': null })
    expect(r.ok && r.link.enabled).toBe(false)
  })

  it('no active link: not ok, none', async () => {
    expect(await setSignupLinkEnabled(db.client, { clinicId: CLINIC_ID, enabled: true })).toEqual({ ok: false, error: 'none' })
  })
})

describe('resolveSignupLink', () => {
  const token = () => signupToken(LINK_ID)

  it('a malformed token is invalid, with no database read', async () => {
    expect(await resolveSignupLink(db.client, 'not-a-token')).toEqual({ state: 'invalid' })
    expect(db.calls).toHaveLength(0)
  })

  it('looks the link up by the token’s hash, never the token', async () => {
    script = () => ({ data: row() })
    await resolveSignupLink(db.client, token())
    const [read] = db.to('clinic_signup_links')
    expect(read?.filters).toEqual({ token_hash: sha256(token()) })
  })

  it('an unknown token is invalid', async () => {
    expect(await resolveSignupLink(db.client, token())).toEqual({ state: 'invalid' })
  })

  it('an open link: its id, clinic and clinic name', async () => {
    script = () => ({ data: row() })
    expect(await resolveSignupLink(db.client, token())).toEqual({ state: 'open', linkId: LINK_ID, clinicId: CLINIC_ID, clinicName: 'Test Clinic' })
  })

  it('a link that is turned off is inactive', async () => {
    script = () => ({ data: row({ enabled: false }) })
    expect(await resolveSignupLink(db.client, token())).toEqual({ state: 'inactive' })
  })

  it('a revoked link (a new one was made) is inactive', async () => {
    script = () => ({ data: row({ revoked_at: '2026-10-13T09:00:00+00:00' }) })
    expect(await resolveSignupLink(db.client, token())).toEqual({ state: 'inactive' })
  })

  it('a database error is unavailable, not inactive', async () => {
    script = () => DB_DOWN
    expect(await resolveSignupLink(db.client, token())).toEqual({ state: 'unavailable' })
  })
})
