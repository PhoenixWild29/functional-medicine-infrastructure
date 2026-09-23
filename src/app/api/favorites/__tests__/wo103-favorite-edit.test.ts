/**
 * @jest-environment node
 *
 * WO-103 / WO-104: PATCH /api/favorites?id=xxx edits a favorite in place.
 *
 *   - no body → the WO-85 use-count bump, unchanged
 *   - body with label / pharmacy / dose_presets / patient_id → those
 *     columns are updated (WO-104: the doses are structured presets,
 *     stored canonically; no sig is stored or regenerated)
 *   - malformed body → 400 before any DB access
 *   - clinic-scope guard: a favorite owned by another clinic's provider
 *     is 403, unknown id is 404; a patient outside the clinic is 403
 *   - re-pinning to a pharmacy that does not offer the formulation → 400
 *
 * Mocking pattern reused from src/app/api/orders/__tests__/wo96-rx-details.test.ts.
 */

import { PATCH } from '../route'
import { NextRequest } from 'next/server'
import { validateFavoriteEdit } from '@/lib/orders/favorite-edit'

const CLINIC_ID     = 'a1000000-0000-0000-0000-000000000001'
const PROVIDER_IN   = 'a2000000-0000-0000-0000-000000000001'
const PROVIDER_OUT  = 'a2000000-0000-0000-0000-000000000009'
const FAV_ID        = 'a5000000-0000-0000-0000-000000000001'
const FORMULATION   = 'a7000000-0000-0000-0000-000000000001'
const PHARMACY      = 'a4000000-0000-0000-0000-000000000004'

type ChainBuilder = Record<string, unknown>

let updates: Array<{ table: string; row: Record<string, unknown> }> = []
let tablesTouched: string[] = []
const fixtures: Record<string, () => unknown> = {}

const getSessionMock = jest.fn()
// WO-104: the route verifies the user with getUser(). The session-shaped
// fixtures below are unwrapped to the user they carry.
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockResolvedValue({
    auth: {
      getUser: async () => {
        const r = await getSessionMock() as { data: { session: { user: unknown } | null } }
        return { data: { user: r.data.session?.user ?? null } }
      },
    },
  }),
}))

function makeChain(table: string): ChainBuilder {
  tablesTouched.push(table)
  const builder: ChainBuilder = {}
  const passthrough = () => builder
  builder['select'] = passthrough
  builder['eq'] = passthrough
  builder['is'] = passthrough
  builder['in'] = passthrough
  builder['update'] = (row: Record<string, unknown>) => {
    updates.push({ table, row })
    return builder
  }
  builder['maybeSingle'] = () => {
    const f = fixtures[`${table}:maybeSingle`]
    return Promise.resolve(f ? f() : { data: null, error: null })
  }
  builder['single'] = () => {
    const f = fixtures[`${table}:single`]
    return Promise.resolve(f ? f() : { data: null, error: null })
  }
  builder['then'] = (resolve: (v: unknown) => unknown) => {
    const f = fixtures[`${table}:await`]
    return Promise.resolve(f ? f() : { data: null, error: null }).then(resolve)
  }
  return builder
}

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn().mockReturnValue({
    from: (table: string) => makeChain(table),
  }),
}))

function makeRequest(body?: unknown, id: string | null = FAV_ID): NextRequest {
  const url = id ? `http://localhost/api/favorites?id=${id}` : 'http://localhost/api/favorites'
  return new NextRequest(new URL(url), {
    method: 'PATCH',
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  })
}

beforeEach(() => {
  updates = []
  tablesTouched = []
  Object.keys(fixtures).forEach(k => delete fixtures[k])
  getSessionMock.mockResolvedValue({
    data: { session: { user: { id: 'auth-uid', user_metadata: { clinic_id: CLINIC_ID, app_role: 'provider' } } } },
  })
  fixtures['provider_favorites:single'] = () => ({
    data: { provider_id: PROVIDER_IN, formulation_id: FORMULATION, use_count: 2, favorite_id: FAV_ID },
    error: null,
  })
  fixtures['providers:await'] = () => ({ data: [{ provider_id: PROVIDER_IN }], error: null })
  fixtures['pharmacy_formulations:maybeSingle'] = () => ({ data: { pharmacy_formulation_id: 'pf-1', pharmacies: { is_active: true, deleted_at: null } }, error: null })
})

function favoriteUpdate(): Record<string, unknown> {
  const u = updates.find(x => x.table === 'provider_favorites')
  if (!u) throw new Error('provider_favorites update not recorded')
  return u.row
}

describe('PATCH /api/favorites — WO-103 edits', () => {
  it('without a body still bumps use_count (WO-85 load behaviour)', async () => {
    const res = await PATCH(makeRequest())
    expect(res.status).toBe(200)
    expect(favoriteUpdate()).toEqual(expect.objectContaining({ use_count: 3 }))
    expect(favoriteUpdate()).not.toHaveProperty('label')
  })

  it('updates the name and the dose presets, storing canonical builder values', async () => {
    const res = await PATCH(makeRequest({
      label: '  Semaglutide ',
      dose_presets: [
        { dose: '40', unit: 'units', frequency: 'qw', timing: 'morning', duration: '30', label: null },
        { dose: '10.0', unit: 'units', frequency: 'QW', timing: '', duration: '', label: 'Starter' },
      ],
    }))
    expect(res.status).toBe(200)
    expect(favoriteUpdate()).toEqual(expect.objectContaining({
      label: 'Semaglutide',
      dose_presets: [
        { dose: '10', unit: 'units', frequency: 'QW', timing: '', duration: '', label: 'Starter' },
        { dose: '40', unit: 'units', frequency: 'QW', timing: 'MORNING', duration: '30', label: null },
      ],
    }))
    expect(favoriteUpdate()).not.toHaveProperty('use_count')
    expect(favoriteUpdate()).not.toHaveProperty('sig_text')
    expect(typeof favoriteUpdate()['updated_at']).toBe('string')
  })

  it('pins to a patient in the clinic, and back to the practice with null', async () => {
    fixtures['patients:maybeSingle'] = () => ({ data: { patient_id: 'patient-1' }, error: null })
    expect((await PATCH(makeRequest({ patient_id: 'patient-1' }))).status).toBe(200)
    expect(favoriteUpdate()).toEqual(expect.objectContaining({ patient_id: 'patient-1' }))

    updates = []
    expect((await PATCH(makeRequest({ patient_id: null }))).status).toBe(200)
    expect(favoriteUpdate()).toEqual(expect.objectContaining({ patient_id: null }))

    updates = []
    fixtures['patients:maybeSingle'] = () => ({ data: null, error: null })
    expect((await PATCH(makeRequest({ patient_id: 'patient-other-clinic' }))).status).toBe(403)
    expect(updates).toEqual([])
  })

  it('re-pins the pharmacy only when it offers the formulation', async () => {
    const ok = await PATCH(makeRequest({ pharmacy_id: PHARMACY }))
    expect(ok.status).toBe(200)
    expect(favoriteUpdate()).toEqual(expect.objectContaining({ pharmacy_id: PHARMACY }))

    updates = []
    fixtures['pharmacy_formulations:maybeSingle'] = () => ({ data: null, error: null })
    const bad = await PATCH(makeRequest({ pharmacy_id: PHARMACY }))
    expect(bad.status).toBe(400)
    expect((await bad.json() as { error: string }).error).toMatch(/does not offer/)
    expect(updates).toEqual([])
  })

  it.each([
    [{ label: '' },                                                   /label/],
    [{ dose_presets: [] },                                            /at least one dose/],
    [{ dose_presets: [{ dose: '-1', unit: 'units' }] },               /dose/],
    [{ dose_presets: [{ dose: 'ten', unit: 'units' }] },              /dose/],
    [{ dose_presets: [{ dose: '10', unit: 'drops' }] },               /unit/],
    [{ dose_presets: [{ dose: '10', unit: 'units', frequency: 'Q5H' }] }, /frequency/],
    [{ dose_presets: [{ dose: '10', unit: 'units', timing: 'NOON' }] },   /timing/],
    [{ dose_presets: 'x' },                                           /array/],
    [{ pharmacy_id: 42 },                                             /pharmacy_id/],
    [{ patient_id: 42 },                                              /patient_id/],
  ])('rejects %j with 400 before touching the database', async (body, pattern) => {
    const res = await PATCH(makeRequest(body))
    expect(res.status).toBe(400)
    expect((await res.json() as { error: string }).error).toMatch(pattern)
    expect(tablesTouched).toEqual([])
  })

  it('is clinic-scoped: 403 for another clinic\'s favorite, 404 when unknown', async () => {
    fixtures['provider_favorites:single'] = () => ({
      data: { provider_id: PROVIDER_OUT, formulation_id: FORMULATION, use_count: 0 },
      error: null,
    })
    const forbidden = await PATCH(makeRequest({ label: 'x' }))
    expect(forbidden.status).toBe(403)
    expect(updates).toEqual([])

    fixtures['provider_favorites:single'] = () => ({ data: null, error: null })
    const missing = await PATCH(makeRequest({ label: 'x' }))
    expect(missing.status).toBe(404)
  })

  it('returns 401 / 403 / 400 for no session, no clinic, missing id', async () => {
    getSessionMock.mockResolvedValueOnce({ data: { session: null } })
    expect((await PATCH(makeRequest({ label: 'x' }))).status).toBe(401)

    getSessionMock.mockResolvedValueOnce({ data: { session: { user: { user_metadata: {} } } } })
    expect((await PATCH(makeRequest({ label: 'x' }))).status).toBe(403)

    expect((await PATCH(makeRequest({ label: 'x' }, null))).status).toBe(400)
  })
})

describe('validateFavoriteEdit', () => {
  it('ignores unknown keys and treats a missing body as no edit', () => {
    expect(validateFavoriteEdit(null)).toEqual({ ok: true, patch: {} })
    expect(validateFavoriteEdit({ use_count: 99, favorite_id: 'x' })).toEqual({ ok: true, patch: {} })
  })

  it('treats null ids as "none" (no pharmacy / for the practice)', () => {
    expect(validateFavoriteEdit({ pharmacy_id: null, patient_id: null })).toEqual({ ok: true, patch: { pharmacy_id: null, patient_id: null } })
  })

  it('ignores the WO-103 per-dose columns — doses are presets now', () => {
    expect(validateFavoriteEdit({ dose_amount: '20', dose_unit: 'units', sig_text: 'x' })).toEqual({ ok: true, patch: {} })
  })
})
