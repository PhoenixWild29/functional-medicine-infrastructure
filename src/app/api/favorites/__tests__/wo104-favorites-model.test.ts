/**
 * @jest-environment node
 *
 * WO-104: favorites are drug + formulation + pharmacy (+ patient) with
 * the clinic's common doses as structured presets.
 *
 *   POST /api/favorites
 *     - a new card is inserted with dose_presets and a DERIVED category
 *     - saving a dose for a card the clinic already has (same formulation
 *       + pharmacy + patient scope) adds the dose to that card, 10 · 20 · 40
 *     - a patient-pinned save is its own card, and the patient must be in
 *       the clinic
 *     - no sig is stored
 *   GET /api/favorites?patient_id=
 *     - clinic-wide favorites plus that patient's own; other patients'
 *       pinned favorites are never returned
 *   (GET /api/favorites/frequent, which replaced /recent, is in
 *   frequent-route.test.ts)
 */

import { NextRequest } from 'next/server'
import { GET, POST } from '../route'

const CLINIC_ID   = 'clinic-A'
const PROVIDER    = 'a2000000-0000-0000-0000-000000000001'
const FORMULATION = 'a7000000-0000-0000-0000-000000000001'
const PHARMACY    = 'a4000000-0000-0000-0000-000000000001'

type ChainBuilder = Record<string, unknown>
let inserts: Array<{ table: string; row: Record<string, unknown> }> = []
let updates: Array<{ table: string; row: Record<string, unknown> }> = []
let filters: Array<{ table: string; op: string; args: unknown[] }> = []
const fixtures: Record<string, () => unknown> = {}

const getUserMock = jest.fn()
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockResolvedValue({ auth: { getUser: () => getUserMock() } }),
}))

function makeChain(table: string): ChainBuilder {
  const builder: ChainBuilder = {}
  for (const op of ['select', 'eq', 'is', 'in', 'not', 'neq', 'order', 'limit']) {
    builder[op] = (...args: unknown[]) => { filters.push({ table, op, args }); return builder }
  }
  builder['insert'] = (row: Record<string, unknown>) => { inserts.push({ table, row }); return builder }
  builder['update'] = (row: Record<string, unknown>) => { updates.push({ table, row }); return builder }
  const resolve = (key: string) => {
    const f = fixtures[`${table}:${key}`]
    return Promise.resolve(f ? f() : { data: null, error: null })
  }
  builder['maybeSingle'] = () => resolve('maybeSingle')
  builder['single'] = () => resolve('single')
  builder['then'] = (res: (v: unknown) => unknown) => resolve('await').then(res)
  return builder
}

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn().mockReturnValue({ from: (table: string) => makeChain(table) }),
}))

function post(body: unknown): NextRequest {
  return new NextRequest(new URL('http://localhost/api/favorites'), {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  })
}

const preset = (dose: string) => ({ dose, unit: 'units', frequency: 'QW', timing: 'MORNING', duration: '30', label: null })

beforeEach(() => {
  inserts = []; updates = []; filters = []
  Object.keys(fixtures).forEach(k => delete fixtures[k])
  getUserMock.mockResolvedValue({ data: { user: { id: 'u1', app_metadata: { app_role: 'clinic_admin', clinic_id: CLINIC_ID } } } })
  fixtures['providers:await'] = () => ({ data: [{ provider_id: PROVIDER }], error: null })
  fixtures['provider_favorites:await'] = () => ({ data: [], error: null })
  fixtures['provider_favorites:single'] = () => ({ data: { favorite_id: 'fav-1', label: 'Semaglutide' }, error: null })
  // Category lookups: formulation → salt form → ingredient (no nested embed).
  fixtures['formulations:maybeSingle'] = () => ({ data: { salt_form_id: 'sf-sema' }, error: null })
  fixtures['salt_forms:maybeSingle'] = () => ({ data: { ingredient_id: 'ing-sema' }, error: null })
  fixtures['ingredients:maybeSingle'] = () => ({ data: { therapeutic_category: 'Weight Loss' }, error: null })
})

describe('POST /api/favorites — WO-104 cards with dose presets', () => {
  it('inserts a new card with the preset and a category derived from the ingredient', async () => {
    const res = await POST(post({
      provider_id: PROVIDER, formulation_id: FORMULATION, pharmacy_id: PHARMACY,
      label: 'Semaglutide', dose_presets: [preset('10')], default_refills: 2,
    }))
    expect(res.status).toBe(201)
    expect(inserts).toHaveLength(1)
    expect(inserts[0]!.row).toEqual({
      provider_id: PROVIDER, formulation_id: FORMULATION, pharmacy_id: PHARMACY, patient_id: null,
      label: 'Semaglutide', category: 'Weight Management',
      dose_presets: [preset('10')], sig_mode: 'standard', titration_steps: [], default_refills: 2,
      cycle_on_days: null, cycle_off_days: null, cycle_duration_days: null,
    })
    expect(inserts[0]!.row).not.toHaveProperty('sig_text')
    expect(filters).toEqual(expect.arrayContaining([
      { table: 'salt_forms', op: 'eq', args: ['salt_form_id', 'sf-sema'] },
      { table: 'ingredients', op: 'eq', args: ['ingredient_id', 'ing-sema'] },
    ]))
  })

  it('a combination (no salt form) takes the primary formulation ingredient\'s category', async () => {
    fixtures['formulations:maybeSingle'] = () => ({ data: { salt_form_id: null }, error: null })
    fixtures['formulation_ingredients:await'] = () => ({
      data: [{ ingredient_id: 'ing-b12', role: 'adjuvant' }, { ingredient_id: 'ing-sema', role: 'primary' }],
      error: null,
    })
    fixtures['ingredients:maybeSingle'] = () => ({ data: { therapeutic_category: "Women's Health" }, error: null })
    const res = await POST(post({
      provider_id: PROVIDER, formulation_id: FORMULATION, pharmacy_id: PHARMACY,
      label: 'Combo', dose_presets: [preset('10')],
    }))
    expect(res.status).toBe(201)
    expect(inserts[0]!.row['category']).toBe('Hormones')
    expect(filters).toEqual(expect.arrayContaining([{ table: 'ingredients', op: 'eq', args: ['ingredient_id', 'ing-sema'] }]))
  })

  it('adds the dose to the existing card for the same formulation + pharmacy + scope', async () => {
    fixtures['provider_favorites:await'] = () => ({
      data: [
        { favorite_id: 'fav-patient', pharmacy_id: PHARMACY, patient_id: 'a3000000-0000-0000-0000-000000000001', dose_presets: [preset('80')] },
        { favorite_id: 'fav-1', pharmacy_id: PHARMACY, patient_id: null, dose_presets: [preset('40'), preset('10')] },
      ],
      error: null,
    })
    const res = await POST(post({
      provider_id: PROVIDER, formulation_id: FORMULATION, pharmacy_id: PHARMACY,
      label: 'ignored for an existing card', dose_presets: [preset('20'), preset('10')],
    }))
    expect(res.status).toBe(200)
    expect((await res.json() as { merged: boolean }).merged).toBe(true)
    expect(inserts).toEqual([])
    expect(updates).toHaveLength(1)
    expect(updates[0]!.row['dose_presets']).toEqual([preset('10'), preset('20'), preset('40')])
    expect(filters).toEqual(expect.arrayContaining([{ table: 'provider_favorites', op: 'eq', args: ['favorite_id', 'fav-1'] }]))
  })

  it('a patient-pinned save is its own card, and the patient must belong to the clinic', async () => {
    fixtures['provider_favorites:await'] = () => ({
      data: [{ favorite_id: 'fav-1', pharmacy_id: PHARMACY, patient_id: null, dose_presets: [preset('10')] }],
      error: null,
    })
    fixtures['patients:maybeSingle'] = () => ({ data: { patient_id: 'a3000000-0000-0000-0000-000000000001' }, error: null })
    const res = await POST(post({
      provider_id: PROVIDER, formulation_id: FORMULATION, pharmacy_id: PHARMACY, patient_id: 'a3000000-0000-0000-0000-000000000001',
      label: 'Semaglutide', dose_presets: [preset('10')],
    }))
    expect(res.status).toBe(201)
    expect(inserts[0]!.row).toEqual(expect.objectContaining({ patient_id: 'a3000000-0000-0000-0000-000000000001' }))

    inserts = []
    fixtures['patients:maybeSingle'] = () => ({ data: null, error: null })
    const forbidden = await POST(post({
      provider_id: PROVIDER, formulation_id: FORMULATION, pharmacy_id: PHARMACY, patient_id: 'a3000000-0000-0000-0000-000000000099',
      label: 'Semaglutide', dose_presets: [preset('10')],
    }))
    expect(forbidden.status).toBe(403)
    expect(inserts).toEqual([])
  })

  it.each([
    [{ dose_presets: [] }, /at least one dose/],
    [{ dose_presets: [{ dose: '10', unit: 'units', frequency: 'WEEKLY' }] }, /frequency/],
    [{ label: '' }, /label/],
  ])('rejects %j with 400', async (override, pattern) => {
    const res = await POST(post({
      provider_id: PROVIDER, formulation_id: FORMULATION, pharmacy_id: PHARMACY,
      label: 'Semaglutide', dose_presets: [preset('10')], ...override,
    }))
    expect(res.status).toBe(400)
    expect((await res.json() as { error: string }).error).toMatch(pattern)
    expect(inserts).toEqual([])
  })

  it('401 without a verified user; 403 for a provider outside the clinic', async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: null } })
    expect((await POST(post({}))).status).toBe(401)
    const res = await POST(post({ provider_id: 'a2000000-0000-0000-0000-000000000009', formulation_id: FORMULATION, label: 'x', dose_presets: [preset('10')] }))
    expect(res.status).toBe(403)
  })
})

describe('GET /api/favorites — WO-104 patient scope', () => {
  it('returns clinic-wide favorites plus the selected patient\'s own, never another patient\'s', async () => {
    const live = { formulation_id: FORMULATION, name: 'Semaglutide', is_active: true, deleted_at: null }
    fixtures['provider_favorites:await'] = () => ({
      data: [
        { favorite_id: 'practice', pharmacy_id: null, patient_id: null, dose_presets: [preset('10'), { dose: 'bad' }], formulations: live },
        { favorite_id: 'mine', pharmacy_id: null, patient_id: 'a3000000-0000-0000-0000-000000000001', dose_presets: [preset('80')], formulations: live },
        { favorite_id: 'theirs', pharmacy_id: null, patient_id: 'a3000000-0000-0000-0000-000000000002', dose_presets: [preset('40')], formulations: live },
      ],
      error: null,
    })
    const withPatient = await GET(new NextRequest(new URL('http://localhost/api/favorites?patient_id=a3000000-0000-0000-0000-000000000001')))
    const json = await withPatient.json() as { data: Array<{ favorite_id: string; dose_presets: unknown[] }> }
    expect(json.data.map(f => f.favorite_id)).toEqual(['practice', 'mine'])
    // Invalid stored presets never reach the client.
    expect(json.data[0]!.dose_presets).toEqual([preset('10')])

    const noPatient = await GET(new NextRequest(new URL('http://localhost/api/favorites')))
    expect((await noPatient.json() as { data: Array<{ favorite_id: string }> }).data.map(f => f.favorite_id)).toEqual(['practice'])
  })
})

