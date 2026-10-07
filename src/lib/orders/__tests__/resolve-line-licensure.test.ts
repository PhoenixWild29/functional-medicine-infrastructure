/**
 * @jest-environment node
 *
 * resolveLine's pharmacy license check (C5) when saving a draft line:
 *
 *   - two live license rows for one state (a renewal entered beside the
 *     old one) are not an error: the unexpired one is used. The read was a
 *     maybeSingle(), which fails on two rows, so the draft could not be
 *     saved and batch-sign reported "today's price could not be read";
 *   - a line the pharmacy cannot fill there is refused with 422, as
 *     batch-sign refuses it, not 400.
 */

import { resolveLine } from '../resolve-line'

const PHARMACY = 'ph000000-0000-4000-8000-000000000001'
const FORM     = 'f0000000-0000-4000-8000-000000000001'

let licenseRows: Record<string, unknown>[] = []

const license = (over: Record<string, unknown> = {}) => ({
  pharmacy_id: PHARMACY, state_code: 'TX', license_number: 'TX-1', license_type: 'nonresident_pharmacy',
  expiration_date: '2099-12-31', is_active: true, deleted_at: null, sterile_compounding: true, ...over,
})

function makeSupabase() {
  const chain = (rows: () => unknown): Record<string, unknown> => {
    const c: Record<string, unknown> = {}
    for (const k of ['select', 'eq', 'is', 'in', 'order', 'limit']) c[k] = () => c
    // Like PostgREST: maybeSingle() on more than one row is an error.
    c['maybeSingle'] = async () => {
      const r = rows()
      if (Array.isArray(r)) {
        return r.length > 1
          ? { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned' } }
          : { data: r[0] ?? null, error: null }
      }
      return { data: r, error: null }
    }
    c['then'] = (resolve: (r: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve)
    return c
  }
  return {
    from: (table: string) => {
      if (table === 'formulations') {
        return chain(() => ({ formulation_id: FORM, name: 'Progesterone 100mg', concentration: '100 mg', dosage_forms: { name: 'Capsule', is_sterile: false } }))
      }
      if (table === 'pharmacy_formulations') return chain(() => ({ pharmacy_formulation_id: 'pf-1', wholesale_price: 20 }))
      if (table === 'formulation_ingredients') return chain(() => [])
      if (table === 'pharmacy_formulation_packages') return chain(() => [])
      if (table === 'pharmacies') {
        return chain(() => ({ pharmacy_id: PHARMACY, name: 'Strive Pharmacy', integration_tier: 'TIER_4_FAX', fax_number: '+15125550000', is_active: true, deleted_at: null, facility_type: '503A' }))
      }
      if (table === 'pharmacy_state_licenses') return chain(() => licenseRows)
      return chain(() => null)
    },
  }
}

const input = { catalogItemId: null, formulationId: FORM, pharmacyId: PHARMACY, patientState: 'TX' }
const resolve = () => resolveLine(makeSupabase() as never, input)

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {})
  licenseRows = [license()]
})
afterEach(() => { jest.restoreAllMocks() })

it('two live licenses in the state, one expired and one renewed: resolves on the unexpired one', async () => {
  licenseRows = [license({ license_number: 'TX-OLD', expiration_date: '2025-12-31' }), license({ license_number: 'TX-NEW' })]
  expect(await resolve()).toMatchObject({ ok: true })
})

it('two live licenses, both expired: refused as expired (422), naming the latest expiry', async () => {
  licenseRows = [license({ expiration_date: '2025-12-31' }), license({ expiration_date: '2026-01-31' })]
  const res = await resolve()
  expect(res).toMatchObject({ ok: false, status: 422, error: "Strive Pharmacy's license in TX expired on 2026-01-31." })
})

it('no license in the state: 422, as batch-sign refuses it', async () => {
  licenseRows = []
  expect(await resolve()).toMatchObject({ ok: false, status: 422, error: 'Pharmacy Strive Pharmacy is not licensed in TX' })
})
