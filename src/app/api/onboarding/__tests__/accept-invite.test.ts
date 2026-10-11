/**
 * @jest-environment node
 *
 * POST /api/onboarding/invite/accept (public: the token is the credential).
 *
 *   - a valid, unused, unexpired, unrevoked token creates the account for
 *     the invited email, with role and clinic in app_metadata (service
 *     role), never user_metadata; the invite is claimed first so a second
 *     submit cannot create a second account
 *   - a provider invite links the account to its provider row
 *   - an unknown, expired, revoked or used token is refused and no
 *     account is created
 *   - an email that already has an account frees the invite again
 */

import { createHash } from 'node:crypto'
import { NextRequest } from 'next/server'
import { scriptedDb, type Script } from '@/__tests__/helpers/scripted-db'

const CLINIC   = '11111111-1111-4111-8111-111111111111'
const INVITE   = '22222222-2222-4222-8222-222222222222'
const PROVIDER = '33333333-3333-4333-8333-333333333333'
const TOKEN    = 'tok_abcdefghijklmnopqrstuvwxyz0123456789ABCDEF'
const HASH     = createHash('sha256').update(TOKEN).digest('hex')

let db = scriptedDb(() => undefined)
const createUser = jest.fn()
const deleteUser = jest.fn()

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => Object.assign(db.client as object, { auth: { admin: { createUser, deleteUser } } }),
}))
jest.spyOn(console, 'error').mockImplementation(() => {})
jest.spyOn(console, 'info').mockImplementation(() => {})
jest.spyOn(console, 'warn').mockImplementation(() => {})

import { POST } from '../invite/accept/route'
import { inviteAcceptLimiter } from '@/lib/onboarding/accept-rate-limit'

const req = (body: unknown) => new NextRequest('http://localhost/api/onboarding/invite/accept', { method: 'POST', body: JSON.stringify(body) })
const GOOD = { token: TOKEN, fullName: 'Lauren Perkins', password: 'Correct-Horse-9' }

function invite(over: Record<string, unknown> = {}) {
  return {
    invite_id: INVITE, kind: 'clinic_admin', clinic_id: CLINIC, email: 'lauren@sunrise.test', provider_id: null,
    accepted_at: null, revoked_at: null, expires_at: '2999-01-01T00:00:00Z', ...over,
  }
}

function script(row: Record<string, unknown> | null, claimWins = true): Script {
  return call => {
    if (call.table === 'onboarding_invites' && call.op === 'select') return { data: row }
    if (call.table === 'onboarding_invites' && call.op === 'update') {
      const claiming = (call.payload as Record<string, unknown>)['accepted_at'] !== undefined
        && (call.payload as Record<string, unknown>)['accepted_at'] !== null
      if (claiming) return { data: claimWins ? [{ invite_id: INVITE }] : [] }
      return { data: [{ invite_id: INVITE }] }
    }
    if (call.table === 'providers' && call.op === 'update') return { data: [{ provider_id: PROVIDER }] }
    return undefined
  }
}

beforeEach(() => {
  // The route is rate limited per IP; these tests are not about that.
  inviteAcceptLimiter.reset()
  createUser.mockReset().mockResolvedValue({ data: { user: { id: 'new-user' } }, error: null })
  deleteUser.mockReset().mockResolvedValue({ error: null })
  db = scriptedDb(script(invite()))
})

describe('accepting a clinic admin invite', () => {
  it('creates the account with role and clinic in app_metadata, for the invited email', async () => {
    const res = await POST(req(GOOD))
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual(expect.objectContaining({ email: 'lauren@sunrise.test', role: 'clinic_admin' }))

    expect(createUser).toHaveBeenCalledTimes(1)
    const attrs = createUser.mock.calls[0]![0] as Record<string, unknown>
    expect(attrs).toEqual(expect.objectContaining({
      email: 'lauren@sunrise.test', password: 'Correct-Horse-9', email_confirm: true,
      app_metadata: { app_role: 'clinic_admin', clinic_id: CLINIC },
    }))
    const userMeta = (attrs['user_metadata'] ?? {}) as Record<string, unknown>
    expect(userMeta['app_role']).toBeUndefined()
    expect(userMeta['clinic_id']).toBeUndefined()
    expect(userMeta['full_name']).toBe('Lauren Perkins')
  })

  it('looks the invite up by the hash of the token, never the token itself', async () => {
    await POST(req(GOOD))
    const [lookup] = db.to('onboarding_invites', 'select')
    expect(lookup!.filters['token_hash']).toBe(HASH)
    expect(JSON.stringify(db.calls)).not.toContain(TOKEN)
  })

  it('claims the invite before creating the account, and moves the clinic into onboarding', async () => {
    await POST(req(GOOD))
    const updates = db.to('onboarding_invites', 'update')
    expect(updates[0]!.filters).toEqual(expect.objectContaining({ invite_id: INVITE, 'accepted_at:is': null, 'revoked_at:is': null }))
    expect(db.to('clinics', 'update')[0]!.payload).toEqual(expect.objectContaining({ onboarding_status: 'in_progress' }))
    expect(db.to('clinic_onboarding_events', 'insert')[0]!.payload).toEqual(expect.objectContaining({ event: 'invite_accepted', actor_user_id: 'new-user' }))
  })

  it('a second submit that loses the claim creates no account', async () => {
    db = scriptedDb(script(invite(), false))
    const res = await POST(req(GOOD))
    expect(res.status).toBe(410)
    expect(createUser).not.toHaveBeenCalled()
  })
})

describe('accepting a provider or staff invite', () => {
  it('a provider gets the provider role and is linked to their provider row', async () => {
    db = scriptedDb(script(invite({ kind: 'provider', provider_id: PROVIDER, email: 'dr.chen@sunrise.test' })))
    const res = await POST(req(GOOD))
    expect(res.status).toBe(201)
    expect((createUser.mock.calls[0]![0] as Record<string, unknown>)['app_metadata']).toEqual({ app_role: 'provider', clinic_id: CLINIC })
    const [link] = db.to('providers', 'update')
    expect(link!.payload).toEqual({ user_id: 'new-user' })
    expect(link!.filters).toEqual(expect.objectContaining({ provider_id: PROVIDER, clinic_id: CLINIC, 'user_id:is': null }))
  })

  it('a medical assistant gets the medical_assistant role', async () => {
    db = scriptedDb(script(invite({ kind: 'medical_assistant', email: 'ma@sunrise.test' })))
    expect((await POST(req(GOOD))).status).toBe(201)
    expect((createUser.mock.calls[0]![0] as Record<string, unknown>)['app_metadata']).toEqual({ app_role: 'medical_assistant', clinic_id: CLINIC })
  })
})

describe('refused invites create no account', () => {
  it.each([
    ['unknown',  null],
    ['expired',  invite({ expires_at: '2020-01-01T00:00:00Z' })],
    ['revoked',  invite({ revoked_at: '2026-10-01T00:00:00Z' })],
    ['used',     invite({ accepted_at: '2026-10-01T00:00:00Z' })],
  ])('%s token', async (_name, row) => {
    db = scriptedDb(script(row as Record<string, unknown> | null))
    const res = await POST(req(GOOD))
    expect([404, 410]).toContain(res.status)
    expect(createUser).not.toHaveBeenCalled()
  })

  it('a weak password or missing name is 400', async () => {
    expect((await POST(req({ ...GOOD, password: 'short' }))).status).toBe(400)
    expect((await POST(req({ ...GOOD, fullName: ' ' }))).status).toBe(400)
    expect(createUser).not.toHaveBeenCalled()
  })

  it('an email that already has an account is 409 and frees the invite', async () => {
    createUser.mockResolvedValue({ data: { user: null }, error: { message: 'A user with this email address has already been registered' } })
    const res = await POST(req(GOOD))
    expect(res.status).toBe(409)
    const release = db.to('onboarding_invites', 'update').find(u => (u.payload as Record<string, unknown>)['accepted_at'] === null)
    expect(release).toBeDefined()
  })
})
