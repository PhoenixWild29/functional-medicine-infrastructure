/**
 * @jest-environment node
 *
 * POST /api/spec/v1/webhooks/register: the internal token first, then the
 * body. The pharmacy id is an id, the event types are the spec's closed
 * list, and the URL and secret are bounded, before anything is read or
 * written (a bad id reaching Postgres is error 22P02).
 */

import type { NextRequest } from 'next/server'
import { scriptedDb } from '@/__tests__/helpers/scripted-db'
import { POST } from '../route'

const TOKEN    = 'internal-token-for-tests'
const PHARMACY = 'a4000000-0000-0000-0000-000000000004'
const SECRET   = 's'.repeat(40)

let db = scriptedDb(() => undefined)
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.spyOn(console, 'error').mockImplementation(() => {})
jest.spyOn(console, 'info').mockImplementation(() => {})

function req(body: unknown, token: string | null = TOKEN) {
  return {
    headers: new Headers(token ? { 'x-internal-token': token } : {}),
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  } as unknown as NextRequest
}
const good = (over: Record<string, unknown> = {}) => ({
  pharmacy_id: PHARMACY, callback_url: 'https://api.pharmacy.test/hooks', event_types: ['order.shipped'], secret: SECRET, ...over,
})

beforeEach(() => {
  process.env['ADAPTER_INTERNAL_SECRET'] = TOKEN
  process.env['WEBHOOK_SECRET_ENCRYPTION_KEY'] = 'ab'.repeat(32)
  db = scriptedDb(c => {
    if (c.table === 'pharmacies') return { data: { pharmacy_id: PHARMACY, integration_tier: 'TIER_3_SPEC', is_active: true } }
    if (c.table === 'pharmacy_api_configs' && c.op === 'select') return { data: { config_id: 'cfg-1' } }
    return undefined
  })
})
afterAll(() => {
  delete process.env['ADAPTER_INTERNAL_SECRET']
  delete process.env['WEBHOOK_SECRET_ENCRYPTION_KEY']
})

it('a good registration (seeded, non-v4 pharmacy id) is saved', async () => {
  const res = await POST(req(good()))
  expect(res.status).toBe(200)
  expect(db.to('pharmacy_api_configs', 'update')).toHaveLength(1)
})

it('no token or a wrong token: 401 before the body is read', async () => {
  expect((await POST(req(good(), null))).status).toBe(401)
  expect((await POST(req(good(), 'wrong'))).status).toBe(401)
  expect(db.calls).toHaveLength(0)
})

it('a body that is JSON null: 400, not a thrown 500', async () => {
  expect((await POST(req('null'))).status).toBe(400)
  expect(db.calls).toHaveLength(0)
})

it.each([
  ['a pharmacy_id that is not an id', good({ pharmacy_id: 'ph-1' }), 'pharmacy_id'],
  ['an unknown event type', good({ event_types: ['order.shipped', 'order.teleported'] }), 'event_types.1'],
  ['an event type that is not a string', good({ event_types: [42] }), 'event_types.0'],
  ['an oversize callback_url', good({ callback_url: `https://api.pharmacy.test/${'x'.repeat(2048)}` }), 'callback_url'],
  ['an oversize secret', good({ secret: 's'.repeat(1025) }), 'secret'],
])('%s: 400, nothing read or written', async (_what, body, field) => {
  const res = await POST(req(body))
  expect(res.status).toBe(400)
  expect(await res.json()).toEqual({ error: 'Invalid request', fields: [field] })
  expect(db.calls).toHaveLength(0)
})

it('the existing messages stay', async () => {
  expect(await (await POST(req(good({ pharmacy_id: undefined })))).json()).toEqual({ error: 'pharmacy_id is required' })
  expect(await (await POST(req(good({ secret: 'short' })))).json()).toEqual({ error: 'secret must be at least 32 characters' })
  expect(await (await POST(req(good({ callback_url: 'http://api.pharmacy.test/hooks' })))).json()).toEqual({ error: 'callback_url must use HTTPS' })
})

it('no event types (or an empty list) still means every event', async () => {
  expect((await POST(req(good({ event_types: [] })))).status).toBe(200)
  expect((await POST(req(good({ event_types: undefined })))).status).toBe(200)
})
