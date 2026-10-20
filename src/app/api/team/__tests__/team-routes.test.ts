/**
 * @jest-environment node
 *
 * Team invites: the Settings > Team write routes, for approved clinics.
 *
 *   POST /api/team/providers               add a provider (name, email, NPI,
 *        state licenses) the way the onboarding wizard does
 *        (addProviderRecord: NPI checks, licenses, NPPES registry check),
 *        then a provider invite; the link comes back to copy (no email).
 *   POST /api/team/invites                 invite a medical assistant or a
 *        clinic admin (name, email, role); the link comes back to copy.
 *   POST /api/team/invites/[inviteId]      resend (a new link) or revoke a
 *        pending invite (the #215 inviteAction).
 *   POST /api/team/members/[userId]        deactivate or reactivate a team
 *        member (set_clinic_member_active: atomic, never the last admin).
 *
 * Every route: same-origin only; getUser(), never getSession(); the clinic
 * admin only (403 for medical assistants, providers, ops); clinic and role
 * from claims.ts, never the body; B's approval guard (a clinic still in
 * review gets its 403). No em dashes in what the user reads.
 */

import { scriptedDb, DB_DOWN, type ScriptedCall, type ScriptedAnswer } from '@/__tests__/helpers/scripted-db'

const CLINIC = 'aaaaaaaa-aaaa-4aaa-9aaa-aaaaaaaaaaaa'
const OTHER = 'bbbbbbbb-bbbb-4bbb-9bbb-bbbbbbbbbbbb'
const INVITE = 'c1000000-0000-4000-8000-000000000001'
const MEMBER = 'd1000000-0000-4000-8000-000000000001'
const ADMIN = 'e1000000-0000-4000-8000-000000000001'

const getUserMock = jest.fn()
const getSessionMock = jest.fn()
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn(async () => ({ auth: { getUser: () => getUserMock(), getSession: () => getSessionMock() } })),
}))
let script: (c: ScriptedCall) => ScriptedAnswer | undefined = () => undefined
let db = scriptedDb(c => script(c))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))

const approvalMock = jest.fn()
jest.mock('@/lib/onboarding/approval-guard', () => ({
  ...jest.requireActual('@/lib/onboarding/approval-guard'),
  refuseUnlessApproved: (...a: unknown[]) => approvalMock(...a),
}))
const addProviderMock = jest.fn()
jest.mock('@/lib/onboarding/provider-record', () => ({
  ...jest.requireActual('@/lib/onboarding/provider-record'),
  addProviderRecord: (...a: unknown[]) => addProviderMock(...a),
}))
const createInviteMock = jest.fn()
const inviteActionMock = jest.fn()
jest.mock('@/lib/onboarding/invite-actions', () => ({
  ...jest.requireActual('@/lib/onboarding/invite-actions'),
  createInvite: (...a: unknown[]) => createInviteMock(...a),
  inviteAction: (...a: unknown[]) => inviteActionMock(...a),
}))

import { NextResponse } from 'next/server'
import { POST as ADD_PROVIDER } from '../providers/route'
import { POST as INVITE_STAFF } from '../invites/route'
import { POST as INVITE_ACTION } from '../invites/[inviteId]/route'
import { POST as MEMBER_ACTION } from '../members/[userId]/route'

function signedIn(role: string, clinicId: string | null = CLINIC, id = ADMIN) {
  getUserMock.mockResolvedValue({ data: { user: { id, app_metadata: { app_role: role, ...(clinicId ? { clinic_id: clinicId } : {}) } } }, error: null })
}
const req = (url: string, body: unknown, headers: Record<string, string> = {}) => new Request(`https://app.test${url}`, {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
}) as unknown as import('next/server').NextRequest
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) })

const PROVIDER = {
  firstName: 'Priya', lastName: 'Shah', email: 'Priya@Sunrise.test', npiNumber: '1234567893',
  licenses: [{ state: 'TX', licenseNumber: 'TX-12345', expiresOn: '2030-01-31' }, { state: 'CA', licenseNumber: 'A98765', expiresOn: '2031-06-30' }],
}
const STAFF = { name: 'Mia Assistant', email: 'mia@sunrise.test', role: 'medical_assistant' }

const calls: Array<() => Promise<Response>> = [
  () => ADD_PROVIDER(req('/api/team/providers', PROVIDER)),
  () => INVITE_STAFF(req('/api/team/invites', STAFF)),
  () => INVITE_ACTION(req(`/api/team/invites/${INVITE}`, { action: 'resend' }), params({ inviteId: INVITE })),
  () => MEMBER_ACTION(req(`/api/team/members/${MEMBER}`, { action: 'deactivate' }), params({ userId: MEMBER })),
]
const callsCrossSite: Array<() => Promise<Response>> = [
  () => ADD_PROVIDER(req('/api/team/providers', PROVIDER, { 'sec-fetch-site': 'cross-site' })),
  () => INVITE_STAFF(req('/api/team/invites', STAFF, { 'sec-fetch-site': 'cross-site' })),
  () => INVITE_ACTION(req(`/api/team/invites/${INVITE}`, { action: 'resend' }, { 'sec-fetch-site': 'cross-site' }), params({ inviteId: INVITE })),
  () => MEMBER_ACTION(req(`/api/team/members/${MEMBER}`, { action: 'deactivate' }, { 'sec-fetch-site': 'cross-site' }), params({ userId: MEMBER })),
]
const nothingWritten = () => {
  expect(addProviderMock).not.toHaveBeenCalled()
  expect(createInviteMock).not.toHaveBeenCalled()
  expect(inviteActionMock).not.toHaveBeenCalled()
  // Reads (and the read-only team list) are fine; nothing else.
  expect(db.calls.filter(c => c.op !== 'select' && c.table !== 'clinic_team_members')).toEqual([])
}

beforeEach(() => {
  getUserMock.mockReset()
  getSessionMock.mockReset()
  approvalMock.mockReset().mockResolvedValue(null)
  addProviderMock.mockReset().mockResolvedValue({ ok: true, provider: { provider_id: 'p-new', first_name: 'Priya', last_name: 'Shah', npi_number: '1234567893' }, npiStatus: 'verified' })
  createInviteMock.mockReset().mockResolvedValue({ ok: true, inviteId: INVITE, link: 'https://app.test/onboard/join/TOKEN', expiresAt: '2026-10-25T00:00:00Z' })
  inviteActionMock.mockReset().mockResolvedValue(NextResponse.json({ ok: true, status: 'pending', link: 'https://app.test/onboard/join/NEW' }))
  db = scriptedDb(c => script(c))
  script = c => {
    if (c.table === 'clinic_team_members') return { data: [] }
    if (c.table === 'onboarding_invites' && c.op === 'select') {
      return c.single ? { data: { invite_id: INVITE, kind: 'medical_assistant', clinic_id: CLINIC, email: 'mia@sunrise.test', accepted_at: null, revoked_at: null, expires_at: '2999-01-01T00:00:00Z', sent_count: 1 } } : { data: [] }
    }
    if (c.table === 'set_clinic_member_active') return { data: { status: 'deactivated' } }
    return undefined
  }
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'info').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe('who may (every route)', () => {
  it.each(calls.map((c, i) => [i, c] as const))('route %i: no session is 401', async (_i, call) => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
    expect((await call()).status).toBe(401)
    nothingWritten()
  })

  it.each(['medical_assistant', 'provider', 'ops_admin'].flatMap(role => calls.map((c, i) => [role, i, c] as const)))('%s on route %i: 403, nothing written', async (role, _i, call) => {
    signedIn(role)
    expect((await call()).status).toBe(403)
    nothingWritten()
  })

  it.each(callsCrossSite.map((c, i) => [i, c] as const))('route %i: cross-site is 403', async (_i, call) => {
    signedIn('clinic_admin')
    expect((await call()).status).toBe(403)
    nothingWritten()
  })

  it.each(calls.map((c, i) => [i, c] as const))('route %i: a clinic still in review gets the approval guard’s refusal', async (_i, call) => {
    signedIn('clinic_admin')
    approvalMock.mockResolvedValue(NextResponse.json({ error: 'pending', code: 'PENDING_REVIEW' }, { status: 403 }))
    const res = await call()
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('PENDING_REVIEW')
    expect(approvalMock).toHaveBeenCalledWith(db.client, CLINIC)
    nothingWritten()
  })

  it.each(calls.map((c, i) => [i, c] as const))('route %i: getUser, never getSession', async (_i, call) => {
    signedIn('clinic_admin')
    await call()
    expect(getUserMock).toHaveBeenCalled()
    expect(getSessionMock).not.toHaveBeenCalled()
  })
})

describe('add a provider', () => {
  beforeEach(() => signedIn('clinic_admin'))

  it('the wizard’s path: addProviderRecord with every license, then a provider invite; the link to copy', async () => {
    const res = await ADD_PROVIDER(req('/api/team/providers', { ...PROVIDER, clinicId: OTHER }))
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ providerId: 'p-new', npiStatus: 'verified', inviteId: INVITE, link: 'https://app.test/onboard/join/TOKEN', expiresAt: '2026-10-25T00:00:00Z' })
    expect(addProviderMock).toHaveBeenCalledWith(db.client, {
      clinicId: CLINIC, userId: null, firstName: 'Priya', lastName: 'Shah', npiNumber: '1234567893',
      licenses: PROVIDER.licenses, deaNumber: null, actorId: ADMIN,
    })
    expect(createInviteMock).toHaveBeenCalledWith(db.client, { kind: 'provider', clinicId: CLINIC, email: 'priya@sunrise.test', providerId: 'p-new', createdBy: ADMIN, actorRole: 'clinic_admin' })
  })

  it.each([
    [{ ...PROVIDER, firstName: '' }, 'firstName'],
    [{ ...PROVIDER, email: 'not-an-email' }, 'email'],
    [{ ...PROVIDER, npiNumber: '1234567890' }, 'npiNumber'],
    [{ ...PROVIDER, licenses: [] }, 'licenses'],
    [{ ...PROVIDER, licenses: [{ state: 'ZZ', licenseNumber: 'X1', expiresOn: '2030-01-01' }] }, 'licenses.0.state'],
    [{ ...PROVIDER, licenses: [{ state: 'TX', licenseNumber: 'X1', expiresOn: '2001-01-01' }] }, 'licenses.0.expiresOn'],
    [{ ...PROVIDER, licenses: [PROVIDER.licenses[0], PROVIDER.licenses[0]] }, 'licenses.1.state'],
  ])('%#: 400 on %s, nothing written', async (body, field) => {
    const res = await ADD_PROVIDER(req('/api/team/providers', body))
    expect(res.status).toBe(400)
    expect(Object.keys((await res.json()).errors)).toContain(field)
    nothingWritten()
  })

  it('an NPI already registered: the helper’s 409, passed on, no invite', async () => {
    addProviderMock.mockResolvedValue({ ok: false, status: 409, error: 'This NPI is already registered to a provider.', errors: { npiNumber: 'This NPI is already registered.' } })
    const res = await ADD_PROVIDER(req('/api/team/providers', PROVIDER))
    expect(res.status).toBe(409)
    expect((await res.json()).errors).toEqual({ npiNumber: 'This NPI is already registered.' })
    expect(createInviteMock).not.toHaveBeenCalled()
  })

  it('someone on the team already has this email: 409, nothing written', async () => {
    script = c => (c.table === 'clinic_team_members' ? { data: [{ user_id: MEMBER, email: 'priya@sunrise.test', role: 'medical_assistant' }] } : undefined)
    const res = await ADD_PROVIDER(req('/api/team/providers', PROVIDER))
    expect(res.status).toBe(409)
    nothingWritten()
  })
})

describe('invite a medical assistant or clinic admin', () => {
  beforeEach(() => signedIn('clinic_admin'))

  it.each(['medical_assistant', 'clinic_admin'])('%s: an invite with the name, in the caller’s clinic; the link to copy', async role => {
    const res = await INVITE_STAFF(req('/api/team/invites', { ...STAFF, role, clinicId: OTHER }))
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ inviteId: INVITE, link: 'https://app.test/onboard/join/TOKEN', expiresAt: '2026-10-25T00:00:00Z' })
    expect(createInviteMock).toHaveBeenCalledWith(db.client, { kind: role, clinicId: CLINIC, email: 'mia@sunrise.test', inviteeName: 'Mia Assistant', createdBy: ADMIN, actorRole: 'clinic_admin' })
  })

  it.each([
    [{ ...STAFF, role: 'provider' }, 'role'],
    [{ ...STAFF, role: 'ops_admin' }, 'role'],
    [{ ...STAFF, name: '' }, 'name'],
    [{ ...STAFF, email: 'x' }, 'email'],
  ])('%#: 400 on %s', async (body, field) => {
    const res = await INVITE_STAFF(req('/api/team/invites', body))
    expect(res.status).toBe(400)
    expect(Object.keys((await res.json()).errors)).toContain(field)
    nothingWritten()
  })

  it('a pending invite for this email already: 409', async () => {
    script = c => (c.table === 'onboarding_invites' && c.op === 'select' ? { data: [{ invite_id: INVITE, expires_at: '2999-01-01T00:00:00Z' }] } : c.table === 'clinic_team_members' ? { data: [] } : undefined)
    expect((await INVITE_STAFF(req('/api/team/invites', STAFF))).status).toBe(409)
    expect(createInviteMock).not.toHaveBeenCalled()
  })
})

describe('resend or revoke a pending invite', () => {
  beforeEach(() => signedIn('clinic_admin'))

  it('reads the invite in the caller’s clinic only, then uses the #215 action', async () => {
    const res = await INVITE_ACTION(req(`/api/team/invites/${INVITE}`, { action: 'revoke' }), params({ inviteId: INVITE }))
    expect(res.status).toBe(200)
    const read = db.to('onboarding_invites', 'select')[0]
    expect(read?.filters).toMatchObject({ invite_id: INVITE, clinic_id: CLINIC })
    expect(inviteActionMock).toHaveBeenCalledWith(db.client, expect.objectContaining({ invite_id: INVITE }), 'revoke', { userId: ADMIN, role: 'clinic_admin' })
  })

  it('another clinic’s (or no) invite: 404', async () => {
    script = () => ({ data: null })
    expect((await INVITE_ACTION(req(`/api/team/invites/${INVITE}`, { action: 'resend' }), params({ inviteId: INVITE }))).status).toBe(404)
    expect(inviteActionMock).not.toHaveBeenCalled()
  })

  it('a malformed id: 400', async () => {
    expect((await INVITE_ACTION(req('/api/team/invites/x', { action: 'resend' }), params({ inviteId: 'x' }))).status).toBe(400)
  })
})

describe('deactivate or reactivate a team member', () => {
  beforeEach(() => signedIn('clinic_admin'))

  it.each([['deactivate', false, 'deactivated'], ['reactivate', true, 'reactivated']] as const)('%s: one call to set_clinic_member_active in the caller’s clinic', async (action, active, status) => {
    script = c => (c.table === 'set_clinic_member_active' ? { data: { status } } : undefined)
    const res = await MEMBER_ACTION(req(`/api/team/members/${MEMBER}`, { action, clinicId: OTHER }), params({ userId: MEMBER }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status })
    expect(db.to('set_clinic_member_active', 'rpc')[0]?.payload).toEqual({ p_clinic_id: CLINIC, p_user_id: MEMBER, p_active: active, p_actor: ADMIN })
  })

  it('the last active admin: 409 with the reason', async () => {
    script = c => (c.table === 'set_clinic_member_active' ? { data: { status: 'last_admin' } } : undefined)
    const res = await MEMBER_ACTION(req(`/api/team/members/${MEMBER}`, { action: 'deactivate' }), params({ userId: MEMBER }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('A clinic needs at least one active clinic admin. Invite or reactivate another admin first.')
  })

  it('not in this clinic: 404', async () => {
    script = c => (c.table === 'set_clinic_member_active' ? { data: { status: 'not_found' } } : undefined)
    expect((await MEMBER_ACTION(req(`/api/team/members/${MEMBER}`, { action: 'deactivate' }), params({ userId: MEMBER }))).status).toBe(404)
  })

  it('your own login: 400, nothing called', async () => {
    const res = await MEMBER_ACTION(req(`/api/team/members/${ADMIN}`, { action: 'deactivate' }), params({ userId: ADMIN }))
    expect(res.status).toBe(400)
    expect(db.to('set_clinic_member_active')).toHaveLength(0)
  })

  it('a database error: 500', async () => {
    script = c => (c.table === 'set_clinic_member_active' ? DB_DOWN : undefined)
    expect((await MEMBER_ACTION(req(`/api/team/members/${MEMBER}`, { action: 'deactivate' }), params({ userId: MEMBER }))).status).toBe(500)
  })

  it.each([{}, { action: 'delete' }])('an unknown action %j: 400', async body => {
    expect((await MEMBER_ACTION(req(`/api/team/members/${MEMBER}`, body), params({ userId: MEMBER }))).status).toBe(400)
    expect(db.to('set_clinic_member_active')).toHaveLength(0)
  })
})

it('no em dash in any message', async () => {
  signedIn('clinic_admin')
  script = c => (c.table === 'set_clinic_member_active' ? { data: { status: 'last_admin' } } : undefined)
  const bodies = [
    await (await MEMBER_ACTION(req(`/api/team/members/${MEMBER}`, { action: 'deactivate' }), params({ userId: MEMBER }))).text(),
    await (await MEMBER_ACTION(req(`/api/team/members/${ADMIN}`, { action: 'deactivate' }), params({ userId: ADMIN }))).text(),
    await (await ADD_PROVIDER(req('/api/team/providers', { ...PROVIDER, firstName: '' }))).text(),
    await (await INVITE_STAFF(req('/api/team/invites', { ...STAFF, role: 'x' }))).text(),
  ]
  for (const b of bodies) expect(b).not.toContain('—')
})
