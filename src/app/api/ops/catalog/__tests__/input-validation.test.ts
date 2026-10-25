/**
 * @jest-environment node
 *
 * Input validation: the ops catalog routes (GET /api/ops/catalog, POST and
 * PATCH /api/ops/catalog/item, POST rollback, POST upload, POST sync).
 *
 *   - ops_admin only, before anything is read;
 *   - ids are any 8-4-4-4-12 hex id: the seeded demo ids are not RFC v4,
 *     and the old v4-only checks refused them;
 *   - the status filter is a regulatory status (an unknown one reached
 *     Postgres as an invalid enum value: a 500), the search is at most 200
 *     characters;
 *   - a body that is not a JSON object, a text field over its bound, or a
 *     price that is not a number in range is a 400 with nothing written.
 */

import { NextRequest } from 'next/server'
import { scriptedDb } from '@/__tests__/helpers/scripted-db'

const DEMO_PHARMACY = 'a4000000-0000-0000-0000-000000000001'
const DEMO_HISTORY  = 'b4000000-0000-0000-0000-000000000001'
const DEMO_ITEM     = 'c4000000-0000-0000-0000-000000000001'

let user: Record<string, unknown> | null = null
let db = scriptedDb(() => undefined)

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser: async () => ({ data: { user }, error: null }) } }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.spyOn(console, 'error').mockImplementation(() => {})
jest.spyOn(console, 'warn').mockImplementation(() => {})
jest.spyOn(console, 'info').mockImplementation(() => {})

import { GET as list } from '../route'
import { POST as addItem, PATCH as editItem } from '../item/route'
import { POST as rollback } from '../rollback/route'
import { POST as upload } from '../upload/route'
import { POST as sync } from '../sync/[pharmacyId]/route'

const as = (role: string) => ({ id: `u-${role}`, email: `${role}@x.example`, app_metadata: { app_role: role } })
const raw = (body: string, method = 'POST') => new NextRequest('https://app.test/api/ops/catalog/x', { method, body })
const req = (body: unknown, method = 'POST') => raw(JSON.stringify(body), method)
const get = (qs: string) => list(new NextRequest(`https://app.test/api/ops/catalog?${qs}`))
const writes = () => db.calls.filter(c => c.op !== 'select')
const errorOf = async (res: Response) => (await res.json() as { error: string }).error

const ITEM = { pharmacyId: DEMO_PHARMACY, medicationName: 'Semaglutide', form: 'Injection', dose: '5mg/mL', wholesalePrice: 120, regulatoryStatus: 'ACTIVE', retailPrice: null, requiresPriorAuth: false }

beforeEach(() => {
  user = as('ops_admin')
  db = scriptedDb(c => {
    if (c.table === 'catalog' && c.op === 'insert') return { data: { item_id: DEMO_ITEM } }
    if (c.table === 'catalog' && c.op === 'select') return { data: [] }
    if (c.table === 'pharmacies' && c.op === 'select') return { data: null }
    return undefined
  })
})

describe('GET /api/ops/catalog', () => {
  it('a seeded demo pharmacy id is accepted', async () => {
    expect((await get(`pharmacyId=${DEMO_PHARMACY}`)).status).toBe(200)
  })
  it('a malformed pharmacy id is 400 and reads nothing', async () => {
    expect((await get('pharmacyId=nope')).status).toBe(400)
    expect(db.calls).toHaveLength(0)
  })
  it('a known status (any case) is accepted', async () => {
    expect((await get('status=recalled')).status).toBe(200)
  })
  it('an unknown status is 400 and reads nothing', async () => {
    expect((await get('status=BOGUS')).status).toBe(400)
    expect(db.calls).toHaveLength(0)
  })
  it('a search over 200 characters is 400 and reads nothing', async () => {
    expect((await get(`search=${'a'.repeat(201)}`)).status).toBe(400)
    expect(db.calls).toHaveLength(0)
  })
  it('a non-ops role is 403 and reads nothing', async () => {
    user = as('provider')
    expect((await get('')).status).toBe(403)
    expect(db.calls).toHaveLength(0)
  })
})

describe('POST /api/ops/catalog/item', () => {
  it('the shape the catalog manager sends, with a demo pharmacy id, is 201', async () => {
    const res = await addItem(req(ITEM))
    expect(res.status).toBe(201)
  })
  it('a JSON body that is not an object (null) is 400, not a thrown 500', async () => {
    expect((await addItem(raw('null'))).status).toBe(400)
    expect(writes()).toHaveLength(0)
  })
  it('a medication name over 200 characters is 400 with nothing written', async () => {
    expect((await addItem(req({ ...ITEM, medicationName: 'x'.repeat(201) }))).status).toBe(400)
    expect(writes()).toHaveLength(0)
  })
  it('a medication name that is not a string is 400 with nothing written', async () => {
    expect((await addItem(req({ ...ITEM, medicationName: { a: 1 } }))).status).toBe(400)
    expect(writes()).toHaveLength(0)
  })
  it('a retail price that is not a number is 400 (it was written as NaN)', async () => {
    expect((await addItem(req({ ...ITEM, retailPrice: 'abc' }))).status).toBe(400)
    expect(writes()).toHaveLength(0)
  })
  it('a wholesale price above the bound is 400', async () => {
    expect((await addItem(req({ ...ITEM, wholesalePrice: 1e12 }))).status).toBe(400)
    expect(writes()).toHaveLength(0)
  })
  it('an unknown regulatory status keeps its message', async () => {
    const res = await addItem(req({ ...ITEM, regulatoryStatus: 'bogus' }))
    expect(res.status).toBe(400)
    expect(await errorOf(res)).toBe('Invalid regulatoryStatus: BOGUS')
  })
  it('missing name, form or dose keeps its message', async () => {
    const res = await addItem(req({ ...ITEM, dose: '  ' }))
    expect(res.status).toBe(400)
    expect(await errorOf(res)).toBe('Missing required fields: medicationName, form, dose')
  })
  it('a non-ops role is 403 with nothing written', async () => {
    user = as('clinic_admin')
    expect((await addItem(req(ITEM))).status).toBe(403)
    expect(db.calls).toHaveLength(0)
  })
})

describe('PATCH /api/ops/catalog/item', () => {
  it('a seeded demo item id is accepted', async () => {
    expect((await editItem(req({ itemId: DEMO_ITEM, wholesalePrice: 99 }, 'PATCH'))).status).toBe(200)
  })
  it('a malformed item id is 400 with nothing written', async () => {
    const res = await editItem(req({ itemId: 'item-1', wholesalePrice: 99 }, 'PATCH'))
    expect(res.status).toBe(400)
    expect(await errorOf(res)).toBe('Invalid or missing itemId')
    expect(writes()).toHaveLength(0)
  })
  it('a dose over 200 characters is 400 with nothing written', async () => {
    expect((await editItem(req({ itemId: DEMO_ITEM, dose: 'd'.repeat(201) }, 'PATCH'))).status).toBe(400)
    expect(writes()).toHaveLength(0)
  })
  it('a retail price that is not a number is 400 with nothing written', async () => {
    expect((await editItem(req({ itemId: DEMO_ITEM, retailPrice: 'x' }, 'PATCH'))).status).toBe(400)
    expect(writes()).toHaveLength(0)
  })
})

describe('POST /api/ops/catalog/rollback', () => {
  it('seeded demo ids reach the version lookup', async () => {
    const res = await rollback(req({ pharmacyId: DEMO_PHARMACY, targetHistoryId: DEMO_HISTORY }))
    expect(res.status).toBe(404)  // the scripted version lookup finds nothing
    expect(db.to('catalog_upload_history', 'select')).toHaveLength(1)
  })
  it('a JSON body that is not an object (null) is 400, not a thrown 500', async () => {
    expect((await rollback(raw('null'))).status).toBe(400)
    expect(db.calls).toHaveLength(0)
  })
  it('a malformed history id is 400 and reads nothing', async () => {
    expect((await rollback(req({ pharmacyId: DEMO_PHARMACY, targetHistoryId: 'v3' }))).status).toBe(400)
    expect(db.calls).toHaveLength(0)
  })
})

describe('POST /api/ops/catalog/upload', () => {
  const row = { medication_name: 'Sema', form: 'Inj', dose: '5mg', wholesale_price: '100', regulatory_status: 'ACTIVE' }
  it('a seeded demo pharmacy id reaches the pharmacy lookup', async () => {
    const res = await upload(req({ pharmacyId: DEMO_PHARMACY, rows: [row] }))
    expect(res.status).toBe(404)  // the scripted pharmacy lookup finds nothing
    expect(db.to('pharmacies', 'select')).toHaveLength(1)
  })
  it('a JSON body that is not an object (null) is 400, not a thrown 500', async () => {
    expect((await upload(raw('null'))).status).toBe(400)
    expect(db.calls).toHaveLength(0)
  })
  it('a row field over its bound is 400 and reads nothing', async () => {
    expect((await upload(req({ pharmacyId: DEMO_PHARMACY, rows: [{ ...row, medication_name: 'm'.repeat(201) }] }))).status).toBe(400)
    expect(db.calls).toHaveLength(0)
  })
  it('a row that is not an object is 400 and reads nothing', async () => {
    expect((await upload(req({ pharmacyId: DEMO_PHARMACY, rows: ['Sema,Inj'] }))).status).toBe(400)
    expect(db.calls).toHaveLength(0)
  })
})

describe('POST /api/ops/catalog/sync/[pharmacyId]', () => {
  const params = (pharmacyId: string) => ({ params: Promise.resolve({ pharmacyId }) })
  it('a seeded demo pharmacy id reaches the pharmacy lookup', async () => {
    const res = await sync(req({}), params(DEMO_PHARMACY))
    expect(res.status).toBe(404)  // the scripted pharmacy lookup finds nothing
    expect(db.to('pharmacies', 'select')).toHaveLength(1)
  })
  it('a malformed pharmacy id is 400 and reads nothing', async () => {
    expect((await sync(req({}), params('ph-1'))).status).toBe(400)
    expect(db.calls).toHaveLength(0)
  })
})
