/**
 * @jest-environment node
 *
 * Cycling dose math, the saved templates: a cycling favorite and a
 * cycling protocol item keep their pattern and cycle length, so loading
 * them rebuilds the same cycling line instead of a daily one.
 *
 * Before: ☆ Save as favorite never sent the mode (every favorite saved
 * from the app was 'standard'), and "+ New" protocol forced every item
 * to 'standard'.
 */

import { fakeDb } from '@/lib/orders/__tests__/fake-db'
import { POST as postFavorite, GET as getFavorites } from '../route'
import { POST as postProtocol, GET as getProtocols } from '../../protocols/route'

const CLINIC   = 'c0000000-0000-4000-8000-000000000001'
const PROVIDER = '22222222-2222-4222-8222-222222222222'

const USER = { id: 'user-1', user_metadata: { clinic_id: CLINIC, app_role: 'provider' } }
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockImplementation(async () => ({
    auth: {
      getUser:    async () => ({ data: { user: USER } }),
      getSession: async () => ({ data: { session: { user: USER } } }),
    },
  })),
}))

let db: ReturnType<typeof fakeDb>
const selects: Array<{ table: string; columns: string }> = []
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn().mockImplementation(() => ({
    from: (table: string) => {
      const q = (db.client as unknown as { from: (t: string) => Record<string, (...a: unknown[]) => unknown> }).from(table)
      const select = q['select']!
      q['select'] = (columns?: unknown) => {
        if (typeof columns === 'string') selects.push({ table, columns })
        return select()
      }
      return q
    },
  })),
}))

beforeEach(() => {
  selects.length = 0
  db = fakeDb({
    providers: [{ provider_id: PROVIDER, clinic_id: CLINIC }],
    provider_favorites: [],
    protocol_templates: [],
    protocol_items: [],
  })
})

const json = (body: unknown) => ({ json: async () => body, url: 'http://localhost/api/x' }) as never

describe('a cycling favorite', () => {
  const body = {
    provider_id: PROVIDER, formulation_id: 'formulation-sema', pharmacy_id: 'pharmacy-strive',
    label: 'Semaglutide daily cycling',
    dose_presets: [{ dose: '20', unit: 'units', frequency: 'QD', timing: '', duration: '', label: null }],
    sig_mode: 'cycling', cycle_on_days: 5, cycle_off_days: 2, cycle_duration_days: 42,
  }

  it('is stored with its pattern and length', async () => {
    const res = await postFavorite(json(body))
    expect(res.status).toBe(201)
    const row = db.writesTo('provider_favorites', 'insert')[0]!.rows![0]!
    expect(row).toEqual(expect.objectContaining({ sig_mode: 'cycling', cycle_on_days: 5, cycle_off_days: 2, cycle_duration_days: 42 }))
  })

  it('a cycling favorite without a length is refused — the builder always has one unless it is ongoing', async () => {
    const res = await postFavorite(json({ ...body, cycle_duration_days: null }))
    expect(res.status).toBe(400)
    expect(db.writesTo('provider_favorites', 'insert')).toHaveLength(0)
  })

  it('a standard favorite stores no pattern, whatever the body says', async () => {
    await postFavorite(json({ ...body, sig_mode: 'standard' }))
    const row = db.writesTo('provider_favorites', 'insert')[0]!.rows![0]!
    expect(row).toEqual(expect.objectContaining({ sig_mode: 'standard', cycle_on_days: null, cycle_off_days: null, cycle_duration_days: null }))
  })

  it('is read back with its pattern and length', async () => {
    await getFavorites({ url: 'http://localhost/api/favorites' } as never)
    const read = selects.find(s => s.table === 'provider_favorites' && s.columns.includes('dose_presets'))!
    expect(read.columns).toMatch(/cycle_on_days/)
    expect(read.columns).toMatch(/cycle_off_days/)
    expect(read.columns).toMatch(/cycle_duration_days/)
  })
})

describe('a cycling protocol item', () => {
  const item = {
    formulation_id: 'formulation-sema', pharmacy_id: 'pharmacy-strive', dose_amount: '20', dose_unit: 'units',
    frequency_code: 'QD', sig_text: 'Inject 20 units subcutaneous once daily, 5 days on / 2 days off, for 6 weeks then reassess',
    default_quantity: '2.5 mL vial', default_refills: 0,
  }

  it('"+ New" protocol keeps it cycling, with its pattern and length', async () => {
    const res = await postProtocol(json({
      name: 'Cycling protocol',
      items: [{ ...item, sig_mode: 'cycling', cycle_on_days: 5, cycle_off_days: 2, cycle_duration_days: 42 }],
    }))
    expect(res.status).toBe(201)
    const row = db.writesTo('protocol_items', 'insert')[0]!.rows![0]!
    expect(row).toEqual(expect.objectContaining({ sig_mode: 'cycling', cycle_on_days: 5, cycle_off_days: 2, cycle_duration_days: 42 }))
  })

  it('a standard item is stored standard, with no pattern', async () => {
    await postProtocol(json({ name: 'Standard protocol', items: [item] }))
    const row = db.writesTo('protocol_items', 'insert')[0]!.rows![0]!
    expect(row).toEqual(expect.objectContaining({ sig_mode: 'standard', cycle_on_days: null, cycle_off_days: null, cycle_duration_days: null }))
  })

  it('is read back with its pattern and length', async () => {
    db.tables['protocol_templates']!.push({ protocol_id: 'proto-1', clinic_id: CLINIC, name: 'P', is_active: true })
    await getProtocols({ url: 'http://localhost/api/protocols?id=proto-1' } as never)
    const read = selects.find(s => s.table === 'protocol_items')!
    expect(read.columns).toMatch(/cycle_on_days/)
    expect(read.columns).toMatch(/cycle_duration_days/)
  })
})
