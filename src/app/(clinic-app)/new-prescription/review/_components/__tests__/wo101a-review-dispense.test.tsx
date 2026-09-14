/**
 * WO-101a on the Review card: the Rx details row states the total being
 * dispensed and the packages it is filled from, and both Review POST
 * bodies carry the package count for the server to price.
 */

import { render, screen } from '@testing-library/react'
import { RxDetailsRow } from '../rx-details-row'
import { orderPostBody } from '../batch-review-form'
import { defaultRxDetails } from '@/lib/orders/rx-details'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}))

const DETAILS = defaultRxDetails(
  { default_syringe_option: 'sc_kit', default_shipping_type: 'cold_chain', clinical_difference_options: [], requires_clinical_difference: false },
  { derived: { daysSupply: 90, dispenseQuantity: 9.6, dispenseUnit: 'mL' } },
)
const RULES = { isControlled: false, requiresClinicalDifference: false, clinicalDifferenceOptions: [] }

function renderRow(packageLabel: string | null, packageCount: number | null) {
  return render(
    <RxDetailsRow lineId="line-1" details={DETAILS} rules={RULES} missing={[]} disabled={false} onChange={() => {}}
      packageLabel={packageLabel} packageCount={packageCount} />,
  )
}

describe('Rx details row — dispense with packaging', () => {
  it('reads "9.6 mL (2 × 5 mL vials)" in the summary and the details', () => {
    renderRow('5 mL vial', 2)
    expect(screen.getByRole('button', { name: /Rx details/ })).toHaveTextContent('90-day supply · dispense 9.6 mL (2 × 5 mL vials)')
  })

  it('no package → the dispense reads as before', () => {
    renderRow(null, null)
    expect(screen.getByRole('button', { name: /Rx details/ })).toHaveTextContent('90-day supply · dispense 9.6 mL ·')
    expect(screen.getByRole('button', { name: /Rx details/ })).not.toHaveTextContent('×')
  })
})

describe('orderPostBody — package count', () => {
  const patient = { patient_id: 'p1', state: 'TX' }
  const provider = { provider_id: 'pr1' }
  const line = {
    id: 'l1', pharmacyId: 'ph1', pharmacyName: 'Strive Pharmacy', itemId: null, formulationId: 'f1',
    medicationName: 'Semaglutide', form: 'Injectable Solution', dose: '80 units', wholesaleCents: 57000,
    deaSchedule: null, retailCents: 114000, sigText: 'Inject 80 units subcutaneously once weekly for 90 days', integrationTier: '',
  }

  it('sends packageId and packageCount', () => {
    expect(orderPostBody({ ...line, packageId: 'pkg-5', packageLabel: '5 mL vial', packageCount: 2 }, patient, provider, DETAILS))
      .toEqual(expect.objectContaining({ packageId: 'pkg-5', packageCount: 2 }))
  })

  it('a line saved before WO-101a (package, no count) sends count 1; no package sends none', () => {
    expect(orderPostBody({ ...line, packageId: 'pkg-5' }, patient, provider, DETAILS)).toEqual(expect.objectContaining({ packageCount: 1 }))
    expect(orderPostBody(line, patient, provider, DETAILS)).toEqual(expect.objectContaining({ packageId: null, packageCount: null }))
  })
})
