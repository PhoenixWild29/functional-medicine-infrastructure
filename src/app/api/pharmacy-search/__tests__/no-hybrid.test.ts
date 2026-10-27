/**
 * @jest-environment node
 *
 * Decision 8 (docs/decisions/before-real-patients-2026-10-25.md): Hybrid
 * (TIER_3_HYBRID) is never offered to a prescriber. The routing engine
 * fails such an order (tier3_hybrid_unsupported), so the prescriber's
 * pharmacy search and the builder's pharmacy options leave those
 * pharmacies out, and no "Standardized API" badge is shown. It stays
 * disabled in ops setup.
 */

import { NextRequest } from 'next/server'
import { scriptedDb } from '@/__tests__/helpers/scripted-db'

const CLINIC = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ITEM = 'c2000000-0000-0000-0000-000000000001'
const FORMULATION = 'f1000000-0000-4000-8000-000000000001'

let db = scriptedDb(() => undefined)

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u-1', app_metadata: { app_role: 'provider', clinic_id: CLINIC } } }, error: null }) },
  }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.mock('@/lib/compliance/pharmacy-licensure', () => ({
  ...jest.requireActual('@/lib/compliance/pharmacy-licensure'),
  readLicenses: async () => ({ data: [], error: null }),
  checkLicensure: () => ({ ok: true }),
  productIsSterile: async () => false,
}))

import { GET as SEARCH } from '../route'
import { GET as FORMULATIONS } from '@/app/api/formulations/route'
import { isOfferedTier } from '@/lib/pharmacies/offered-tier'

const pharmacy = (id: string, tier: string) => ({
  pharmacy_id: id, name: `${tier} pharmacy`, slug: id, integration_tier: tier, fax_number: null,
  supports_real_time_status: false, average_turnaround_days: 2, is_active: true, deleted_at: null,
  pharmacy_status: 'ACTIVE', facility_type: '503A',
})
const TIERS = ['TIER_1_API', 'TIER_2_PORTAL', 'TIER_3_SPEC', 'TIER_3_HYBRID', 'TIER_4_FAX']

it('the offered tiers: every tier but Hybrid', () => {
  expect(TIERS.filter(isOfferedTier)).toEqual(['TIER_1_API', 'TIER_2_PORTAL', 'TIER_3_SPEC', 'TIER_4_FAX'])
  expect(isOfferedTier(null)).toBe(false)
})

it('the pharmacy search never returns a Hybrid pharmacy, and shows no Hybrid badge', async () => {
  const catalog = TIERS.map((tier, i) => ({
    item_id: `c${i}`, medication_name: 'Semaglutide', form: 'Injectable', dose: '5 mg/mL', wholesale_price: 100 + i,
    dea_schedule: 0, updated_at: new Date().toISOString(), pharmacy_id: `p${i}`, pharmacies: pharmacy(`p${i}`, tier),
  }))
  db = scriptedDb(c => {
    if (c.table !== 'catalog') return undefined
    if (c.single) return { data: catalog[0] }
    return { data: catalog }
  })
  const res = await SEARCH(new NextRequest(`https://app.test/api/pharmacy-search?state=TX&itemId=${ITEM}&form=Injectable`))
  expect(res.status).toBe(200)
  const { results } = await res.json() as { results: { integration_tier: string; tier_badge: { label: string } }[] }
  expect(results.map(r => r.integration_tier)).toEqual(['TIER_1_API', 'TIER_2_PORTAL', 'TIER_3_SPEC', 'TIER_4_FAX'])
  expect(results.map(r => r.tier_badge.label)).not.toContain('Standardized API')
})

it("the builder's pharmacy options leave Hybrid pharmacies out", async () => {
  db = scriptedDb(c => (c.table === 'pharmacy_formulations'
    ? { data: TIERS.map((tier, i) => ({ pharmacy_formulation_id: `pf${i}`, wholesale_price: 100 + i, available_supply_durations: null, estimated_turnaround_days: 2, pharmacies: pharmacy(`p${i}`, tier), pharmacy_formulation_packages: [] })) }
    : undefined))
  const res = await FORMULATIONS(new NextRequest(`https://app.test/api/formulations?level=pharmacy_options&formulation_id=${FORMULATION}&state=TX`))
  expect(res.status).toBe(200)
  const { data } = await res.json() as { data: { pharmacies: { integration_tier: string } }[] }
  expect(data.map(d => d.pharmacies.integration_tier)).toEqual(['TIER_1_API', 'TIER_2_PORTAL', 'TIER_3_SPEC', 'TIER_4_FAX'])
})
