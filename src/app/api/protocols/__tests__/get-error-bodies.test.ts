/**
 * @jest-environment node
 *
 * Security review follow-up (M1 remainder): GET /api/protocols never sends
 * a database message to the browser. Each failed read (the list, one
 * protocol, its items, the live prices, formulation liveness, pharmacy
 * licenses) is logged on the server and answered 500 with a plain message.
 */

import type { NextRequest } from 'next/server'
import { scriptedDb, type Script } from '@/__tests__/helpers/scripted-db'
import { GET } from '../route'

let db = scriptedDb(() => undefined)

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: 'u1', app_metadata: { clinic_id: 'c-1' } } } }) },
  }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))

const logged = jest.spyOn(console, 'error').mockImplementation(() => {})

const DB_MESSAGE = 'relation "protocol_templates" does not exist (column clinic_id, constraint protocol_templates_pkey)'
const FAILED = { data: null, error: { message: DB_MESSAGE }, count: null }
const PLAIN = 'Protocols could not be loaded. Try again.'

const ITEM = { item_id: 'i-1', formulation_id: 'f-1', pharmacy_id: 'ph-1', sort_order: 0 }

function happy(): Script {
  return c => {
    if (c.table === 'protocol_templates') return { data: c.filters['protocol_id'] ? { protocol_id: 'p-1', name: 'Weight loss' } : [] }
    if (c.table === 'protocol_items') return { data: [ITEM] }
    if (c.table === 'pharmacy_formulations') return { data: [] }
    if (c.table === 'formulations') return { data: [] }
    if (c.table === 'pharmacy_state_licenses') return { data: [] }
    return undefined
  }
}

async function get(query: string, fail: (table: string) => boolean) {
  const base = happy()
  db = scriptedDb(c => (fail(c.table) ? FAILED : base(c)))
  const res = await GET({ url: `https://app.test/api/protocols${query}` } as unknown as NextRequest)
  return { status: res.status, body: await res.json() as Record<string, unknown> }
}

beforeEach(() => logged.mockClear())

it.each([
  ['the list', '', 'protocol_templates'],
  ['one protocol', '?id=p-1', 'protocol_templates'],
  ['its items', '?id=p-1', 'protocol_items'],
  ['the live prices', '?id=p-1', 'pharmacy_formulations'],
  ['formulation liveness', '?id=p-1', 'formulations'],
  ['pharmacy licenses', '?id=p-1&patient_state=TX', 'pharmacy_state_licenses'],
])('a failed read of %s: 500, a plain message, the database text only in the log', async (_what, query, table) => {
  const r = await get(query, t => t === table)
  expect(r.status).toBe(500)
  expect(r.body).toEqual({ error: PLAIN })
  expect(JSON.stringify(r.body)).not.toMatch(/relation|constraint|column/)
  expect(logged.mock.calls.map(c => c.join(' ')).join('\n')).toContain(DB_MESSAGE)
})

it('a good read still answers 200', async () => {
  expect((await get('', () => false)).status).toBe(200)
  expect((await get('?id=p-1&patient_state=TX', () => false)).status).toBe(200)
})
