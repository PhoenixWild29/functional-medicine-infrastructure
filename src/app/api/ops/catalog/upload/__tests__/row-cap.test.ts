/**
 * @jest-environment node
 *
 * Security review follow-up (L14): POST /api/ops/catalog/upload enforces
 * the catalog row cap on the server (MAX_CATALOG_ROWS, the same limit the
 * pharmacy onboarding catalog uses), not only in the browser. Over the cap
 * it answers 400 before any database read.
 */

import { NextRequest } from 'next/server'
import { MAX_CATALOG_ROWS } from '@/lib/pharmacy-onboarding/application'

const service = jest.fn(() => { throw new Error('the database was read') })
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'ops-1', email: 'ops@compoundiq.test', app_metadata: { app_role: 'ops_admin' } } } }) } }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => service() }))

import { POST } from '../route'

const PHARMACY = '11111111-1111-4111-8111-111111111111'
const row = { formulation_id: 'f', wholesale_price: '10.00' }
const req = (rows: unknown[]) => new NextRequest('https://app.test/api/ops/catalog/upload', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pharmacyId: PHARMACY, rows }),
})

it(`over ${MAX_CATALOG_ROWS} rows: 400 and no database read`, async () => {
  const res = await POST(req(Array.from({ length: MAX_CATALOG_ROWS + 1 }, () => row)))
  expect(res.status).toBe(400)
  expect((await res.json() as { error: string }).error).toBe(`A catalog upload can have at most ${MAX_CATALOG_ROWS} rows.`)
  expect(service).not.toHaveBeenCalled()
})

it('exactly the cap passes the check (and goes on to the database)', async () => {
  service.mockClear()
  await expect(POST(req(Array.from({ length: MAX_CATALOG_ROWS }, () => row)))).rejects.toThrow('the database was read')
  expect(service).toHaveBeenCalled()
})
