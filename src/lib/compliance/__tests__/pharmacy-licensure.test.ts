/**
 * Compliance C5: pharmacy licensure by state.
 *
 * An order may route to, and be signed for, a pharmacy only when it holds
 * an UNEXPIRED, active license in the patient's shipping state. A sterile
 * product (an injectable or a pellet) also needs that license to cover
 * sterile compounding, or the pharmacy to be a 503B outsourcing facility.
 *
 * Before this, every license lookup checked is_active only: an expired
 * license (expiration_date in the past) or a soft-deleted one counted as
 * licensed, and nothing looked at sterile scope at all.
 */

import {
  checkLicensure,
  isSterileProduct,
  licensureMatrix,
  todayIso,
  type LicenseRecord,
} from '../pharmacy-licensure'

const TODAY = '2026-10-07'

const lic = (over: Partial<LicenseRecord> = {}): LicenseRecord => ({
  pharmacy_id:         'ph-1',
  state_code:          'TX',
  license_number:      'TX-123',
  expiration_date:     '2027-06-30',
  is_active:           true,
  deleted_at:          null,
  license_type:        'nonresident_pharmacy',
  sterile_compounding: true,
  ...over,
})

const check = (licenses: LicenseRecord[], over: Partial<Parameters<typeof checkLicensure>[0]> = {}) =>
  checkLicensure({ licenses, pharmacyId: 'ph-1', pharmacyName: 'Strive', state: 'TX', sterile: false, facilityType: null, today: TODAY, ...over })

describe('checkLicensure', () => {
  it('an active, unexpired license in the state passes', () => {
    expect(check([lic()])).toEqual({ ok: true })
  })

  it('no license in the state fails, naming the pharmacy and state', () => {
    const r = check([lic({ state_code: 'CA' })])
    expect(r).toMatchObject({ ok: false, problem: 'no_license' })
    expect(!r.ok && r.message).toBe('Strive is not licensed in TX.')
  })

  it('an expired license fails, with its expiry date', () => {
    const r = check([lic({ expiration_date: '2026-10-06' })])
    expect(r).toMatchObject({ ok: false, problem: 'expired' })
    expect(!r.ok && r.message).toBe("Strive's license in TX expired on 2026-10-06.")
  })

  it('a license that expires today is still valid today', () => {
    expect(check([lic({ expiration_date: TODAY })])).toEqual({ ok: true })
  })

  it('an inactive or soft-deleted license does not count', () => {
    expect(check([lic({ is_active: false })])).toMatchObject({ ok: false, problem: 'no_license' })
    expect(check([lic({ deleted_at: '2026-09-01T00:00:00Z' })])).toMatchObject({ ok: false, problem: 'no_license' })
  })

  it('a missing expiry date is not treated as valid', () => {
    expect(check([lic({ expiration_date: null as unknown as string })])).toMatchObject({ ok: false, problem: 'expired' })
  })

  it('the state is compared case-insensitively', () => {
    expect(check([lic()], { state: 'tx' })).toEqual({ ok: true })
  })

  it('no state at all fails (a line cannot be checked without one)', () => {
    expect(check([lic()], { state: null })).toMatchObject({ ok: false, problem: 'no_state' })
  })

  describe('sterile products', () => {
    it('pass with a license that covers sterile compounding', () => {
      expect(check([lic({ sterile_compounding: true })], { sterile: true })).toEqual({ ok: true })
    })

    it('fail with a license that does not', () => {
      const r = check([lic({ sterile_compounding: false })], { sterile: true })
      expect(r).toMatchObject({ ok: false, problem: 'not_sterile' })
      expect(!r.ok && r.message).toBe("Strive's license in TX does not cover sterile compounding, which this product needs.")
    })

    it('fail when the sterile scope was never recorded (fail closed)', () => {
      const r = check([lic({ sterile_compounding: null })], { sterile: true })
      expect(r).toMatchObject({ ok: false, problem: 'sterile_unrecorded' })
    })

    it('pass for a 503B outsourcing facility licensed in the state', () => {
      expect(check([lic({ sterile_compounding: null })], { sterile: true, facilityType: '503B' })).toEqual({ ok: true })
    })

    it('a 503B facility still needs an unexpired license in the state', () => {
      expect(check([lic({ expiration_date: '2026-01-01' })], { sterile: true, facilityType: '503B' })).toMatchObject({ ok: false, problem: 'expired' })
    })

    it('a non-sterile product ignores the sterile scope', () => {
      expect(check([lic({ sterile_compounding: false })], { sterile: false })).toEqual({ ok: true })
    })
  })
})

describe('isSterileProduct', () => {
  it('trusts the dosage form flag when it is known', () => {
    expect(isSterileProduct({ dosageFormIsSterile: true })).toBe(true)
    expect(isSterileProduct({ dosageFormIsSterile: false, formText: 'Injectable' })).toBe(false)
  })

  it('falls back to the form text for legacy catalog items', () => {
    expect(isSterileProduct({ formText: 'Injectable Solution' })).toBe(true)
    expect(isSterileProduct({ formText: 'Subcutaneous Pellet' })).toBe(true)
    expect(isSterileProduct({ formText: 'Capsule' })).toBe(false)
    expect(isSterileProduct({})).toBe(false)
  })
})

describe('todayIso', () => {
  it('is the UTC calendar date', () => {
    expect(todayIso(new Date('2026-10-07T23:30:00Z'))).toBe('2026-10-07')
  })
})

describe('licensureMatrix (ops view)', () => {
  const pharmacies = [
    { pharmacy_id: 'ph-1', name: 'Strive', facility_type: '503A' as const },
    { pharmacy_id: 'ph-2', name: 'Empower', facility_type: '503B' as const },
  ]
  const rows = [
    lic({ pharmacy_id: 'ph-1', state_code: 'TX', expiration_date: '2027-06-30' }),
    lic({ pharmacy_id: 'ph-1', state_code: 'CA', expiration_date: '2026-10-20', sterile_compounding: false }),
    lic({ pharmacy_id: 'ph-2', state_code: 'TX', expiration_date: '2026-09-30', sterile_compounding: null }),
    lic({ pharmacy_id: 'ph-2', state_code: 'NY', is_active: false }),
  ]

  it('one row per pharmacy, one cell per licensed state, states sorted', () => {
    const m = licensureMatrix(rows, pharmacies, TODAY)
    expect(m.states).toEqual(['CA', 'NY', 'TX'])
    expect(m.rows.map(r => r.pharmacyName)).toEqual(['Empower', 'Strive'])
  })

  it('flags licenses expiring within 30 days, and expired ones', () => {
    const m = licensureMatrix(rows, pharmacies, TODAY)
    const strive = m.rows.find(r => r.pharmacyId === 'ph-1')!
    expect(strive.cells['CA']).toMatchObject({ status: 'expiring', daysLeft: 13, sterile: false })
    expect(strive.cells['TX']).toMatchObject({ status: 'valid', sterile: true })
    const empower = m.rows.find(r => r.pharmacyId === 'ph-2')!
    expect(empower.cells['TX']).toMatchObject({ status: 'expired', sterile: null })
    expect(empower.cells['NY']).toMatchObject({ status: 'inactive' })
    expect(empower.facilityType).toBe('503B')
  })

  it('counts what needs attention', () => {
    expect(licensureMatrix(rows, pharmacies, TODAY).summary).toEqual({ expiring: 1, expired: 1, sterileUnrecorded: 1 })
  })
})
