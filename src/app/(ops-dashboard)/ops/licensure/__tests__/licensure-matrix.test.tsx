/**
 * C5 ops view: a pharmacy x state licensure matrix. Each cell shows the
 * license's expiry, type and sterile scope; a license expiring within 30
 * days, an expired one, and an unrecorded sterile scope are flagged.
 */

import { render, screen, within } from '@testing-library/react'
import { LicensureMatrixTable } from '../_components/licensure-matrix-table'
import { loadLicensureMatrix } from '@/lib/compliance/pharmacy-licensure'
import { fakeDb } from '@/lib/orders/__tests__/fake-db'

const TODAY = '2026-10-07'

const license = (pharmacyId: string, state: string, over: Record<string, unknown> = {}) => ({
  pharmacy_id: pharmacyId, state_code: state, license_number: `${pharmacyId}-${state}`, expiration_date: '2027-06-30',
  is_active: true, deleted_at: null, license_type: 'nonresident_pharmacy', sterile_compounding: true, ...over,
})

function db() {
  return fakeDb({
    pharmacies: [
      { pharmacy_id: 'ph-1', name: 'Strive', facility_type: '503A', is_active: true, deleted_at: null },
      { pharmacy_id: 'ph-2', name: 'Empower', facility_type: '503B', is_active: true, deleted_at: null },
      { pharmacy_id: 'ph-old', name: 'Closed Rx', facility_type: null, is_active: false, deleted_at: '2026-01-01T00:00:00Z' },
    ],
    pharmacy_state_licenses: [
      license('ph-1', 'TX'),
      license('ph-1', 'CA', { expiration_date: '2026-10-20', sterile_compounding: false }),
      license('ph-2', 'TX', { expiration_date: '2026-09-30', sterile_compounding: null, license_type: 'outsourcing_facility' }),
      license('ph-old', 'NY'),
      license('ph-1', 'FL', { deleted_at: '2026-05-01T00:00:00Z' }),
    ],
  })
}

describe('loadLicensureMatrix', () => {
  it('reads live pharmacies and their non-deleted licenses', async () => {
    const m = await loadLicensureMatrix(db().client, TODAY)
    expect(m.rows.map(r => r.pharmacyName)).toEqual(['Empower', 'Strive'])
    expect(m.states).toEqual(['CA', 'TX'])
    expect(m.summary).toEqual({ expiring: 1, expired: 1, sterileUnrecorded: 1 })
  })

  it('a failed read throws (the page shows an error, never an empty matrix)', async () => {
    const d = db()
    d.failOn('pharmacy_state_licenses:select')
    await expect(loadLicensureMatrix(d.client, TODAY)).rejects.toThrow()
  })
})

describe('LicensureMatrixTable', () => {
  it('shows each pharmacy x state with expiry, type and sterile scope, and flags what needs attention', async () => {
    const m = await loadLicensureMatrix(db().client, TODAY)
    render(<LicensureMatrixTable matrix={m} />)

    const strive = screen.getByTestId('licensure-row-ph-1')
    expect(within(strive).getByText('Strive')).toBeInTheDocument()
    expect(within(strive).getByText('503A')).toBeInTheDocument()

    const caCell = screen.getByTestId('licensure-cell-ph-1-CA')
    expect(caCell).toHaveTextContent('2026-10-20')
    expect(caCell).toHaveTextContent('Expires in 13 days')
    expect(caCell).toHaveTextContent('Non-sterile')
    expect(caCell).toHaveAttribute('data-status', 'expiring')

    const empowerTx = screen.getByTestId('licensure-cell-ph-2-TX')
    expect(empowerTx).toHaveTextContent('Expired')
    expect(empowerTx).toHaveTextContent('Sterile scope not recorded')
    expect(empowerTx).toHaveTextContent('Outsourcing facility')

    expect(screen.getByTestId('licensure-cell-ph-2-CA')).toHaveTextContent('Not licensed')
    expect(screen.getByTestId('licensure-summary')).toHaveTextContent('1 expiring within 30 days')
    expect(screen.getByTestId('licensure-summary')).toHaveTextContent('1 expired')
    expect(screen.getByTestId('licensure-summary')).toHaveTextContent('1 with sterile scope not recorded')
  })
})
