/**
 * @jest-environment node
 *
 * Ops clinic onboarding (ops_admin only, verified with getUser()):
 *   - create a clinic invite: an inactive clinic in onboarding, a single-
 *     use invite whose token is stored only as a SHA-256 hash, expiring in
 *     7 days; the link carries the token; the action is audit-logged
 *   - revoke and resend (resend issues a new token: the old link dies)
 *   - approve (activates the clinic) or send back with a note, only for a
 *     submitted clinic; both audit-logged
 */

import { createHash } from 'node:crypto'
import { NextRequest } from 'next/server'
import { scriptedDb, type Script } from '@/__tests__/helpers/scripted-db'

const CLINIC = '11111111-1111-4111-8111-111111111111'
const INVITE = '22222222-2222-4222-8222-222222222222'
const OPS_USER = { id: 'ops-1', email: 'ops@compoundiq.test', app_metadata: { app_role: 'ops_admin' } }

let user: unknown = OPS_USER
let db = scriptedDb(() => undefined)

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser: async () => ({ data: { user }, error: user ? null : { message: 'no' } }) } }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.mock('@/lib/env', () => ({ serverEnv: { appBaseUrl: () => 'https://app.test' } }))
jest.spyOn(console, 'error').mockImplementation(() => {})
jest.spyOn(console, 'info').mockImplementation(() => {})

import { POST as createInvite, GET as listOnboarding } from '../route'
import { POST as inviteAction } from '../invites/[inviteId]/route'
import { POST as clinicReview } from '../clinics/[clinicId]/route'

const json = (body: unknown) => new NextRequest('http://localhost/api/ops/onboarding', { method: 'POST', body: JSON.stringify(body) })
const ctx = <K extends string>(k: K, v: string) => ({ params: Promise.resolve({ [k]: v } as Record<K, string>) })
const sha = (t: string) => createHash('sha256').update(t).digest('hex')

function happy(extra?: Script): Script {
  return call => {
    const answered = extra?.(call)
    if (answered) return answered
    if (call.table === 'clinics' && call.op === 'insert') return { data: { clinic_id: CLINIC } }
    if (call.table === 'onboarding_invites' && call.op === 'insert') return { data: { invite_id: INVITE } }
    return undefined
  }
}

beforeEach(() => {
  user = OPS_USER
  db = scriptedDb(happy())
})

describe('who may manage onboarding', () => {
  it('an unverified caller is 401', async () => {
    user = null
    expect((await createInvite(json({ clinicName: 'A', adminEmail: 'a@b.test' }))).status).toBe(401)
    expect((await listOnboarding()).status).toBe(401)
  })

  it.each(['clinic_admin', 'provider', 'medical_assistant'])('%s is 403 and nothing is written', async role => {
    user = { id: 'u', app_metadata: { app_role: role, clinic_id: CLINIC } }
    const res = await createInvite(json({ clinicName: 'A', adminEmail: 'a@b.test' }))
    expect(res.status).toBe(403)
    expect(db.calls.filter(c => c.op !== 'select')).toEqual([])
  })
})

describe('POST /api/ops/onboarding: create a clinic invite', () => {
  it('validates the clinic name and admin email', async () => {
    const res = await createInvite(json({ clinicName: ' ', adminEmail: 'not-an-email' }))
    expect(res.status).toBe(400)
    expect(db.calls.filter(c => c.op !== 'select')).toEqual([])
  })

  it('creates an inactive clinic in onboarding and a hashed, expiring, single-use invite', async () => {
    const before = Date.now()
    const res = await createInvite(json({ clinicName: '  Blue Cedar Wellness ', adminEmail: ' Owner@BlueCedar.TEST ' }))
    expect(res.status).toBe(201)
    const body = await res.json() as { link: string; inviteId: string; clinicId: string; expiresAt: string }

    const m = /^https:\/\/app\.test\/onboard\/clinic\/([A-Za-z0-9_-]{40,})$/.exec(body.link)
    expect(m).not.toBeNull()
    const token = m![1]!

    const [clinic] = db.to('clinics', 'insert')
    expect(clinic!.payload).toEqual(expect.objectContaining({ name: 'Blue Cedar Wellness', is_active: false, onboarding_status: 'invited' }))

    const [invite] = db.to('onboarding_invites', 'insert')
    const row = invite!.payload as Record<string, unknown>
    expect(row).toEqual(expect.objectContaining({
      kind: 'clinic_admin', clinic_id: CLINIC, email: 'owner@bluecedar.test', token_hash: sha(token), created_by: 'ops-1',
    }))
    expect(JSON.stringify(row)).not.toContain(token)
    const expires = new Date(row['expires_at'] as string).getTime()
    expect(expires - before).toBeGreaterThanOrEqual(7 * 86400_000 - 5000)
    expect(expires - before).toBeLessThanOrEqual(7 * 86400_000 + 5000)

    const [event] = db.to('clinic_onboarding_events', 'insert')
    expect(event!.payload).toEqual(expect.objectContaining({ clinic_id: CLINIC, event: 'invite_created', actor_user_id: 'ops-1', invite_id: INVITE }))
  })

  it('a failed invite insert removes the clinic it created and answers 500', async () => {
    db = scriptedDb(happy(call => (call.table === 'onboarding_invites' && call.op === 'insert' ? { error: { message: 'down' } } : undefined)))
    const res = await createInvite(json({ clinicName: 'Blue Cedar', adminEmail: 'o@b.test' }))
    expect(res.status).toBe(500)
    expect(db.to('clinics', 'delete')).toHaveLength(1)
  })
})

describe('POST /api/ops/onboarding/invites/[inviteId]', () => {
  const pending = { invite_id: INVITE, kind: 'clinic_admin', clinic_id: CLINIC, email: 'o@b.test', accepted_at: null, revoked_at: null, expires_at: '2999-01-01T00:00:00Z', sent_count: 1 }

  it('revoke marks the invite revoked and logs it', async () => {
    db = scriptedDb(call => (call.table === 'onboarding_invites' && call.single ? { data: pending } : undefined))
    const res = await inviteAction(json({ action: 'revoke' }), ctx('inviteId', INVITE))
    expect(res.status).toBe(200)
    const [upd] = db.to('onboarding_invites', 'update')
    expect(upd!.payload).toEqual(expect.objectContaining({ revoked_by: 'ops-1' }))
    expect((upd!.payload as Record<string, unknown>)['revoked_at']).toBeTruthy()
    expect(db.to('clinic_onboarding_events', 'insert')[0]!.payload).toEqual(expect.objectContaining({ event: 'invite_revoked', invite_id: INVITE }))
  })

  it('resend issues a new token and expiry (the old link no longer works)', async () => {
    db = scriptedDb(call => (call.table === 'onboarding_invites' && call.single ? { data: pending } : undefined))
    const res = await inviteAction(json({ action: 'resend' }), ctx('inviteId', INVITE))
    expect(res.status).toBe(200)
    const { link } = await res.json() as { link: string }
    const token = link.split('/').pop()!
    const [upd] = db.to('onboarding_invites', 'update')
    expect(upd!.payload).toEqual(expect.objectContaining({ token_hash: sha(token), sent_count: 2 }))
    expect(db.to('clinic_onboarding_events', 'insert')[0]!.payload).toEqual(expect.objectContaining({ event: 'invite_resent' }))
  })

  it('an accepted invite cannot be revoked or resent', async () => {
    db = scriptedDb(call => (call.table === 'onboarding_invites' && call.single ? { data: { ...pending, accepted_at: '2026-10-01T00:00:00Z' } } : undefined))
    expect((await inviteAction(json({ action: 'resend' }), ctx('inviteId', INVITE))).status).toBe(409)
    expect(db.to('onboarding_invites', 'update')).toEqual([])
  })
})

describe('POST /api/ops/onboarding/clinics/[clinicId]: approve or send back', () => {
  const submitted = { clinic_id: CLINIC, name: 'Blue Cedar', onboarding_status: 'submitted' }

  it('approve activates the clinic and logs who approved', async () => {
    db = scriptedDb(call => (call.table === 'clinics' && call.single ? { data: submitted } : undefined))
    const res = await clinicReview(json({ action: 'approve' }), ctx('clinicId', CLINIC))
    expect(res.status).toBe(200)
    const [upd] = db.to('clinics', 'update')
    expect(upd!.payload).toEqual(expect.objectContaining({ is_active: true, onboarding_status: 'approved', onboarding_reviewed_by: 'ops-1' }))
    expect(db.to('clinic_onboarding_events', 'insert')[0]!.payload).toEqual(expect.objectContaining({ event: 'approved', actor_user_id: 'ops-1' }))
  })

  it('send back needs a note, keeps the clinic inactive and records the note', async () => {
    db = scriptedDb(call => (call.table === 'clinics' && call.single ? { data: submitted } : undefined))
    expect((await clinicReview(json({ action: 'send_back', note: ' ' }), ctx('clinicId', CLINIC))).status).toBe(400)
    const res = await clinicReview(json({ action: 'send_back', note: 'Please add the second provider license.' }), ctx('clinicId', CLINIC))
    expect(res.status).toBe(200)
    const [upd] = db.to('clinics', 'update')
    expect(upd!.payload).toEqual(expect.objectContaining({ onboarding_status: 'changes_requested', onboarding_review_note: 'Please add the second provider license.' }))
    expect((upd!.payload as Record<string, unknown>)['is_active']).toBeUndefined()
    expect(db.to('clinic_onboarding_events', 'insert')[0]!.payload).toEqual(expect.objectContaining({ event: 'sent_back', note: 'Please add the second provider license.' }))
  })

  it('a clinic that has not been submitted cannot be approved', async () => {
    db = scriptedDb(call => (call.table === 'clinics' && call.single ? { data: { ...submitted, onboarding_status: 'in_progress' } } : undefined))
    expect((await clinicReview(json({ action: 'approve' }), ctx('clinicId', CLINIC))).status).toBe(409)
    expect(db.to('clinics', 'update')).toEqual([])
  })
})
