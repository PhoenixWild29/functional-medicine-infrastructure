/**
 * @jest-environment node
 *
 * Compliance C8: PUT /api/ops/ingredients/[ingredientId]/compounding.
 *
 * Ops records an ingredient's compounding status, whether it has a
 * marketed FDA-approved equivalent, and whether that product is on FDA's
 * shortage list. Every change carries a source and is stamped with who
 * reviewed it and when (the database trigger then writes the audit row).
 *
 *   - ops_admin only (any other role 403; no verified user 401);
 *   - a status from the agreed list, both flags as booleans, and a source
 *     of 3 to 300 characters, or 400 and nothing written;
 *   - an ingredient that does not exist is 404; a failed write is 500.
 */

import { NextRequest } from 'next/server'
import { scriptedDb, DB_DOWN } from '@/__tests__/helpers/scripted-db'
import { userFromSession, withForgedSession } from '@/__tests__/helpers/auth-from-session'

const ING = 'b1000000-0000-4000-8000-000000000006'

let user: Record<string, unknown> | null = null
let db = scriptedDb(() => undefined)

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({
    auth: {
      getSession: async () => ({ data: { session: user ? { user } : null } }),
      getUser: async () => userFromSession({ data: { session: user ? { user } : null } }),
    },
  }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))

import { PUT } from '../[ingredientId]/compounding/route'

const as = (role: string) => ({ id: `u-${role}`, email: `${role}@x.example`, app_metadata: { app_role: role } })
const req = (body: unknown) => new NextRequest('https://app.test/api/ops/ingredients/x/compounding', { method: 'PUT', body: JSON.stringify(body) })
const params = (ingredientId = ING) => ({ params: Promise.resolve({ ingredientId }) })
const GOOD = { status: 'pending_evaluation', commercialEquivalent: false, onFdaShortage: false, source: 'FDA 503A categories page, 2026-04-15' }

beforeEach(() => {
  user = as('ops_admin')
  db = scriptedDb(c => (c.table === 'ingredients' && c.op === 'update' ? { data: { ingredient_id: ING } } : undefined))
  for (const level of ['info', 'warn', 'error'] as const) jest.spyOn(console, level).mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

it('ops records the status, flags and source, stamped with who reviewed it and when', async () => {
  const res = await PUT(req(GOOD), params())
  expect(res.status).toBe(200)
  const [w] = db.to('ingredients', 'update')
  expect(w!.filters).toEqual(expect.objectContaining({ ingredient_id: ING }))
  expect(w!.payload).toEqual({
    compounding_status:             'pending_evaluation',
    commercial_equivalent:          false,
    on_fda_shortage:                false,
    compounding_status_source:      'FDA 503A categories page, 2026-04-15',
    compounding_status_reviewed_at: expect.any(String),
    compounding_status_reviewed_by: 'u-ops_admin',
  })
  expect(Date.parse(String((w!.payload as Record<string, unknown>)['compounding_status_reviewed_at']))).not.toBeNaN()
})

it.each([
  [{ ...GOOD, status: 'probably_fine' }, /status/],
  [{ ...GOOD, status: undefined }, /status/],
  [{ ...GOOD, commercialEquivalent: 'yes' }, /commercialEquivalent/],
  [{ ...GOOD, onFdaShortage: undefined }, /onFdaShortage/],
  [{ ...GOOD, source: '' }, /source/],
  [{ ...GOOD, source: 'ok' }, /source/],
  [{ ...GOOD, source: 'x'.repeat(301) }, /source/],
])('%j is 400, nothing written', async (body, msg) => {
  const res = await PUT(req(body), params())
  expect(res.status).toBe(400)
  expect((await res.json()).error).toMatch(msg)
  expect(db.to('ingredients', 'update')).toHaveLength(0)
})

it('an invalid ingredient id is 400', async () => {
  expect((await PUT(req(GOOD), params('not-a-uuid'))).status).toBe(400)
})

it.each(['clinic_admin', 'provider', 'medical_assistant'])('a %s cannot change it (403)', async role => {
  user = as(role)
  expect((await PUT(req(GOOD), params())).status).toBe(403)
  expect(db.to('ingredients', 'update')).toHaveLength(0)
})

it('no signed-in user: 401', async () => {
  user = null
  expect((await PUT(req(GOOD), params())).status).toBe(401)
})

it('a token that does not verify: 401', async () => {
  expect((await withForgedSession(() => PUT(req(GOOD), params()))).status).toBe(401)
})

it('an ingredient that does not exist: 404', async () => {
  db = scriptedDb(c => (c.table === 'ingredients' && c.op === 'update' ? { data: null } : undefined))
  expect((await PUT(req(GOOD), params())).status).toBe(404)
})

it('a write that fails: 500', async () => {
  db = scriptedDb(c => (c.table === 'ingredients' && c.op === 'update' ? DB_DOWN : undefined))
  expect((await PUT(req(GOOD), params())).status).toBe(500)
})
