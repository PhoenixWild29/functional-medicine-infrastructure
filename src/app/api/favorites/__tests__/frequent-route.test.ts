/**
 * @jest-environment node
 *
 * GET /api/favorites/frequent?provider_id= (requirement 19): the
 * provider's most-ordered formulation + dose combinations over the last
 * 90 days, each with its use count, the computed-mg source and the
 * pharmacy name; recent when nothing is in the window. Computed from the
 * order lines; no new table. Replaces /api/favorites/recent.
 */

import { NextRequest } from 'next/server'
import { GET } from '../frequent/route'

const CLINIC_ID = 'clinic-A'
const PROVIDER  = 'b2000000-0000-4000-8000-0000000000a1'
const PHARMACY  = 'pharmacy-strive'

type ChainBuilder = Record<string, unknown>
let filters: Array<{ table: string; op: string; args: unknown[] }> = []
const fixtures: Record<string, () => unknown> = {}

const getUserMock = jest.fn()
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockResolvedValue({ auth: { getUser: () => getUserMock() } }),
}))

function makeChain(table: string): ChainBuilder {
  const builder: ChainBuilder = {}
  for (const op of ['select', 'eq', 'is', 'in', 'not', 'neq', 'gte', 'order', 'limit']) {
    builder[op] = (...args: unknown[]) => { filters.push({ table, op, args }); return builder }
  }
  const resolve = (key: string) => {
    const f = fixtures[`${table}:${key}`]
    return Promise.resolve(f ? f() : { data: null, error: null })
  }
  builder['maybeSingle'] = () => resolve('maybeSingle')
  builder['then'] = (res: (v: unknown) => unknown) => resolve('await').then(res)
  return builder
}

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn().mockReturnValue({ from: (table: string) => makeChain(table) }),
}))

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString()
const order = (formulation: string, dose: string | null, created: string, extra: Record<string, unknown> = {}) => ({
  formulation_id: formulation, pharmacy_id: PHARMACY, created_at: created,
  medication_snapshot: { medication_name: formulation === 'f-sema' ? 'Semaglutide' : 'BPC-157', ...(dose ? { prescribed_dose: dose, frequency_code: 'QW' } : {}) },
  pharmacy_snapshot: { name: 'Strive Pharmacy' },
  ...extra,
})

const get = (qs: string) => GET(new NextRequest(new URL(`http://localhost/api/favorites/frequent${qs}`)))

beforeEach(() => {
  filters = []
  Object.keys(fixtures).forEach(k => delete fixtures[k])
  getUserMock.mockResolvedValue({ data: { user: { id: 'u1', app_metadata: { app_role: 'provider', clinic_id: CLINIC_ID } } } })
  fixtures['providers:maybeSingle'] = () => ({ data: { provider_id: PROVIDER }, error: null })
  fixtures['formulations:await'] = () => ({
    data: [
      { formulation_id: 'f-sema', name: 'Semaglutide 5mg/mL Injectable', concentration_value: 5, concentration_unit: 'mg/mL', is_active: true, deleted_at: null, dosage_forms: { name: 'Injectable Solution' } },
      { formulation_id: 'f-bpc', name: 'BPC-157 5mg Vial', concentration_value: null, concentration_unit: null, is_active: true, deleted_at: null, dosage_forms: { name: 'Injectable Solution' } },
    ],
    error: null,
  })
})

describe('GET /api/favorites/frequent', () => {
  it('ranks by use count in the last 90 days and carries the count, the pharmacy and the mg source', async () => {
    fixtures['orders:await'] = () => ({
      data: [
        order('f-bpc', '250 mcg', daysAgo(1), { sig_text: 'Inject 500 mcg daily' }),
        order('f-sema', '10 units', daysAgo(3)),
        order('f-sema', '10 units', daysAgo(10)),
        order('f-sema', '10 units', daysAgo(60)),
      ],
      error: null,
    })
    const res = await get(`?provider_id=${PROVIDER}`)
    expect(res.status).toBe(200)
    const json = await res.json() as { mode: string; window_days: number; data: Array<Record<string, unknown>> }
    expect(json.mode).toBe('frequent')
    expect(json.window_days).toBe(90)
    expect(json.data.map(r => [r['formulation_id'], r['use_count']])).toEqual([['f-sema', 3], ['f-bpc', 1]])
    expect(json.data[0]).toEqual(expect.objectContaining({
      formulation_name:   'Semaglutide 5mg/mL Injectable',
      pharmacy_name:      'Strive Pharmacy',
      formulation_active: true,
      preset:             { dose: '10', unit: 'units', frequency: 'QW', timing: '', duration: '', label: null },
      formulations:       expect.objectContaining({ concentration_value: 5, concentration_unit: 'mg/mL' }),
    }))
    // The dose comes from the structured snapshot, never the sig.
    expect(json.data[1]!['preset']).toEqual(expect.objectContaining({ dose: '250', unit: 'mcg' }))
    // Scoped to the provider and clinic; cancelled and deleted skipped.
    expect(filters).toEqual(expect.arrayContaining([
      { table: 'orders', op: 'eq', args: ['provider_id', PROVIDER] },
      { table: 'orders', op: 'eq', args: ['clinic_id', CLINIC_ID] },
      { table: 'orders', op: 'neq', args: ['status', 'CANCELLED'] },
      { table: 'orders', op: 'is', args: ['deleted_at', null] },
    ]))
  })

  it('nothing in the window: recent, same shape', async () => {
    fixtures['orders:await'] = () => ({ data: [order('f-sema', '20 units', daysAgo(120)), order('f-bpc', null, daysAgo(100))], error: null })
    const json = await (await get(`?provider_id=${PROVIDER}`)).json() as { mode: string; data: Array<Record<string, unknown>> }
    expect(json.mode).toBe('recent')
    expect(json.data.map(r => [r['formulation_id'], r['use_count']])).toEqual([['f-bpc', 1], ['f-sema', 1]])
  })

  it('no orders: an empty list', async () => {
    fixtures['orders:await'] = () => ({ data: [], error: null })
    await expect((await get(`?provider_id=${PROVIDER}`)).json()).resolves.toEqual({ mode: 'frequent', window_days: 90, data: [] })
  })

  it('403 for a provider outside the clinic; 400 without provider_id or with a non-uuid one; 401 signed out; 500 when orders cannot be read', async () => {
    expect((await get('')).status).toBe(400)
    fixtures['orders:await'] = () => ({ data: null, error: { message: 'db down' } })
    jest.spyOn(console, 'error').mockImplementation(() => {})
    expect((await get(`?provider_id=${PROVIDER}`)).status).toBe(500)
    fixtures['providers:maybeSingle'] = () => ({ data: null, error: null })
    expect((await get('?provider_id=x')).status).toBe(400)
    expect((await get('?provider_id=b2000000-0000-4000-8000-0000000000ff')).status).toBe(403)
    getUserMock.mockResolvedValue({ data: { user: null } })
    expect((await get(`?provider_id=${PROVIDER}`)).status).toBe(401)
  })
})
