/**
 * @jest-environment node
 *
 * GET /api/formulations?level=formulations&ingredient_id=… returns that
 * ingredient's formulations: the single-ingredient products linked
 * through its salt forms (formulations.salt_form_id) and the combination
 * products that list it in formulation_ingredients.
 *
 * Before, the case read ingredient_id and ignored it, so the request
 * returned every formulation in the catalog (the header documents the
 * parameter; the builder sends the ingredient in its query key).
 */

import { GET } from '../route'
import type { NextRequest } from 'next/server'
import { fakeDb } from '@/lib/orders/__tests__/fake-db'

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: 'u1', app_metadata: { clinic_id: 'c1', app_role: 'provider' } } } }) },
  }),
}))
let db: ReturnType<typeof fakeDb>
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))

const formulation = (formulation_id: string, salt_form_id: string | null, over: Record<string, unknown> = {}) => ({
  formulation_id, name: formulation_id, salt_form_id, dosage_form_id: 'b3000000-0000-0000-0000-00000000000a', route_id: 'rt-sc',
  is_active: true, deleted_at: null, ...over,
})

beforeEach(() => {
  db = fakeDb({
    salt_forms: [
      { salt_form_id: 'b2000000-0000-0000-0000-00000000000a', ingredient_id: 'b1000000-0000-0000-0000-00000000000a' },
      { salt_form_id: 'b2000000-0000-0000-0000-00000000000b', ingredient_id: 'b1000000-0000-0000-0000-00000000000a' },
      { salt_form_id: 'b2000000-0000-0000-0000-00000000000c', ingredient_id: 'b1000000-0000-0000-0000-00000000000b' },
    ],
    formulation_ingredients: [
      { formulation_id: 'f-sema-b12', ingredient_id: 'b1000000-0000-0000-0000-00000000000a' },
      { formulation_id: 'f-sema-b12', ingredient_id: 'b1000000-0000-0000-0000-00000000000c' },
    ],
    formulations: [
      formulation('f-sema-5', 'b2000000-0000-0000-0000-00000000000a'),
      formulation('f-sema-ac', 'b2000000-0000-0000-0000-00000000000b', { dosage_form_id: 'b3000000-0000-0000-0000-00000000000b', route_id: 'rt-po' }),
      formulation('f-sema-b12', null, { is_combination: true }),
      formulation('f-testo-200', 'b2000000-0000-0000-0000-00000000000c'),
      formulation('f-sema-old', 'b2000000-0000-0000-0000-00000000000a', { is_active: false }),
    ],
  })
})

async function ids(qs: string): Promise<string[]> {
  const res = await GET({ url: `https://app.test/api/formulations?level=formulations&${qs}` } as unknown as NextRequest)
  expect(res.status).toBe(200)
  const body = await res.json() as { data: Array<{ formulation_id: string }> }
  return body.data.map(f => f.formulation_id).sort()
}

it('ingredient_id: its salt-form products and the combinations that contain it, nothing else', async () => {
  expect(await ids('ingredient_id=b1000000-0000-0000-0000-00000000000a')).toEqual(['f-sema-5', 'f-sema-ac', 'f-sema-b12'])
  expect(await ids('ingredient_id=b1000000-0000-0000-0000-00000000000b')).toEqual(['f-testo-200'])
})

it('an ingredient with no products returns none (not the whole catalog)', async () => {
  expect(await ids('ingredient_id=b1000000-0000-0000-0000-0000000000ff')).toEqual([])
})

it('ingredient_id narrows together with the other filters', async () => {
  expect(await ids('ingredient_id=b1000000-0000-0000-0000-00000000000a&dosage_form_id=b3000000-0000-0000-0000-00000000000a')).toEqual(['f-sema-5', 'f-sema-b12'])
  expect(await ids('ingredient_id=b1000000-0000-0000-0000-00000000000a&salt_form_id=b2000000-0000-0000-0000-00000000000b')).toEqual(['f-sema-ac'])
})

it('without ingredient_id: unchanged (every active formulation; by salt form)', async () => {
  expect(await ids('')).toEqual(['f-sema-5', 'f-sema-ac', 'f-sema-b12', 'f-testo-200'])
  expect(await ids('salt_form_id=b2000000-0000-0000-0000-00000000000a')).toEqual(['f-sema-5'])
})

it('a failed ingredient lookup is an error, not "no filter"', async () => {
  db.failOn('salt_forms:select')
  const res = await GET({ url: 'https://app.test/api/formulations?level=formulations&ingredient_id=b1000000-0000-0000-0000-00000000000a' } as unknown as NextRequest)
  expect(res.status).toBeGreaterThanOrEqual(500)
})
