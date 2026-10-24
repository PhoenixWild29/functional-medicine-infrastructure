/**
 * @jest-environment node
 *
 * GET  /api/coaching/checklist  the signed-in user's setup checklist
 * POST /api/coaching/prefs      hide or show the checklist, mark the
 *                                first-prescription tips seen
 *
 * getUser(), never getSession(). The checklist is read with the service
 * role scoped by the caller's own claims (app_metadata). Preferences are
 * written to the caller's own user_metadata.coaching with the admin API,
 * merged with what is there; never a role, clinic or pharmacy key. When
 * every step is done, checklist_done is stored and the checklist is gone
 * for good.
 */

import { NextRequest } from 'next/server'
import { scriptedDb, type ScriptedCall } from '@/__tests__/helpers/scripted-db'

let user: Record<string, unknown> | null = null
const updateUserById = jest.fn().mockResolvedValue({ data: {}, error: null })
let db = scriptedDb(() => undefined)

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser: async () => ({ data: { user }, error: null }) } }),
}))
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => Object.assign(db.client as object, { auth: { admin: { updateUserById: (...a: unknown[]) => updateUserById(...a) } } }),
}))

import { GET } from '../checklist/route'
import { POST } from '../prefs/route'

const admin = (meta: Record<string, unknown> = {}) => ({ id: 'u-1', app_metadata: { app_role: 'clinic_admin', clinic_id: 'c-1' }, user_metadata: { full_name: 'Lauren', ...meta } })
const facts = (done: boolean) => scriptedDb((c: ScriptedCall) => {
  if (c.table === 'clinics') return { data: { onboarding_status: 'approved', legal_name: 'Sunrise' } }
  if (c.table === 'agreement_acceptances') return { data: [] }
  return { count: done ? 1 : 0 }
})
const post = (body: unknown) => new NextRequest('http://localhost/api/coaching/prefs', { method: 'POST', body: JSON.stringify(body) })

beforeEach(() => { updateUserById.mockClear(); db = facts(false) })

describe('GET /api/coaching/checklist', () => {
  it('signed out: 401', async () => {
    user = null
    expect((await GET()).status).toBe(401)
  })

  it('the clinic admin gets their steps, uncached', async () => {
    user = admin()
    const res = await GET()
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    const body = await res.json()
    expect(body).toEqual(expect.objectContaining({ show: true, hidden: false, notice: null }))
    expect(body.steps).toHaveLength(5)
  })

  it('hidden: show false, the steps still known so the link can bring it back', async () => {
    user = admin({ coaching: { checklist_hidden: true } })
    const body = await (await GET()).json()
    expect(body).toEqual(expect.objectContaining({ show: false, hidden: true }))
  })

  it('done for good: nothing is read', async () => {
    user = admin({ coaching: { checklist_done: true } })
    db = scriptedDb(() => { throw new Error('must not read') })
    expect(await (await GET()).json()).toEqual({ show: false, hidden: false, done: true })
  })

  it('every step done: stored as done, and not shown', async () => {
    user = admin()
    db = facts(true)
    // Agreements need both current versions on record to count as done.
    const { AGREEMENTS } = await import('@/lib/onboarding/agreement-texts')
    db = scriptedDb((c: ScriptedCall) => {
      if (c.table === 'clinics') return { data: { onboarding_status: 'approved', legal_name: 'Sunrise' } }
      if (c.table === 'clinic_onboarding_steps') return { data: { status: 'complete' } }
      if (c.table === 'agreement_acceptances') {
        return { data: (['baa', 'terms'] as const).map(k => ({ acceptance_id: k, agreement: k, template_version: AGREEMENTS[k].version, text_sha256: 'x', signer_name: 'L', signer_title: 'O', accepted_at: '2026-10-01T00:00:00Z' })) }
      }
      if (c.table === 'clinic_team_members') return { data: [{ user_id: 'u-1', email: 'a@c.test', full_name: null, role: 'clinic_admin', deactivated_at: null, last_sign_in_at: null }, { user_id: 'u-2', email: 'p@c.test', full_name: null, role: 'provider', deactivated_at: null, last_sign_in_at: null }] }
      if (c.table === 'onboarding_invites') return { data: [] }
      return { count: 1 }
    })
    const body = await (await GET()).json()
    expect(body).toEqual({ show: false, hidden: false, done: true })
    expect(updateUserById).toHaveBeenCalledWith('u-1', { user_metadata: { full_name: 'Lauren', coaching: { checklist_hidden: false, checklist_done: true, rx_tips_seen: false } } })
  })

  it('a role with no checklist (ops): show false', async () => {
    user = { id: 'o', app_metadata: { app_role: 'ops_admin' }, user_metadata: {} }
    expect(await (await GET()).json()).toEqual(expect.objectContaining({ show: false }))
  })

  it('a read that fails: 503, nothing shown wrongly', async () => {
    user = admin()
    db = scriptedDb(c => (c.table === 'patients' ? { error: { message: 'down' } } : c.table === 'clinics' ? { data: { onboarding_status: 'approved', legal_name: null } } : { data: [], count: 0 }))
    jest.spyOn(console, 'error').mockImplementation(() => {})
    expect((await GET()).status).toBe(503)
  })
})

describe('POST /api/coaching/prefs', () => {
  it('signed out: 401', async () => {
    user = null
    expect((await POST(post({ checklistHidden: true }))).status).toBe(401)
  })

  it('hides the checklist in the caller\'s own user_metadata, merged', async () => {
    user = admin({ coaching: { rx_tips_seen: true } })
    const res = await POST(post({ checklistHidden: true }))
    expect(res.status).toBe(200)
    expect(updateUserById).toHaveBeenCalledWith('u-1', { user_metadata: { full_name: 'Lauren', coaching: { checklist_hidden: true, checklist_done: false, rx_tips_seen: true } } })
  })

  it('marks the tips seen', async () => {
    user = admin()
    await POST(post({ rxTipsSeen: true }))
    expect(updateUserById.mock.calls[0]![1]).toEqual({ user_metadata: expect.objectContaining({ coaching: expect.objectContaining({ rx_tips_seen: true }) }) })
  })

  it('anything else is 400 and nothing is written', async () => {
    user = admin()
    for (const body of [{}, { checklistHidden: 'yes' }, { rxTipsSeen: false }, { app_role: 'ops_admin' }]) {
      expect((await POST(post(body))).status).toBe(400)
    }
    expect(updateUserById).not.toHaveBeenCalled()
  })
})
