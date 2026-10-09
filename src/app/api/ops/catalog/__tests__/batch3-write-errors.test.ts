/**
 * @jest-environment node
 *
 * Batch 3, PR 3: catalog rollback, sync and upload fail loud on a
 * database error and never report success.
 *
 * Before:
 *   - rollback answered { ok: true } when the version flags failed to
 *     save, and when its undo (re-activating the catalog it had just
 *     removed) failed it said nothing about the pharmacy now having no
 *     active catalog;
 *   - sync and upload read a failed previous-catalog read as an empty
 *     catalog (upload then missed every >10% price change) and a failed
 *     version read as version 0, then replaced the catalog anyway;
 *   - sync answered { ok: true } when catalog_last_synced_at failed to
 *     save; upload's undo failure went unreported.
 * Now each answers 500 with a message that says what state the catalog
 * is in, and a failed read stops before anything is written.
 *
 * The pharmacy catalog API (fetch) is mocked.
 */

import type { NextRequest } from 'next/server'
import { scriptedDb, DB_DOWN, type Script, type ScriptedCall } from '@/__tests__/helpers/scripted-db'
import { POST as rollback } from '../rollback/route'
import { POST as sync } from '../sync/[pharmacyId]/route'
import { POST as upload } from '../upload/route'

let db = scriptedDb(() => undefined)

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockResolvedValue({
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u1', email: 'ops@test', app_metadata: { app_role: 'ops_admin' } } } } }) },
  }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))

const fetchMock = jest.fn()
beforeAll(() => { (global as { fetch: unknown }).fetch = fetchMock })
beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue({ ok: true, status: 200, json: async () => [{ medication_name: 'Sema', form: 'Inj', dose: '5mg', wholesale_price: 100 }] })
})

jest.spyOn(console, 'error').mockImplementation(() => {})
jest.spyOn(console, 'info').mockImplementation(() => {})

const PHARMACY_ID = 'a4000000-0000-4000-8000-000000000001'
const HISTORY_ID  = 'b4000000-0000-4000-8000-000000000001'

const writes = () => db.calls.filter(c => c.op !== 'select')
const isSoftDelete = (c: ScriptedCall) => c.table === 'catalog' && c.op === 'update' && (c.payload as Record<string, unknown>)['is_active'] === false

async function run(handler: () => Promise<Response>) {
  const res = await handler()
  return { status: res.status, body: await res.json() as Record<string, unknown> }
}

function expectSafe500(r: { status: number; body: Record<string, unknown> }) {
  expect(r.status).toBe(500)
  expect(r.body['ok']).toBeUndefined()
  expect(String(r.body['error'])).not.toMatch(/connection reset/)
}

// ─────────────────────────────────────────────────────────────
describe('rollback', () => {
  const healthy = (more: Script): Script => c => {
    const m = more(c)
    if (m) return m
    if (c.table === 'catalog_upload_history' && c.op === 'select') return { data: { history_id: HISTORY_ID, pharmacy_id: PHARMACY_ID, version_number: 3, is_active: false } }
    if (c.table === 'catalog' && c.op === 'update' && c.filters['upload_history_id']) return { data: [{ item_id: 'i-1' }] }
    return undefined
  }
  const go = (more: Script) => {
    db = scriptedDb(healthy(more))
    return run(() => rollback({ json: async () => ({ pharmacyId: PHARMACY_ID, targetHistoryId: HISTORY_ID }) } as unknown as NextRequest))
  }

  it('a failed version-flag write answers 500, never ok: true', async () => {
    const r = await go(c => (c.table === 'catalog_upload_history' && c.op === 'update' && (c.payload as Record<string, unknown>)['is_active'] === false ? DB_DOWN : undefined))
    expectSafe500(r)
    expect(String(r.body['error'])).toMatch(/restored, but the active version could not be recorded/)
  })

  it('a failed target-version activation answers 500, never ok: true', async () => {
    const r = await go(c => (c.table === 'catalog_upload_history' && c.op === 'update' && (c.payload as Record<string, unknown>)['is_active'] === true ? DB_DOWN : undefined))
    expectSafe500(r)
  })

  it('a failed undo says the pharmacy has no active catalog', async () => {
    const r = await go(c => {
      if (c.table === 'catalog' && c.op === 'update' && c.filters['upload_history_id']) return DB_DOWN // restore fails
      if (c.table === 'catalog' && c.op === 'update' && c.filters['deleted_at'] !== undefined) return DB_DOWN // undo fails
      return undefined
    })
    expectSafe500(r)
    expect(String(r.body['error'])).toMatch(/no active catalog/)
  })

  it('a failed undo after an empty restore is a 500 too, not the 409 "no items"', async () => {
    const r = await go(c => {
      if (c.table === 'catalog' && c.op === 'update' && c.filters['upload_history_id']) return { data: [] }
      if (c.table === 'catalog' && c.op === 'update' && c.filters['deleted_at'] !== undefined) return DB_DOWN
      return undefined
    })
    expectSafe500(r)
    expect(String(r.body['error'])).toMatch(/no active catalog/)
  })
})

// ─────────────────────────────────────────────────────────────
describe('sync', () => {
  const healthy = (more: Script): Script => c => {
    const m = more(c)
    if (m) return m
    if (c.table === 'pharmacies' && c.op === 'select') return { data: { pharmacy_id: PHARMACY_ID, name: 'Acme', integration_tier: 'TIER_1_API' } }
    if (c.table === 'pharmacy_api_configs') return { data: { base_url: 'https://pharm.test' } }
    if (c.table === 'catalog' && c.op === 'select') return { data: [] }
    if (c.table === 'catalog_upload_history' && c.op === 'select') return { data: { version_number: 2 } }
    if (c.table === 'catalog_upload_history' && c.op === 'insert') return { data: { history_id: HISTORY_ID } }
    if (c.table === 'catalog' && c.op === 'insert') return { data: [{ item_id: 'i-1' }] }
    return undefined
  }
  const go = (more: Script) => {
    db = scriptedDb(healthy(more))
    return run(() => sync({} as NextRequest, { params: Promise.resolve({ pharmacyId: PHARMACY_ID }) }))
  }

  it('a failed previous-catalog read answers 500 before anything is written', async () => {
    const r = await go(c => (c.table === 'catalog' && c.op === 'select' ? DB_DOWN : undefined))
    expectSafe500(r)
    expect(writes()).toHaveLength(0)
  })

  it('a failed version read answers 500 before anything is written', async () => {
    const r = await go(c => (c.table === 'catalog_upload_history' && c.op === 'select' ? DB_DOWN : undefined))
    expectSafe500(r)
    expect(writes()).toHaveLength(0)
  })

  it('a failed last-synced write answers 500, never ok: true, and says the catalog was replaced', async () => {
    const r = await go(c => (c.table === 'pharmacies' && c.op === 'update' ? DB_DOWN : undefined))
    expectSafe500(r)
    expect(String(r.body['error'])).toMatch(/replaced \(version 3\), but the sync time could not be saved/)
  })
})

// ─────────────────────────────────────────────────────────────
describe('upload', () => {
  const ROWS = [{ medication_name: 'Sema', form: 'Inj', dose: '5mg', wholesale_price: 100, regulatory_status: 'ACTIVE' }]
  const healthy = (more: Script): Script => c => {
    const m = more(c)
    if (m) return m
    if (c.table === 'pharmacies') return { data: { pharmacy_id: PHARMACY_ID, name: 'Acme' } }
    if (c.table === 'catalog' && c.op === 'select') return { data: [] }
    if (c.table === 'catalog_upload_history' && c.op === 'select') return { data: { version_number: 2 } }
    if (c.table === 'catalog_upload_history' && c.op === 'insert') return { data: { history_id: HISTORY_ID } }
    if (c.table === 'catalog' && c.op === 'insert') return { data: [{ item_id: 'i-1' }] }
    return undefined
  }
  const go = (more: Script) => {
    db = scriptedDb(healthy(more))
    return run(() => upload({ json: async () => ({ pharmacyId: PHARMACY_ID, rows: ROWS }) } as unknown as NextRequest))
  }

  it('a failed previous-catalog read answers 500 instead of skipping the price-change check', async () => {
    const r = await go(c => (c.table === 'catalog' && c.op === 'select' ? DB_DOWN : undefined))
    expectSafe500(r)
    expect(writes()).toHaveLength(0)
  })

  it('a failed version read answers 500 before anything is written', async () => {
    const r = await go(c => (c.table === 'catalog_upload_history' && c.op === 'select' ? DB_DOWN : undefined))
    expectSafe500(r)
    expect(writes()).toHaveLength(0)
  })

  it('a failed undo after a failed insert says the pharmacy has no active catalog', async () => {
    const r = await go(c => {
      if (c.table === 'catalog' && c.op === 'insert') return DB_DOWN
      if (c.table === 'catalog' && c.op === 'update' && !isSoftDelete(c)) return DB_DOWN
      return undefined
    })
    expectSafe500(r)
    expect(String(r.body['error'])).toMatch(/no active catalog/)
  })
})

