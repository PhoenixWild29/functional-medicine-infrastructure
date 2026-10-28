/**
 * @jest-environment node
 *
 * Decision 11 follow-up: DELETE /api/favorites is a soft delete. The row
 * stays (deleted_at is set, migration 20261028000001) and every read of
 * provider_favorites ignores deleted rows: the list, the merge lookup on
 * save, the edit and use-count lookup, and the delete lookup itself (a
 * second delete is a 404). The ownership check (owning provider or clinic
 * admin) is unchanged.
 */

import { NextRequest } from 'next/server'
import { scriptedDb, type ScriptedCall } from '@/__tests__/helpers/scripted-db'

const CLINIC = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const FAV = 'a5000000-0000-4000-8000-000000000001'
const OWNER = 'a2000000-0000-4000-8000-000000000001'
const FORMULATION = 'a6000000-0000-4000-8000-000000000001'

let user: Record<string, unknown> = {}
let db = scriptedDb(() => undefined)

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser: async () => ({ data: { user }, error: null }) } }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))

import { DELETE, GET, PATCH, POST } from '../route'

const as = (id: string, role: string) => ({ id, email: `${id}@x.test`, app_metadata: { app_role: role, clinic_id: CLINIC } })
const live = (c: ScriptedCall) => c.filters['deleted_at:is'] === null
const H = { 'sec-fetch-site': 'same-origin' }

/** A deleted favorite answers only a query that does not ignore deleted rows. */
let favDeleted = false

beforeEach(() => {
  favDeleted = false
  user = as('u-owner', 'provider')
  db = scriptedDb(c => {
    if (c.table === 'provider_favorites' && c.op === 'select') {
      if (favDeleted && live(c)) return { data: c.single ? null : [], error: c.single === 'one' ? { message: 'no rows', code: 'PGRST116' } : null }
      const row = { favorite_id: FAV, provider_id: OWNER, formulation_id: FORMULATION, pharmacy_id: null, patient_id: null, use_count: 1, dose_presets: [] }
      return { data: c.single ? row : [row] }
    }
    if (c.table === 'provider_favorites' && c.op === 'update') return { data: { favorite_id: FAV } }
    if (c.table === 'providers' && c.op === 'select') {
      if (c.filters['user_id'] !== undefined) return { data: { provider_id: OWNER } }
      return { data: [{ provider_id: OWNER }] }
    }
    return undefined
  })
})

const del = () => DELETE(new NextRequest(`http://localhost/api/favorites?id=${FAV}`, { method: 'DELETE', headers: H }))

describe('DELETE', () => {
  it('sets deleted_at on the row instead of deleting it', async () => {
    const res = await del()
    expect(res.status).toBe(200)
    expect(db.to('provider_favorites', 'delete')).toHaveLength(0)
    const updates = db.to('provider_favorites', 'update')
    expect(updates).toHaveLength(1)
    const payload = updates[0]!.payload as Record<string, unknown>
    expect(typeof payload['deleted_at']).toBe('string')
    expect(Number.isNaN(Date.parse(payload['deleted_at'] as string))).toBe(false)
    expect(updates[0]!.filters['favorite_id']).toBe(FAV)
    // Only a live row is marked: a concurrent second delete changes nothing.
    expect(live(updates[0]!)).toBe(true)
  })

  it('looks the favorite up among live rows only: an already deleted one is a 404', async () => {
    favDeleted = true
    const res = await del()
    expect(res.status).toBe(404)
    expect(db.to('provider_favorites', 'update')).toHaveLength(0)
  })

  it('keeps the ownership check: another provider is refused and nothing changes', async () => {
    user = as('u-other', 'provider')
    db = scriptedDb(c => {
      if (c.table === 'provider_favorites' && c.op === 'select') return { data: { provider_id: OWNER, patient_id: null } }
      if (c.table === 'providers' && c.op === 'select') {
        if (c.filters['user_id'] !== undefined) return { data: { provider_id: 'a2000000-0000-4000-8000-000000000002' } }
        return { data: [{ provider_id: OWNER }, { provider_id: 'a2000000-0000-4000-8000-000000000002' }] }
      }
      return undefined
    })
    expect((await del()).status).toBe(403)
    expect(db.to('provider_favorites', 'update')).toHaveLength(0)
    expect(db.to('provider_favorites', 'delete')).toHaveLength(0)
  })

  it('a clinic admin can still delete any favorite of the clinic', async () => {
    user = as('u-admin', 'clinic_admin')
    expect((await del()).status).toBe(200)
    expect(db.to('provider_favorites', 'update')).toHaveLength(1)
  })
})

describe('every read ignores deleted favorites', () => {
  it('GET lists live favorites only', async () => {
    await GET(new NextRequest('http://localhost/api/favorites'))
    const reads = db.to('provider_favorites', 'select')
    expect(reads.length).toBeGreaterThan(0)
    expect(reads.every(live)).toBe(true)
  })

  it('POST merges into a live card only', async () => {
    await POST(new NextRequest('http://localhost/api/favorites', {
      method: 'POST',
      headers: { ...H, 'content-type': 'application/json' },
      body: JSON.stringify({
        provider_id: OWNER, formulation_id: FORMULATION, label: 'Card',
        dose_presets: [{ dose: '10', unit: 'units', frequency: 'QW', timing: null, duration: null, label: '10 units weekly' }],
      }),
    }))
    const reads = db.to('provider_favorites', 'select')
    expect(reads.length).toBeGreaterThan(0)
    expect(reads.every(live)).toBe(true)
  })

  it('PATCH (use count) finds live favorites only: a deleted one is a 404', async () => {
    favDeleted = true
    const res = await PATCH(new NextRequest(`http://localhost/api/favorites?id=${FAV}`, { method: 'PATCH', headers: H }))
    expect(res.status).toBe(404)
    expect(db.to('provider_favorites', 'select').every(live)).toBe(true)
    expect(db.to('provider_favorites', 'update')).toHaveLength(0)
  })
})
