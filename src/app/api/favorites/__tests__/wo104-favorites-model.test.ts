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
 *   GET /api/favorites/recent?provider_id=
 *     - last 8 distinct formulations, newest first, dose from the
 *       structured snapshot (never sig_text)
 */

import { NextRequest } from 'next/server'
import { GET, POST } from '../route'
import { GET as GET_RECENT } from '../recent/route'

const CLINIC_ID   = 'clinic-A'
const PROVIDER    = 'provider-in'
const FORMULATION = 'formulation-sema'
const PHARMACY    = 'pharmacy-strive'

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
  getUserMock.mockResolvedValue({ data: { user: { id: 'u1', user_metadata: { clinic_id: CLINIC_ID } } } })
  fixtures['providers:await'] = () => ({ data: [{ provider_id: PROVIDER }], error: null })
  fixtures['provider_favorites:await'] = () => ({ data: [], error: null })
  fixtures['provider_favorites:single'] = () => ({ data: { favorite_id: 'fav-1', label: 'Semaglutide' }, error: null })
  fixtures['formulations:maybeSingle'] = () => ({
    data: { salt_forms: { ingredients: { therapeutic_category: 'Weight Loss' } }, formulation_ingredients: [] },
    error: null,
  })
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
      dose_presets: [preset('10')], sig_mode: 'standard', default_refills: 2,
    })
    expect(inserts[0]!.row).not.toHaveProperty('sig_text')
  })

  it('adds the dose to the existing card for the same formulation + pharmacy + scope', async () => {
    fixtures['provider_favorites:await'] = () => ({
      data: [
        { favorite_id: 'fav-patient', pharmacy_id: PHARMACY, patient_id: 'patient-1', dose_presets: [preset('80')] },
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
    fixtures['patients:maybeSingle'] = () => ({ data: { patient_id: 'patient-1' }, error: null })
    const res = await POST(post({
      provider_id: PROVIDER, formulation_id: FORMULATION, pharmacy_id: PHARMACY, patient_id: 'patient-1',
      label: 'Semaglutide', dose_presets: [preset('10')],
    }))
    expect(res.status).toBe(201)
    expect(inserts[0]!.row).toEqual(expect.objectContaining({ patient_id: 'patient-1' }))

    inserts = []
    fixtures['patients:maybeSingle'] = () => ({ data: null, error: null })
    const forbidden = await POST(post({
      provider_id: PROVIDER, formulation_id: FORMULATION, pharmacy_id: PHARMACY, patient_id: 'patient-elsewhere',
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
    const res = await POST(post({ provider_id: 'provider-out', formulation_id: FORMULATION, label: 'x', dose_presets: [preset('10')] }))
    expect(res.status).toBe(403)
  })
})

describe('GET /api/favorites — WO-104 patient scope', () => {
  it('returns clinic-wide favorites plus the selected patient\'s own, never another patient\'s', async () => {
    const live = { formulation_id: FORMULATION, name: 'Semaglutide', is_active: true, deleted_at: null }
    fixtures['provider_favorites:await'] = () => ({
      data: [
        { favorite_id: 'practice', pharmacy_id: null, patient_id: null, dose_presets: [preset('10'), { dose: 'bad' }], formulations: live },
        { favorite_id: 'mine', pharmacy_id: null, patient_id: 'patient-1', dose_presets: [preset('80')], formulations: live },
        { favorite_id: 'theirs', pharmacy_id: null, patient_id: 'patient-2', dose_presets: [preset('40')], formulations: live },
      ],
      error: null,
    })
    const withPatient = await GET(new NextRequest(new URL('http://localhost/api/favorites?patient_id=patient-1')))
    const json = await withPatient.json() as { data: Array<{ favorite_id: string; dose_presets: unknown[] }> }
    expect(json.data.map(f => f.favorite_id)).toEqual(['practice', 'mine'])
    // Invalid stored presets never reach the client.
    expect(json.data[0]!.dose_presets).toEqual([preset('10')])

    const noPatient = await GET(new NextRequest(new URL('http://localhost/api/favorites')))
    expect((await noPatient.json() as { data: Array<{ favorite_id: string }> }).data.map(f => f.favorite_id)).toEqual(['practice'])
  })
})

describe('GET /api/favorites/recent — WO-104 Recent strip', () => {
  it('lists the last distinct formulations with their structured dose, never parsing the sig', async () => {
    fixtures['providers:maybeSingle'] = () => ({ data: { provider_id: PROVIDER }, error: null })
    fixtures['orders:await'] = () => ({
      data: [
        { formulation_id: 'f-sema', pharmacy_id: PHARMACY, created_at: '2026-09-12T10:00:00Z',
          medication_snapshot: { medication_name: 'Semaglutide', prescribed_dose: '20 units', frequency_code: 'QW' },
          pharmacy_snapshot: { name: 'Strive Pharmacy' }, sig_text: 'Inject 40 units … for 90 days' },
        { formulation_id: 'f-sema', pharmacy_id: PHARMACY, created_at: '2026-09-01T10:00:00Z',
          medication_snapshot: { medication_name: 'Semaglutide', prescribed_dose: '10 units', frequency_code: 'QW' },
          pharmacy_snapshot: { name: 'Strive Pharmacy' } },
        { formulation_id: 'f-bpc', pharmacy_id: null, created_at: '2026-09-11T10:00:00Z',
          medication_snapshot: { medication_name: 'BPC-157' }, pharmacy_snapshot: null },
      ],
      error: null,
    })
    fixtures['formulations:await'] = () => ({
      data: [
        { formulation_id: 'f-sema', name: 'Semaglutide 5mg/mL Injectable', concentration_value: 5, concentration_unit: 'mg/mL', is_active: true, deleted_at: null, dosage_forms: { name: 'Injectable Solution' } },
      ],
      error: null,
    })
    const res = await GET_RECENT(new NextRequest(new URL(`http://localhost/api/favorites/recent?provider_id=${PROVIDER}`)))
    expect(res.status).toBe(200)
    const json = await res.json() as { data: Array<Record<string, unknown>> }
    expect(json.data.map(r => r['formulation_id'])).toEqual(['f-sema', 'f-bpc'])
    expect(json.data[0]).toEqual(expect.objectContaining({
      formulation_name: 'Semaglutide 5mg/mL Injectable',
      pharmacy_name: 'Strive Pharmacy',
      formulation_active: true,
      preset: { dose: '20', unit: 'units', frequency: 'QW', timing: '', duration: '', label: null },
    }))
    // No structured dose on the order → no preset (and no Make favorite).
    expect(json.data[1]).toEqual(expect.objectContaining({ preset: null, formulation_active: false }))
    // Scoped to the provider + clinic, cancelled and deleted orders skipped.
    expect(filters).toEqual(expect.arrayContaining([
      { table: 'orders', op: 'eq', args: ['provider_id', PROVIDER] },
      { table: 'orders', op: 'eq', args: ['clinic_id', CLINIC_ID] },
      { table: 'orders', op: 'neq', args: ['status', 'CANCELLED'] },
      { table: 'orders', op: 'is', args: ['deleted_at', null] },
    ]))
  })

  it('403 for a provider outside the clinic; 400 without provider_id', async () => {
    fixtures['providers:maybeSingle'] = () => ({ data: null, error: null })
    expect((await GET_RECENT(new NextRequest(new URL('http://localhost/api/favorites/recent?provider_id=x')))).status).toBe(403)
    expect((await GET_RECENT(new NextRequest(new URL('http://localhost/api/favorites/recent')))).status).toBe(400)
  })
})
