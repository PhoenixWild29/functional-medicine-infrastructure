/**
 * @jest-environment node
 *
 * Input validation: the ops onboarding routes.
 *
 *   - /api/ops/onboarding/pharmacies/<applicationId>[/...] and
 *     /api/ops/onboarding/pharmacy-invites/<inviteId>/{resend,revoke}: the
 *     id is an 8-4-4-4-12 hex id, checked before the library reads
 *     anything (a malformed id used to reach Postgres);
 *   - /licenses/<state>: the state is a US state or DC code (a closed set);
 *   - /api/ops/onboarding/invites/<inviteId>: the action (revoke or
 *     resend) is checked before the invite is read;
 *   - ops_admin only, before any of it.
 */

import { NextRequest } from 'next/server'
import { scriptedDb } from '@/__tests__/helpers/scripted-db'

const APP    = 'a5000000-0000-0000-0000-000000000001'
const INVITE = 'e5000000-0000-0000-0000-000000000001'

let user: Record<string, unknown> | null = null
let db = scriptedDb(() => undefined)

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser: async () => ({ data: { user }, error: user ? null : { message: 'no' } }) } }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.mock('@/lib/pharmacy-onboarding/invites', () => ({
  revokeInvite: jest.fn(async () => ({ ok: true, invite: {} })),
  resendInvite: jest.fn(async () => ({ ok: true, invite: {}, link: 'l' })),
}))
jest.mock('@/lib/pharmacy-onboarding/review', () => ({
  getApplicationReview: jest.fn(async () => ({ ok: true, review: {} })),
  decideLicense: jest.fn(async () => ({ ok: true })),
  approveApplication: jest.fn(async () => ({ ok: true })),
  sendBackApplication: jest.fn(async () => ({ ok: true })),
  markAdapterConfigured: jest.fn(async () => ({ ok: true })),
}))
jest.spyOn(console, 'error').mockImplementation(() => {})
jest.spyOn(console, 'info').mockImplementation(() => {})

type Mocked = Record<string, jest.Mock>
const invites = jest.requireMock('@/lib/pharmacy-onboarding/invites') as Mocked
const review = jest.requireMock('@/lib/pharmacy-onboarding/review') as Mocked

import * as opsApp from '../pharmacies/[applicationId]/route'
import * as decide from '../pharmacies/[applicationId]/licenses/[state]/route'
import * as approve from '../pharmacies/[applicationId]/approve/route'
import * as sendBack from '../pharmacies/[applicationId]/send-back/route'
import * as adapter from '../pharmacies/[applicationId]/adapter/route'
import * as revoke from '../pharmacy-invites/[inviteId]/revoke/route'
import * as resend from '../pharmacy-invites/[inviteId]/resend/route'
import { POST as clinicInviteAction } from '../invites/[inviteId]/route'

const as = (role: string) => ({ id: `u-${role}`, email: `${role}@x.example`, app_metadata: { app_role: role } })
const req = (method: string, body?: unknown) => new NextRequest('https://app.test/api/ops/onboarding/x', { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) })
const libCalls = () => [...Object.values(invites), ...Object.values(review)].reduce((n, m) => n + m.mock.calls.length, 0)

beforeEach(() => {
  user = as('ops_admin')
  db = scriptedDb(() => undefined)
  for (const m of [...Object.values(invites), ...Object.values(review)]) m.mockClear()
})

describe('a malformed application or invite id is 400 and the library is never called', () => {
  const BAD = 'app-1'
  it.each([
    ['GET review',  () => opsApp.GET(req('GET'), params({ applicationId: BAD }))],
    ['license',     () => decide.POST(req('POST', { decision: 'verify' }), params({ applicationId: BAD, state: 'TX' }))],
    ['approve',     () => approve.POST(req('POST', {}), params({ applicationId: BAD }))],
    ['send back',   () => sendBack.POST(req('POST', { note: 'Fix CA' }), params({ applicationId: BAD }))],
    ['adapter',     () => adapter.POST(req('POST', { configured: true }), params({ applicationId: BAD }))],
    ['revoke',      () => revoke.POST(req('POST'), params({ inviteId: 'i-1' }))],
    ['resend',      () => resend.POST(req('POST'), params({ inviteId: 'i-1' }))],
  ])('%s', async (_name, call) => {
    expect((await call()).status).toBe(400)
    expect(libCalls()).toBe(0)
  })
})

describe('well-formed ids (seeded, not RFC v4) reach the library', () => {
  it.each([
    ['GET review', () => opsApp.GET(req('GET'), params({ applicationId: APP })), 'getApplicationReview'],
    ['approve',    () => approve.POST(req('POST', {}), params({ applicationId: APP })), 'approveApplication'],
    ['send back',  () => sendBack.POST(req('POST', { note: 'Fix CA' }), params({ applicationId: APP })), 'sendBackApplication'],
    ['adapter',    () => adapter.POST(req('POST', { configured: true }), params({ applicationId: APP })), 'markAdapterConfigured'],
    ['revoke',     () => revoke.POST(req('POST'), params({ inviteId: INVITE })), 'revokeInvite'],
    ['resend',     () => resend.POST(req('POST'), params({ inviteId: INVITE })), 'resendInvite'],
  ])('%s', async (_name, call, fn) => {
    expect((await call()).status).toBe(200)
    expect({ ...invites, ...review }[fn]).toHaveBeenCalledTimes(1)
  })
})

describe('license state: a closed set of US state codes', () => {
  it.each(['TX', 'dc', 'Ny'])('%s is accepted', async state => {
    expect((await decide.POST(req('POST', { decision: 'verify' }), params({ applicationId: APP, state }))).status).toBe(200)
    expect(review['decideLicense']).toHaveBeenCalledTimes(1)
  })
  it.each(['ZZ', 'XX', 'T', 'TEX', 'P1'])('%s is 400 and the library is never called', async state => {
    expect((await decide.POST(req('POST', { decision: 'verify' }), params({ applicationId: APP, state }))).status).toBe(400)
    expect(review['decideLicense']).not.toHaveBeenCalled()
  })
})

it('a non-ops role is 403 and the library is never called', async () => {
  user = as('pharmacy_admin')
  expect((await approve.POST(req('POST', {}), params({ applicationId: APP }))).status).toBe(403)
  expect((await revoke.POST(req('POST'), params({ inviteId: INVITE }))).status).toBe(403)
  expect(libCalls()).toBe(0)
})

describe('POST /api/ops/onboarding/invites/[inviteId] (clinic admin invite)', () => {
  it('an unknown action is 400 (same message) before the invite is read', async () => {
    const res = await clinicInviteAction(req('POST', { action: 'delete' }), params({ inviteId: INVITE }))
    expect(res.status).toBe(400)
    expect((await res.json() as { error: string }).error).toBe('action must be revoke or resend')
    expect(db.calls).toHaveLength(0)
  })
  it('a known action goes on to read the invite', async () => {
    const res = await clinicInviteAction(req('POST', { action: 'revoke' }), params({ inviteId: INVITE }))
    expect(res.status).toBe(404)  // the scripted read finds nothing
    expect(db.to('onboarding_invites', 'select')).toHaveLength(1)
  })
})
