/**
 * @jest-environment node
 *
 * Team invites: a clinic admin invited to an APPROVED clinic (from
 * Settings > Team) lands in the app, not in the onboarding wizard. An
 * admin invited to a clinic still in onboarding goes to the wizard, as
 * before. Staff land in the app. Accepting never touches the clinic's
 * signup_source (where the clinic came from).
 */

import { createHash } from 'node:crypto'
import { NextRequest } from 'next/server'
import { scriptedDb, type Script } from '@/__tests__/helpers/scripted-db'

const CLINIC   = '11111111-1111-4111-8111-111111111111'
const INVITE   = '22222222-2222-4222-8222-222222222222'
const TOKEN    = 'tok_abcdefghijklmnopqrstuvwxyz0123456789ABCDEF'
const HASH     = createHash('sha256').update(TOKEN).digest('hex')

let db = scriptedDb(() => undefined)
const createUser = jest.fn()
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => Object.assign(db.client as object, { auth: { admin: { createUser, deleteUser: jest.fn() } } }),
}))
jest.spyOn(console, 'error').mockImplementation(() => {})
jest.spyOn(console, 'info').mockImplementation(() => {})

import { POST } from '../invite/accept/route'
import { inviteAcceptLimiter } from '@/lib/onboarding/accept-rate-limit'

const req = () => new NextRequest('http://localhost/api/onboarding/invite/accept', {
  method: 'POST', body: JSON.stringify({ token: TOKEN, fullName: 'Ada Admin', password: 'Correct-Horse-9' }),
})

function script(kind: string, clinic: Record<string, unknown> | null): Script {
  return call => {
    if (call.table === 'onboarding_invites' && call.op === 'select') {
      expect(call.filters['token_hash']).toBe(HASH)
      return { data: { invite_id: INVITE, kind, clinic_id: CLINIC, email: 'ada@sunrise.test', provider_id: kind === 'provider' ? 'p-1' : null, accepted_at: null, revoked_at: null, expires_at: '2999-01-01T00:00:00Z' } }
    }
    if (call.table === 'onboarding_invites' && call.op === 'update') return { data: [{ invite_id: INVITE }] }
    if (call.table === 'providers' && call.op === 'update') return { data: [{ provider_id: 'p-1' }] }
    if (call.table === 'clinics' && call.op === 'select') return { data: clinic }
    return undefined
  }
}

beforeEach(() => {
  inviteAcceptLimiter.reset()
  createUser.mockReset().mockResolvedValue({ data: { user: { id: 'new-user' } }, error: null })
})

it('a clinic admin invited to an approved clinic lands in the app', async () => {
  db = scriptedDb(script('clinic_admin', { onboarding_status: 'approved', is_active: true }))
  const res = await POST(req())
  expect(res.status).toBe(201)
  expect((await res.json()).next).toBe('/')
})

it.each([
  [{ onboarding_status: 'in_progress', is_active: false }],
  [{ onboarding_status: 'invited', is_active: false }],
  [null],
])('a clinic admin invited to a clinic still in onboarding (%j) goes to the wizard', async clinic => {
  db = scriptedDb(script('clinic_admin', clinic))
  const res = await POST(req())
  expect((await res.json()).next).toBe('/onboarding')
})

it.each(['provider', 'medical_assistant'])('%s lands in the app', async kind => {
  db = scriptedDb(script(kind, { onboarding_status: 'approved', is_active: true }))
  expect((await (await POST(req())).json()).next).toBe('/')
})

it('never writes signup_source', async () => {
  db = scriptedDb(script('clinic_admin', { onboarding_status: 'approved', is_active: true }))
  await POST(req())
  for (const c of db.calls.filter(c => c.op === 'update' || c.op === 'insert' || c.op === 'upsert')) {
    expect(JSON.stringify(c.payload)).not.toContain('signup_source')
  }
  const attrs = createUser.mock.calls[0]![0] as { app_metadata: Record<string, unknown> }
  expect(attrs.app_metadata).toEqual({ app_role: 'clinic_admin', clinic_id: CLINIC })
})
