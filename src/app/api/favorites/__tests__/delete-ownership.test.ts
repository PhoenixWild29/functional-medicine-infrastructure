/**
 * @jest-environment node
 *
 * Decision 11, option B (docs/decisions/before-real-patients-2026-10-25.md):
 * a favorite is deleted only by the provider who owns it, or by a clinic
 * admin. Before, any clinic staff member could delete any provider's
 * favorite in the clinic, with no undo. provider_favorites has no
 * created_by, so the owner is the favorite's provider.
 */

import { NextRequest } from 'next/server'
import { scriptedDb } from '@/__tests__/helpers/scripted-db'

const CLINIC = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const FAV = 'a5000000-0000-4000-8000-000000000001'
const OWNER = 'a2000000-0000-4000-8000-000000000001'
const OTHER_PROVIDER = 'a2000000-0000-4000-8000-000000000002'

let user: Record<string, unknown> = {}
let db = scriptedDb(() => undefined)

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser: async () => ({ data: { user }, error: null }) } }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))

import { DELETE } from '../route'

const as = (id: string, role: string) => ({ id, email: `${id}@x.test`, app_metadata: { app_role: role, clinic_id: CLINIC } })
// The caller's own provider row, by user id: OWNER's login is 'u-owner'.
const PROVIDER_BY_USER: Record<string, string> = { 'u-owner': OWNER, 'u-other': OTHER_PROVIDER }

beforeEach(() => {
  db = scriptedDb(c => {
    if (c.table === 'provider_favorites' && c.op === 'select') return { data: { provider_id: OWNER, patient_id: null } }
    if (c.table === 'providers' && c.op === 'select') {
      const uid = c.filters['user_id'] as string | undefined
      if (uid !== undefined) return { data: PROVIDER_BY_USER[uid] ? { provider_id: PROVIDER_BY_USER[uid] } : null }
      return { data: [{ provider_id: OWNER }, { provider_id: OTHER_PROVIDER }] }
    }
    return undefined
  })
})

const del = () => DELETE(new NextRequest(`http://localhost/api/favorites?id=${FAV}`, { method: 'DELETE', headers: { 'sec-fetch-site': 'same-origin' } }))
const deleted = () => db.calls.some(c => c.table === 'provider_favorites' && c.op === 'delete')

it('the owning provider can delete it', async () => {
  user = as('u-owner', 'provider')
  expect((await del()).status).toBe(200)
  expect(deleted()).toBe(true)
})

it('a clinic admin can delete it', async () => {
  user = as('u-admin', 'clinic_admin')
  expect((await del()).status).toBe(200)
  expect(deleted()).toBe(true)
})

it("another provider of the clinic cannot, and nothing is deleted", async () => {
  user = as('u-other', 'provider')
  const res = await del()
  expect(res.status).toBe(403)
  expect(((await res.json()) as { error: string }).error).toBe('Only the provider who owns this favorite, or a clinic admin, can delete it.')
  expect(deleted()).toBe(false)
})

it('a medical assistant cannot (they own no favorites)', async () => {
  user = as('u-ma', 'medical_assistant')
  expect((await del()).status).toBe(403)
  expect(deleted()).toBe(false)
})
