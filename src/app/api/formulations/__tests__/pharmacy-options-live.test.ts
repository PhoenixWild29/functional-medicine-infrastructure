/**
 * @jest-environment node
 *
 * The builder's pharmacy list excludes a pharmacy that is inactive or
 * deleted — even when its pharmacy_formulations links are still active.
 *
 * On prod the three E2E test pharmacies were soft-deleted on 2026-04-23,
 * yet still appeared for Semaglutide Injectable 5 mg/mL: level=
 * pharmacy_options filtered the pharmacy_formulations row but never the
 * pharmacy's own is_active / deleted_at.
 */

import { GET } from '../route'
import type { NextRequest } from 'next/server'
import { fakeDb } from '@/lib/orders/__tests__/fake-db'

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockResolvedValue({
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u1', user_metadata: { clinic_id: 'c1', app_role: 'provider' } } } } }) },
  }),
}))
let db: ReturnType<typeof fakeDb>
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))

const FORM = 'f-sema'
const pf = (id: string, pharmacy: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
  pharmacy_formulation_id: id, formulation_id: FORM, pharmacy_id: pharmacy['pharmacy_id'],
  wholesale_price: 95, available_supply_durations: null, estimated_turnaround_days: 5,
  is_available: true, is_active: true, deleted_at: null,
  pharmacies: pharmacy, pharmacy_formulation_packages: [],
  ...over,
})
const pharmacy = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  pharmacy_id: id, name, slug: id, integration_tier: 'TIER_2_PORTAL', fax_number: null,
  supports_real_time_status: false, is_active: true, deleted_at: null, ...over,
})

function request(qs: string) {
  return { url: `https://app.test/api/formulations?${qs}` } as unknown as NextRequest
}

async function optionNames(qs: string) {
  const res = await GET(request(qs))
  expect(res.status).toBe(200)
  const body = await res.json() as { data: Array<{ pharmacies: { name: string } }> }
  return body.data.map(o => o.pharmacies.name)
}

beforeEach(() => {
  db = fakeDb({
    pharmacy_formulations: [
      pf('pf-strive', pharmacy('ph-strive', 'Strive Pharmacy')),
      // Soft-deleted pharmacy, link still active: the prod case.
      pf('pf-test',   pharmacy('ph-test', 'Test Pharmacy Tier1', { deleted_at: '2026-04-23T00:00:00Z' })),
      pf('pf-paused', pharmacy('ph-paused', 'Paused Pharmacy', { is_active: false })),
    ],
    pharmacy_state_licenses: [
      { pharmacy_id: 'ph-strive', state_code: 'TX', is_active: true },
      { pharmacy_id: 'ph-test',   state_code: 'TX', is_active: true },
      { pharmacy_id: 'ph-paused', state_code: 'TX', is_active: true },
    ],
  })
})

describe('GET /api/formulations?level=pharmacy_options', () => {
  it('excludes a pharmacy that is soft-deleted but still has active links', async () => {
    expect(await optionNames(`level=pharmacy_options&formulation_id=${FORM}&state=TX`)).toEqual(['Strive Pharmacy'])
  })

  it('excludes it without a patient state too', async () => {
    expect(await optionNames(`level=pharmacy_options&formulation_id=${FORM}`)).toEqual(['Strive Pharmacy'])
  })

  it('a licence read that failed is an error, not "every pharmacy is unlicensed"', async () => {
    db.failOn('pharmacy_state_licenses:select')
    const res = await GET(request(`level=pharmacy_options&formulation_id=${FORM}&state=TX`))
    expect(res.status).toBeGreaterThanOrEqual(500)
  })
})
