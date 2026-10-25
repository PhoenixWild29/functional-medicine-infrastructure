/**
 * @jest-environment node
 *
 * Input validation of /api/protocols. Who is calling is checked first;
 * then the id in the query and every id in the POST body are checked as
 * ids, and the free text is bounded, before anything is read or written
 * (a bad id reaching Postgres is error 22P02, a 500). Another clinic's
 * protocol is 404, read only with the caller's clinic.
 */

import type { NextRequest } from 'next/server'
import { scriptedDb } from '@/__tests__/helpers/scripted-db'
import { GET, POST } from '../route'

const CLINIC   = 'a1000000-0000-0000-0000-000000000001'
const PROTOCOL = 'a8000000-0000-0000-0000-000000000001'
const PROVIDER = 'a2000000-0000-0000-0000-000000000001'

let db = scriptedDb(() => undefined)
let user: { id: string; app_metadata: Record<string, unknown> } | null = null
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) } }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.spyOn(console, 'error').mockImplementation(() => {})

const LINE = {
  formulation_id: 'a7000000-0000-0000-0000-000000000001',
  pharmacy_id: 'a4000000-0000-0000-0000-000000000004',
  dose_amount: '10', dose_unit: 'units', frequency_code: 'QW',
  sig_text: 'Inject 10 units subcutaneously once weekly',
  default_quantity: '5mL vial', default_refills: 0,
}

const get = (query: string) => GET({ url: `https://app.test/api/protocols${query}` } as unknown as NextRequest)
function post(body: unknown) {
  return POST({
    headers: new Headers({ 'sec-fetch-site': 'same-origin' }),
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  } as unknown as NextRequest)
}

beforeEach(() => {
  user = { id: 'u1', app_metadata: { clinic_id: CLINIC, app_role: 'clinic_admin' } }
  db = scriptedDb(c => {
    if (c.table === 'protocol_templates' && c.op === 'insert') return { data: { protocol_id: PROTOCOL, name: 'x' } }
    if (c.table === 'providers') return { data: { provider_id: PROVIDER } }
    return undefined
  })
})

describe('GET /api/protocols?id=', () => {
  it('an id that is not an id: 400, nothing read', async () => {
    const res = await get('?id=not-an-id')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid request', fields: ['id'] })
    expect(db.calls).toHaveLength(0)
  })

  it('signed out: 401 before the id is looked at', async () => {
    user = null
    expect((await get('?id=not-an-id')).status).toBe(401)
    expect(db.calls).toHaveLength(0)
  })

  it("another clinic's protocol: 404, read only with the caller's clinic", async () => {
    // No row for this clinic (the protocol belongs to another).
    const res = await get(`?id=${PROTOCOL}`)
    expect(res.status).toBe(404)
    const read = db.calls.find(c => c.table === 'protocol_templates')!
    expect(read.filters).toMatchObject({ protocol_id: PROTOCOL, clinic_id: CLINIC })
    expect(db.calls.some(c => c.table === 'protocol_items')).toBe(false)
  })

  it('a seeded (non-v4) id is accepted', async () => {
    db = scriptedDb(c => (c.table === 'protocol_templates' ? { data: { protocol_id: PROTOCOL } } : c.table === 'protocol_items' ? { data: [] } : undefined))
    expect((await get(`?id=${PROTOCOL}`)).status).toBe(200)
  })
})

describe('POST /api/protocols', () => {
  const writes = () => db.calls.filter(c => c.op !== 'select')

  it('a body that is JSON null: 400 (was a thrown 500)', async () => {
    const res = await post('null')
    expect(res.status).toBe(400)
    expect(writes()).toHaveLength(0)
  })

  it.each([
    ['formulation_id', { ...LINE, formulation_id: 'f-1' }, 'items.0.formulation_id'],
    ['pharmacy_id', { ...LINE, pharmacy_id: 'ph-1' }, 'items.0.pharmacy_id'],
  ])('a bad %s: 400, nothing written', async (_f, line, field) => {
    const res = await post({ name: 'x', items: [line] })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid request', fields: [field] })
    expect(writes()).toHaveLength(0)
  })

  it('a bad created_by (clinic admin): 400, the provider is never looked up', async () => {
    const res = await post({ name: 'x', created_by: 'someone-else', items: [LINE] })
    expect(res.status).toBe(400)
    expect(db.calls).toHaveLength(0)
  })

  it.each([
    ['description', { description: 'x'.repeat(2001) }, {}, 'description'],
    ['sig_text', {}, { sig_text: 'x'.repeat(2001) }, 'items.0.sig_text'],
    ['dose_unit', {}, { dose_unit: 'x'.repeat(201) }, 'items.0.dose_unit'],
    ['default_quantity', {}, { default_quantity: 'x'.repeat(201) }, 'items.0.default_quantity'],
    ['default_refills', {}, { default_refills: 1e12 }, 'items.0.default_refills'],
  ])('an oversize %s: 400, nothing written', async (_f, top, item, field) => {
    const res = await post({ name: 'x', items: [{ ...LINE, ...item }], ...top })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid request', fields: [field] })
    expect(writes()).toHaveLength(0)
  })

  it('what the session panel and the new-protocol form send is saved', async () => {
    const res = await post({ name: 'Weight loss', created_by: PROVIDER, items: [LINE, { ...LINE, pharmacy_id: null, dose_amount: null, sig_text: '' }] })
    expect(res.status).toBe(201)
  })

  it('the existing messages stay: no name, no items', async () => {
    expect(await (await post({ items: [LINE] })).json()).toEqual({ error: 'name is required' })
    expect(await (await post({ name: 'x', items: [] })).json()).toEqual({ error: 'items must be a non-empty array' })
  })
})
