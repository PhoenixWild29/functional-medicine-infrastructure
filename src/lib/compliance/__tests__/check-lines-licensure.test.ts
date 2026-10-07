/**
 * @jest-environment node
 *
 * C5 at Review: each session line's pharmacy is checked against the
 * patient's shipping state with the same rule batch-sign applies, so
 * Review shows why a line cannot be sent before the signature (the sign
 * page already shows batch-sign's problems).
 */

import { checkLinesLicensure } from '../pharmacy-licensure'
import { fakeDb } from '@/lib/orders/__tests__/fake-db'

const TODAY = '2026-10-07'

const license = (pharmacyId: string, over: Record<string, unknown> = {}) => ({
  pharmacy_id: pharmacyId, state_code: 'TX', license_number: `${pharmacyId}-TX`, expiration_date: '2099-12-31',
  is_active: true, deleted_at: null, license_type: 'nonresident_pharmacy', sterile_compounding: true, ...over,
})

function db() {
  return fakeDb({
    pharmacies: [
      { pharmacy_id: 'ph-ok', name: 'Strive', facility_type: '503A' },
      { pharmacy_id: 'ph-lapsed', name: 'Lapsed Rx', facility_type: '503A' },
      { pharmacy_id: 'ph-nonsterile', name: 'Oral Only Rx', facility_type: '503A' },
    ],
    pharmacy_state_licenses: [
      license('ph-ok'),
      license('ph-lapsed', { expiration_date: '2026-01-31' }),
      license('ph-nonsterile', { sterile_compounding: false }),
    ],
    formulations: [
      { formulation_id: 'f-inj', dosage_forms: { name: 'Injectable Solution', is_sterile: true } },
      { formulation_id: 'f-cap', dosage_forms: { name: 'Capsule', is_sterile: false } },
    ],
    catalog: [{ item_id: 'cat-inj', form: 'Injectable' }],
  })
}

it('returns one problem per line that cannot be sent, keyed by the line, and none for lines that can', async () => {
  const problems = await checkLinesLicensure(db().client, {
    state: 'TX',
    today: TODAY,
    lines: [
      { key: 'l1', pharmacyId: 'ph-ok',         formulationId: 'f-inj', catalogItemId: null },
      { key: 'l2', pharmacyId: 'ph-lapsed',     formulationId: 'f-cap', catalogItemId: null },
      { key: 'l3', pharmacyId: 'ph-nonsterile', formulationId: 'f-inj', catalogItemId: null },
      { key: 'l4', pharmacyId: 'ph-nonsterile', formulationId: 'f-cap', catalogItemId: null },
      { key: 'l5', pharmacyId: 'ph-nonsterile', formulationId: null,    catalogItemId: 'cat-inj' },
    ],
  })

  expect(problems).toEqual([
    { key: 'l2', problem: 'expired', message: "Lapsed Rx's license in TX expired on 2026-01-31." },
    { key: 'l3', problem: 'not_sterile', message: expect.stringContaining('sterile compounding') },
    { key: 'l5', problem: 'not_sterile', message: expect.stringContaining('sterile compounding') },
  ])
})

it('a pharmacy with no license in the state is named', async () => {
  const problems = await checkLinesLicensure(db().client, {
    state: 'CA', today: TODAY,
    lines: [{ key: 'l1', pharmacyId: 'ph-ok', formulationId: 'f-cap', catalogItemId: null }],
  })
  expect(problems).toEqual([{ key: 'l1', problem: 'no_license', message: 'Strive is not licensed in CA.' }])
})

it('a failed read throws (the caller does not show "all clear" on an unknown)', async () => {
  const d = db()
  d.failOn('pharmacy_state_licenses:select')
  await expect(checkLinesLicensure(d.client, {
    state: 'TX', today: TODAY, lines: [{ key: 'l1', pharmacyId: 'ph-ok', formulationId: 'f-cap', catalogItemId: null }],
  })).rejects.toThrow()
})
