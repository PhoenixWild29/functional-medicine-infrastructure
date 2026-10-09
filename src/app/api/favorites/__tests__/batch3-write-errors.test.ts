/**
 * @jest-environment node
 *
 * Batch 3, PR 3: favorites fail loud on a database error.
 *
 * Before, each lookup read a failure as "no row": a failed provider list
 * answered 403 "Provider not in clinic" (and GET showed no favorites); a
 * failed patient check answered 403 "Patient not in clinic"; a failed
 * category lookup saved the favorite under the default group; a failed
 * read of the favorite answered 404; a failed pharmacy-offering read
 * answered 400 "does not offer this formulation". Now each answers 500
 * with a message that leaks nothing, and nothing is written.
 */

import type { NextRequest } from 'next/server'
import { scriptedDb, DB_DOWN, type Script } from '@/__tests__/helpers/scripted-db'
import { GET, POST, PATCH, DELETE } from '../route'

let db = scriptedDb(() => undefined)

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: 'u1', app_metadata: { clinic_id: 'c-1' } } } }) },
  }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))

jest.spyOn(console, 'error').mockImplementation(() => {})

const PROVIDERS = { data: [{ provider_id: 'pr-1' }] }

/** Healthy answers unless `more` answers first. */
const healthy = (more: Script): Script => c => {
  const m = more(c)
  if (m) return m
  if (c.table === 'providers') return PROVIDERS
  if (c.table === 'patients') return { data: { patient_id: 'pt-1' } }
  if (c.table === 'provider_favorites' && c.op === 'select' && c.single) {
    return { data: { provider_id: 'pr-1', formulation_id: 'f-1', use_count: 0 } }
  }
  if (c.table === 'provider_favorites' && c.op === 'select') return { data: [] }
  if (c.table === 'provider_favorites') return { data: { favorite_id: 'fav-1' } }
  return undefined
}

async function call(handler: (r: NextRequest) => Promise<Response>, script: Script, url: string, body?: unknown) {
  db = scriptedDb(healthy(script))
  const res = await handler({
    url,
    json: async () => { if (body === undefined) throw new Error('no body'); return body },
  } as unknown as NextRequest)
  return { status: res.status, body: await res.json() as Record<string, unknown> }
}

const NEW_FAVORITE = { provider_id: 'pr-1', formulation_id: 'f-1', label: 'Sema weekly', dose_presets: [{ dose: '20', unit: 'units', frequency: 'QD', timing: '', duration: '', label: null }] }
const URL_ = 'https://app.test/api/favorites'

function expectSafe500(r: { status: number; body: Record<string, unknown> }) {
  expect(r.status).toBe(500)
  expect(String(r.body['error'])).not.toMatch(/connection reset/)
}

describe('POST', () => {
  it('a failed provider-list read answers 500, not 403 "Provider not in clinic"', async () => {
    const r = await call(POST, c => (c.table === 'providers' ? DB_DOWN : undefined), URL_, NEW_FAVORITE)
    expectSafe500(r)
    expect(db.to('provider_favorites', 'insert')).toHaveLength(0)
  })

  it('a failed patient check answers 500, not 403 "Patient not in clinic"', async () => {
    const r = await call(POST, c => (c.table === 'patients' ? DB_DOWN : undefined), URL_, { ...NEW_FAVORITE, patient_id: 'pt-1' })
    expectSafe500(r)
    expect(db.to('provider_favorites', 'insert')).toHaveLength(0)
  })

  it('a failed category lookup answers 500 instead of saving the favorite under the default group', async () => {
    const r = await call(POST, c => (c.table === 'formulations' ? DB_DOWN : undefined), URL_, NEW_FAVORITE)
    expectSafe500(r)
    expect(db.to('provider_favorites', 'insert')).toHaveLength(0)
  })

  it.each(['salt_forms', 'formulation_ingredients', 'ingredients'])('a failed %s read in the category lookup answers 500', async table => {
    const r = await call(POST, c => {
      if (c.table === table) return DB_DOWN
      if (c.table === 'formulations') return { data: { salt_form_id: table === 'salt_forms' ? 'sf-1' : null } }
      if (c.table === 'formulation_ingredients') return { data: [{ ingredient_id: 'i-1', role: 'primary' }] }
      return undefined
    }, URL_, NEW_FAVORITE)
    expectSafe500(r)
    expect(db.to('provider_favorites', 'insert')).toHaveLength(0)
  })
})

describe('PATCH', () => {
  it('a failed read of the favorite answers 500, not 404', async () => {
    const r = await call(PATCH, c => (c.table === 'provider_favorites' && c.op === 'select' ? DB_DOWN : undefined), `${URL_}?id=fav-1`)
    expectSafe500(r)
    expect(db.to('provider_favorites', 'update')).toHaveLength(0)
  })

  it('a failed pharmacy-offering read answers 500, not 400 "does not offer"', async () => {
    const r = await call(PATCH, c => (c.table === 'pharmacy_formulations' ? DB_DOWN : undefined), `${URL_}?id=fav-1`, { pharmacy_id: 'ph-1' })
    expectSafe500(r)
    expect(db.to('provider_favorites', 'update')).toHaveLength(0)
  })

  it('a failed provider-list read answers 500, not 403', async () => {
    const r = await call(PATCH, c => (c.table === 'providers' ? DB_DOWN : undefined), `${URL_}?id=fav-1`)
    expectSafe500(r)
  })
})

describe('DELETE', () => {
  it('a failed read of the favorite answers 500, not 404', async () => {
    const r = await call(DELETE, c => (c.table === 'provider_favorites' && c.op === 'select' ? DB_DOWN : undefined), `${URL_}?id=fav-1`)
    expectSafe500(r)
    expect(db.to('provider_favorites', 'delete')).toHaveLength(0)
  })
})

describe('GET', () => {
  it('a failed provider-list read answers 500, not an empty list', async () => {
    const r = await call(GET, c => (c.table === 'providers' ? DB_DOWN : undefined), URL_)
    expectSafe500(r)
  })
})
