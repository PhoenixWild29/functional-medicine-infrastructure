/**
 * The price step prices mg vials by the vial count the dispense needs
 * (found on prod, 2026-09-25: BPC-157 daily cycling priced as one $62
 * vial for 30 mL at 1 mg/mL). A package whose unit cannot be converted
 * blocks the line with a clear message instead of pricing one package.
 */

import { render, screen } from '@testing-library/react'
import { PrescriptionSessionProvider } from '../../../_context/prescription-session'
import { MarginBuilderForm } from '../margin-builder-form'
import type { PackageOption } from '@/lib/orders/rx-details'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}))

const FIVE_MG_VIAL: PackageOption = { id: 'pkg-bpc-5', label: '5 mg vial', qty: 5, unit: 'mg', wholesalePrice: 62, isDefault: true }

function renderMargin(overrides: Partial<React.ComponentProps<typeof MarginBuilderForm>>) {
  sessionStorage.setItem('compoundiq-rx-session', JSON.stringify({
    patient: { patient_id: '11111111-1111-4111-8111-111111111111', first_name: 'Alex', last_name: 'Demo', date_of_birth: '1985-06-15', phone: '+15125550000', state: 'TX', sms_opt_in: true },
    provider: { provider_id: '22222222-2222-4222-8222-222222222222', first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', signature_hash: null },
    prescriptions: [], notices: [],
  }))
  return render(
    <PrescriptionSessionProvider>
      <MarginBuilderForm
        pharmacyId="pharmacy-strive"
        itemId={null}
        formulationId="formulation-bpc"
        pharmacyName="Strive Pharmacy"
        medicationName="BPC-157 Injectable 5mg"
        form="Injectable Solution"
        dose="1 mg"
        wholesalePrice={62}
        deaSchedule={0}
        defaultMarkupPct={50}
        presetSigText="Inject 1mg (1.00mL) subcutaneous once daily, 5 days on / 2 days off, for 6 weeks then reassess"
        presetFrequency="QD"
        presetDose="1 mg"
        presetDurationDays={42}
        packages={[FIVE_MG_VIAL]}
        presetRefills={0}
        formulationDetails={{ concentrationValue: 1, concentrationUnit: 'mg/mL', dosageFormName: 'Injectable Solution' }}
        presetSigMode="cycling"
        presetCycle={{ onDays: 5, offDays: 2 }}
        {...overrides}
      />
    </PrescriptionSessionProvider>,
  )
}

beforeEach(() => sessionStorage.clear())

describe('mg vials are counted against a dispense in mL', () => {
  it('BPC-157 daily cycling, 42 days: 30 mL is 6 × 5 mg vial at $372.00', () => {
    renderMargin({})
    expect(screen.getByTestId('dispense-value')).toHaveTextContent('30 mL')
    expect(screen.getByTestId('package-summary')).toHaveTextContent('Package: 6 × 5 mg vials (suggested for 42 days) · $372.00')
  })

  it('a Standard line over 30 days: 0.5 mg daily is 15 mL, 3 × 5 mg vial at $186.00', () => {
    renderMargin({
      dose: '0.5 mg', presetDose: '0.5 mg', presetDurationDays: 30,
      presetSigMode: 'standard', presetCycle: null,
      presetSigText: 'Inject 0.5mg (0.50mL) subcutaneous once daily for 30 days',
    })
    expect(screen.getByTestId('dispense-value')).toHaveTextContent('15 mL')
    expect(screen.getByTestId('package-summary')).toHaveTextContent('Package: 3 × 5 mg vials (suggested for 30 days) · $186.00')
  })
})

describe('a package that cannot be converted is refused', () => {
  it('says why, and the line cannot continue', () => {
    renderMargin({
      dose: '1 mL', presetDose: '1 mL', presetSigMode: 'standard', presetCycle: null, presetDurationDays: 30,
      presetSigText: 'Inject 1 mL subcutaneous once daily for 30 days',
      formulationDetails: { concentrationValue: null, concentrationUnit: null, dosageFormName: 'Injectable Solution' },
    })
    expect(screen.getByTestId('package-unit-mismatch')).toHaveTextContent('The 5 mg vial package is not measured in mL')
    expect(screen.getByRole('button', { name: /^Review & Send/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Save as Draft/ })).toBeDisabled()
  })
})
