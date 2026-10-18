/**
 * @jest-environment node
 *
 * Team invites: the name the clinic admin types for a medical assistant or
 * clinic admin invite is kept on the invite (onboarding_invites.
 * invitee_name), returned for the accept page, and fills its name field.
 * A provider invite keeps naming its provider row.
 */

import { scriptedDb, type ScriptedCall } from '@/__tests__/helpers/scripted-db'

let db = scriptedDb(() => undefined)
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.spyOn(console, 'error').mockImplementation(() => {})

import { createInvite } from '../invite-actions'
import { lookupInviteForPage } from '../invite-lookup'

const CLINIC = '11111111-1111-4111-8111-111111111111'

beforeEach(() => {
  process.env['APP_BASE_URL'] = 'https://app.test'
  db = scriptedDb((c: ScriptedCall) => (c.table === 'onboarding_invites' && c.op === 'insert' ? { data: { invite_id: 'inv-1' } } : undefined))
})

describe('createInvite', () => {
  it('stores the invitee’s name, trimmed', async () => {
    const r = await createInvite(db.client, { kind: 'medical_assistant', clinicId: CLINIC, email: 'mia@sunrise.test', inviteeName: '  Mia Assistant ', createdBy: 'u-admin', actorRole: 'clinic_admin' })
    expect(r.ok).toBe(true)
    expect(db.to('onboarding_invites', 'insert')[0]?.payload).toMatchObject({ kind: 'medical_assistant', email: 'mia@sunrise.test', invitee_name: 'Mia Assistant' })
  })

  it('no name (a provider invite, or the wizard): null', async () => {
    await createInvite(db.client, { kind: 'provider', clinicId: CLINIC, email: 'doc@sunrise.test', providerId: 'p-1', createdBy: 'u-admin', actorRole: 'clinic_admin' })
    expect(db.to('onboarding_invites', 'insert')[0]?.payload).toMatchObject({ invitee_name: null })
  })
})

describe('lookupInviteForPage', () => {
  it('returns the invitee’s name for the accept form', async () => {
    db = scriptedDb(() => ({ data: { kind: 'medical_assistant', email: 'mia@sunrise.test', invitee_name: 'Mia Assistant', accepted_at: null, revoked_at: null, expires_at: '2999-01-01T00:00:00Z', clinics: { name: 'Sunrise' } } }))
    const invite = await lookupInviteForPage('tok_abcdefghijklmnopqrstuvwxyz0123456789ABCDEF', false)
    expect(invite).toMatchObject({ kind: 'medical_assistant', status: 'pending', inviteeName: 'Mia Assistant' })
  })

  it('no name on the invite: empty', async () => {
    db = scriptedDb(() => ({ data: { kind: 'provider', email: 'doc@sunrise.test', invitee_name: null, accepted_at: null, revoked_at: null, expires_at: '2999-01-01T00:00:00Z', clinics: { name: 'Sunrise' } } }))
    expect((await lookupInviteForPage('tok_abcdefghijklmnopqrstuvwxyz0123456789ABCDEF', false)).inviteeName).toBe('')
  })
})
