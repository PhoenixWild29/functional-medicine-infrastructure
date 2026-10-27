/**
 * @jest-environment node
 *
 * POST /api/onboarding/invites/[inviteId] { action: 'revoke' | 'resend' }:
 * the clinic admin, on one of their own clinic's provider or staff
 * invites. Auth first (getUser(), role and clinic from app_metadata), then
 * the id and the action are checked, then the invite is read in the
 * caller's clinic only. Another clinic's invite is 404.
 */

import { NextRequest, NextResponse } from 'next/server'
import { scriptedDb, type ScriptedCall } from '@/__tests__/helpers/scripted-db'

const CLINIC = '11111111-1111-4111-8111-111111111111'
const OTHER  = '22222222-2222-4222-8222-222222222222'
const INVITE = 'c1000000-0000-4000-8000-000000000001'
const ADMIN  = { id: 'admin-1', app_metadata: { app_role: 'clinic_admin', clinic_id: CLINIC } }

let user: unknown = ADMIN
let db = scriptedDb(() => undefined)
const inviteActionMock = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser: async () => ({ data: { user }, error: null }) } }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.mock('@/lib/onboarding/invite-actions', () => ({
  ...jest.requireActual('@/lib/onboarding/invite-actions'),
  inviteAction: (...a: unknown[]) => inviteActionMock(...a),
}))
jest.spyOn(console, 'error').mockImplementation(() => {})
jest.spyOn(console, 'info').mockImplementation(() => {})

import { POST } from '../invites/[inviteId]/route'

const req = (body: string) => new NextRequest(`http://localhost/api/onboarding/invites/${INVITE}`, { method: 'POST', body })
const params = (inviteId: string) => ({ params: Promise.resolve({ inviteId }) })

function script(c: ScriptedCall) {
  if (c.table === 'clinics' && c.op === 'select') return { data: { clinic_id: CLINIC, name: 'Sunrise', onboarding_status: 'in_progress' } }
  if (c.table === 'onboarding_invites' && c.op === 'select') {
    return c.filters['clinic_id'] === CLINIC
      ? { data: { invite_id: INVITE, kind: 'provider', clinic_id: CLINIC, email: 'p@x.test', accepted_at: null, revoked_at: null, expires_at: '2999-01-01T00:00:00Z', sent_count: 1 } }
      : { data: null }
  }
  return undefined
}

beforeEach(() => {
  user = ADMIN
  db = scriptedDb(script)
  inviteActionMock.mockReset().mockResolvedValue(NextResponse.json({ ok: true, status: 'revoked' }))
})

const invitesRead = () => db.to('onboarding_invites', 'select')

it('the caller’s own invite: read in their clinic only, then the action', async () => {
  const res = await POST(req(JSON.stringify({ action: 'revoke' })), params(INVITE))
  expect(res.status).toBe(200)
  expect(invitesRead()[0]?.filters).toMatchObject({ invite_id: INVITE, clinic_id: CLINIC })
  expect(inviteActionMock).toHaveBeenCalledWith(db.client, expect.objectContaining({ invite_id: INVITE }), 'revoke', { userId: 'admin-1', role: 'clinic_admin' })
})

it('a bad uuid: 400, nothing read', async () => {
  expect((await POST(req(JSON.stringify({ action: 'revoke' })), params('not-a-uuid'))).status).toBe(400)
  expect(invitesRead()).toEqual([])
})

it('invalid JSON: 400, nothing read', async () => {
  const res = await POST(req('{nope'), params(INVITE))
  expect(res.status).toBe(400)
  expect((await res.json()).error).toBe('Invalid JSON body')
  expect(invitesRead()).toEqual([])
})

it('an unknown action: 400 before the invite is read', async () => {
  const res = await POST(req(JSON.stringify({ action: 'delete' })), params(INVITE))
  expect(res.status).toBe(400)
  expect((await res.json()).error).toBe('action must be revoke or resend')
  expect(invitesRead()).toEqual([])
  expect(inviteActionMock).not.toHaveBeenCalled()
})

it('a wrong role: 403, no invite read', async () => {
  user = { id: 'u', app_metadata: { app_role: 'medical_assistant', clinic_id: CLINIC } }
  expect((await POST(req(JSON.stringify({ action: 'revoke' })), params(INVITE))).status).toBe(403)
  expect(invitesRead()).toEqual([])
})

it('another clinic’s invite: 404, never touched (the read is scoped to the caller’s clinic)', async () => {
  user = { id: 'other-admin', app_metadata: { app_role: 'clinic_admin', clinic_id: OTHER } }
  db = scriptedDb(c => (c.table === 'clinics' && c.op === 'select'
    ? { data: { clinic_id: OTHER, name: 'Other', onboarding_status: 'in_progress' } }
    : script(c)))
  const res = await POST(req(JSON.stringify({ action: 'revoke' })), params(INVITE))
  expect(res.status).toBe(404)
  expect(invitesRead()[0]?.filters).toMatchObject({ clinic_id: OTHER })
  expect(inviteActionMock).not.toHaveBeenCalled()
  expect(db.calls.filter(c => c.op !== 'select')).toEqual([])
})
