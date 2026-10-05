/**
 * @jest-environment node
 *
 * Batch 3, PR 3: creating a protocol fails loud.
 *
 * Before, a failed check that the creator belongs to the clinic answered
 * 403 "Provider not in clinic", and when the items insert failed and its
 * cleanup (deleting the just-created template) failed too, the empty
 * template stayed in the list with nothing said. Both responses also
 * passed the raw database message to the client. Now: 500 with a safe
 * message, and the cleanup failure is named.
 */

import type { NextRequest } from 'next/server'
import { scriptedDb, DB_DOWN, type Script } from '@/__tests__/helpers/scripted-db'
import { POST } from '../route'

let db = scriptedDb(() => undefined)

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockResolvedValue({
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u1', user_metadata: { clinic_id: 'c-1' } } } } }) },
  }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))

jest.spyOn(console, 'error').mockImplementation(() => {})

const BODY = { name: 'Weight loss', created_by: 'pr-1', items: [{ formulation_id: 'f-1' }] }

async function create(more: Script) {
  db = scriptedDb(c => more(c) ?? (
    c.table === 'providers' ? { data: { provider_id: 'pr-1' } }
    : c.table === 'protocol_templates' && c.op === 'insert' ? { data: { protocol_id: 'p-1', name: 'Weight loss' } }
    : undefined))
  const res = await POST({ json: async () => BODY } as unknown as NextRequest)
  return { status: res.status, body: await res.json() as Record<string, unknown> }
}

it('a failed creator check answers 500, not 403 "Provider not in clinic"', async () => {
  const r = await create(c => (c.table === 'providers' ? DB_DOWN : undefined))
  expect(r.status).toBe(500)
  expect(String(r.body['error'])).not.toMatch(/connection reset|not in clinic/)
  expect(db.to('protocol_templates', 'insert')).toHaveLength(0)
})

it('a failed items insert with a failed cleanup names the empty protocol left behind', async () => {
  const r = await create(c => {
    if (c.table === 'protocol_items') return DB_DOWN
    if (c.table === 'protocol_templates' && c.op === 'delete') return DB_DOWN
    return undefined
  })
  expect(r.status).toBe(500)
  expect(String(r.body['error'])).toMatch(/empty protocol "Weight loss"/)
  expect(String(r.body['error'])).not.toMatch(/connection reset/)
})

it('a failed items insert with a successful cleanup says nothing was saved', async () => {
  const r = await create(c => (c.table === 'protocol_items' ? DB_DOWN : undefined))
  expect(r.status).toBe(500)
  expect(String(r.body['error'])).toMatch(/Nothing was saved/)
  expect(String(r.body['error'])).not.toMatch(/connection reset/)
})
