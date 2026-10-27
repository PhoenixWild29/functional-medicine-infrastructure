/**
 * @jest-environment node
 *
 * C-2026-10-25-10 (review of favorites-frequent): the Frequently used
 * query is bounded in SQL, not only in JS. Each panel open reads the
 * provider's orders from the 90-day window (created_at >= now - 90 days),
 * at most SCAN_LIMIT of them; only when the window is empty does a second,
 * small query (at most RECENT_FALLBACK_LIMIT rows, no window) give the
 * Recent fallback. Before, every open read the newest 500 orders of the
 * provider's whole history and filtered the window afterwards.
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


const ordersCalls = () => {
  const out: Array<Array<{ op: string; args: unknown[] }>> = []
  let current: Array<{ op: string; args: unknown[] }> | null = null
  for (const f of filters) {
    if (f.table !== 'orders') continue
    if (f.op === 'select') { current = []; out.push(current) }
    current?.push({ op: f.op, args: f.args })
  }
  return out
}

describe('the orders read is bounded in SQL', () => {
  it('reads only the 90-day window, with a row limit', async () => {
    fixtures['orders:await'] = () => ({ data: [order('f-sema', '10 units', daysAgo(3))], error: null })
    const before = Date.now()
    const res = await get(`?provider_id=${PROVIDER}`)
    expect(res.status).toBe(200)
    const [first, ...rest] = ordersCalls()
    expect(rest).toHaveLength(0)
    const gte = first!.find(c => c.op === 'gte')
    expect(gte?.args[0]).toBe('created_at')
    const since = Date.parse(String(gte?.args[1]))
    expect(Math.abs(before - since - 90 * 86_400_000)).toBeLessThan(60_000)
    const limit = first!.find(c => c.op === 'limit')
    expect(Number(limit?.args[0])).toBeLessThanOrEqual(500)
  })

  it('an empty window: one small fallback read for Recent, with no window', async () => {
    let n = 0
    fixtures['orders:await'] = () => (++n === 1
      ? { data: [], error: null }
      : { data: [order('f-sema', '10 units', daysAgo(200))], error: null })
    const res = await get(`?provider_id=${PROVIDER}`)
    const body = await res.json() as { mode: string; data: unknown[] }
    expect(body.mode).toBe('recent')
    expect(body.data).toHaveLength(1)
    const calls = ordersCalls()
    expect(calls).toHaveLength(2)
    expect(calls[1]!.some(c => c.op === 'gte')).toBe(false)
    expect(Number(calls[1]!.find(c => c.op === 'limit')?.args[0])).toBeLessThanOrEqual(50)
    // The fallback is scoped the same way.
    expect(calls[1]).toEqual(expect.arrayContaining([{ op: 'eq', args: ['clinic_id', CLINIC_ID] }, { op: 'eq', args: ['provider_id', PROVIDER] }]))
  })
})
