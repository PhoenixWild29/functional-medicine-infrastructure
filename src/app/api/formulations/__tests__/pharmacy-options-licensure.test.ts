/**
 * @jest-environment node
 *
 * C5: the builder's pharmacy list (level=pharmacy_options) offers only
 * pharmacies that can lawfully fill this product for this patient: an
 * unexpired, active license in the patient's state and, for a sterile
 * product (an injectable), a license that covers sterile compounding or a
 * 503B outsourcing facility. Before, is_active was the only test: an
 * expired license was offered, and sterile scope was never looked at.
 */

import { GET } from '../route'
import type { NextRequest } from 'next/server'
import { fakeDb } from '@/lib/orders/__tests__/fake-db'

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockResolvedValue({
    auth: {
      getUser: async () => ({ data: { user: { id: 'u1', app_metadata: { clinic_id: 'c1', app_role: 'provider' } } }, error: null }),
    },
  }),
}))
let db: ReturnType<typeof fakeDb>
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))

const pharmacy = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  pharmacy_id: id, name, slug: id, integration_tier: 'TIER_2_PORTAL', fax_number: null,
  supports_real_time_status: false, is_active: true, deleted_at: null, ...over,
})
const pf = (form: string, id: string, ph: Record<string, unknown>) => ({
  pharmacy_formulation_id: `${id}-${form}`, formulation_id: form, pharmacy_id: ph['pharmacy_id'],
  wholesale_price: 95, available_supply_durations: null, estimated_turnaround_days: 5,
  is_available: true, is_active: true, deleted_at: null,
  pharmacies: ph, pharmacy_formulation_packages: [],
})
const license = (pharmacyId: string, over: Record<string, unknown> = {}) => ({
  pharmacy_id: pharmacyId, state_code: 'TX', license_number: `${pharmacyId}-TX`, expiration_date: '2099-12-31',
  is_active: true, deleted_at: null, license_type: 'nonresident_pharmacy', sterile_compounding: true, ...over,
})

const STRIVE  = pharmacy('ph-strive', 'Strive Pharmacy')
const EXPIRED = pharmacy('ph-expired', 'Lapsed Pharmacy')
const NOSTER  = pharmacy('ph-nonsterile', 'Non-Sterile Pharmacy')
const OUTSRC  = pharmacy('ph-503b', 'Outsourcing 503B', { facility_type: '503B' })

beforeEach(() => {
  db = fakeDb({
    formulations: [
      { formulation_id: 'f-inj', dosage_forms: { name: 'Injectable Solution', is_sterile: true } },
      { formulation_id: 'f-cap', dosage_forms: { name: 'Capsule', is_sterile: false } },
    ],
    pharmacy_formulations: [
      ...['f-inj', 'f-cap'].flatMap(f => [pf(f, 'a', STRIVE), pf(f, 'b', EXPIRED), pf(f, 'c', NOSTER), pf(f, 'd', OUTSRC)]),
    ],
    pharmacy_state_licenses: [
      license('ph-strive'),
      license('ph-expired', { expiration_date: '2026-01-31' }),
      license('ph-nonsterile', { sterile_compounding: false }),
      license('ph-503b', { sterile_compounding: null }),
    ],
  })
})

async function optionNames(formulationId: string) {
  const res = await GET({ url: `https://app.test/api/formulations?level=pharmacy_options&formulation_id=${formulationId}&state=TX` } as unknown as NextRequest)
  expect(res.status).toBe(200)
  const body = await res.json() as { data: Array<{ pharmacies: { name: string } }> }
  return body.data.map(o => o.pharmacies.name).sort()
}

it('an expired license is not offered', async () => {
  expect(await optionNames('f-cap')).not.toContain('Lapsed Pharmacy')
})

it('a non-sterile product is offered by every pharmacy with a valid license', async () => {
  expect(await optionNames('f-cap')).toEqual(['Non-Sterile Pharmacy', 'Outsourcing 503B', 'Strive Pharmacy'])
})

it('a sterile product is offered only where the license covers sterile compounding, or by a 503B facility', async () => {
  expect(await optionNames('f-inj')).toEqual(['Outsourcing 503B', 'Strive Pharmacy'])
})
