/**
 * @jest-environment node
 *
 * WO-103: POST /api/protocols creates a protocol template from the
 * prescriptions already in the session (the Protocols panel "+ New").
 *
 *   - inserts one protocol_templates row for the caller's clinic and one
 *     protocol_items row per line, in session order
 *   - created_by must be a provider in the clinic
 *   - name / items validation → 400 before any DB access
 *   - an items insert failure removes the half-created template
 */

import { POST } from '../route'
import { NextRequest } from 'next/server'

const CLINIC_ID   = 'a1000000-0000-0000-0000-000000000001'
const PROVIDER_ID = 'a2000000-0000-0000-0000-000000000001'
const PROTOCOL_ID = 'a8000000-0000-0000-0000-000000000001'

type ChainBuilder = Record<string, unknown>

let inserts: Array<{ table: string; row: unknown }> = []
let deletes: string[] = []
let tablesTouched: string[] = []
const fixtures: Record<string, () => unknown> = {}

const getSessionMock = jest.fn()
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockResolvedValue({
    auth: { getSession: () => getSessionMock() },
  }),
}))

function makeChain(table: string): ChainBuilder {
  tablesTouched.push(table)
  const builder: ChainBuilder = {}
  const passthrough = () => builder
  builder['select'] = passthrough
  builder['eq'] = passthrough
  builder['insert'] = (row: unknown) => { inserts.push({ table, row }); return builder }
  builder['delete'] = () => { deletes.push(table); return builder }
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

function makeRequest(body: unknown): NextRequest {
  return new NextRequest(new URL('http://localhost/api/protocols'), {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  })
}

const LINE = {
  formulation_id: 'a7000000-0000-0000-0000-000000000001',
  pharmacy_id: 'a4000000-0000-0000-0000-000000000004',
  dose_amount: '10', dose_unit: 'units', frequency_code: 'QW',
  sig_text: 'Inject 10 units (0.10mL / 0.50mg) subcutaneously once weekly',
  default_quantity: '5mL vial', default_refills: 0,
}

beforeEach(() => {
  inserts = []
  deletes = []
  tablesTouched = []
  Object.keys(fixtures).forEach(k => delete fixtures[k])
  getSessionMock.mockResolvedValue({
    data: { session: { user: { id: 'auth-uid', user_metadata: { clinic_id: CLINIC_ID, app_role: 'provider' } } } },
  })
  fixtures['providers:maybeSingle'] = () => ({ data: { provider_id: PROVIDER_ID }, error: null })
  fixtures['protocol_templates:single'] = () => ({ data: { protocol_id: PROTOCOL_ID, name: 'Weight Loss Starter' }, error: null })
  fixtures['protocol_items:await'] = () => ({ data: null, error: null })
})

describe('POST /api/protocols — WO-103 "+ New" from session', () => {
  it('creates the template and one item per session line in order', async () => {
    const res = await POST(makeRequest({
      name: ' Weight Loss Starter ',
      created_by: PROVIDER_ID,
      items: [LINE, { ...LINE, formulation_id: 'a7000000-0000-0000-0000-000000000002', dose_amount: '1', dose_unit: 'capsule', frequency_code: 'QD', default_refills: 2 }],
    }))
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ data: { protocol_id: PROTOCOL_ID, name: 'Weight Loss Starter', item_count: 2 } })

    const template = inserts.find(i => i.table === 'protocol_templates')?.row
    expect(template).toEqual(expect.objectContaining({ clinic_id: CLINIC_ID, created_by: PROVIDER_ID, name: 'Weight Loss Starter', is_active: true }))

    const items = inserts.find(i => i.table === 'protocol_items')?.row as Array<Record<string, unknown>>
    expect(items).toHaveLength(2)
    expect(items[0]).toEqual(expect.objectContaining({ protocol_id: PROTOCOL_ID, formulation_id: LINE.formulation_id, dose_amount: '10', dose_unit: 'units', frequency_code: 'QW', sig_mode: 'standard', sort_order: 0, default_refills: 0 }))
    expect(items[1]).toEqual(expect.objectContaining({ sort_order: 1, dose_unit: 'capsule', default_refills: 2 }))
  })

  it.each([
    [{ items: [LINE] },                         /name/],
    [{ name: 'x', items: [] },                  /items/],
    [{ name: 'x', items: 'nope' },              /items/],
    [{ name: 'x', items: [{ dose_amount: '1' }] }, /formulation_id/],
  ])('rejects %j with 400 before touching the database', async (body, pattern) => {
    const res = await POST(makeRequest(body))
    expect(res.status).toBe(400)
    expect((await res.json() as { error: string }).error).toMatch(pattern)
    expect(tablesTouched).toEqual([])
  })

  it('refuses a created_by outside the clinic', async () => {
    fixtures['providers:maybeSingle'] = () => ({ data: null, error: null })
    const res = await POST(makeRequest({ name: 'x', created_by: 'someone-else', items: [LINE] }))
    expect(res.status).toBe(403)
    expect(inserts).toEqual([])
  })

  it('removes the template when the items insert fails', async () => {
    fixtures['protocol_items:await'] = () => ({ data: null, error: { message: 'boom' } })
    const res = await POST(makeRequest({ name: 'x', items: [LINE] }))
    expect(res.status).toBe(500)
    expect(deletes).toEqual(['protocol_templates'])
  })

  it('returns 401 without a session and 403 without a clinic', async () => {
    getSessionMock.mockResolvedValueOnce({ data: { session: null } })
    expect((await POST(makeRequest({ name: 'x', items: [LINE] }))).status).toBe(401)
    getSessionMock.mockResolvedValueOnce({ data: { session: { user: { user_metadata: {} } } } })
    expect((await POST(makeRequest({ name: 'x', items: [LINE] }))).status).toBe(403)
  })
})
