/**
 * The price step counts suppositories and prices the packs they need
 * (#181 audit, group 3). Exact CSV rows: Oxytocin 400 IU "10 supp" $28,
 * Estradiol 0.5 mg "30 supp" $23.
 */

import { render, screen } from '@testing-library/react'
import { PrescriptionSessionProvider } from '../../../_context/prescription-session'
import { MarginBuilderForm } from '../margin-builder-form'
import type { PackageOption } from '@/lib/orders/rx-details'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}))

const OXY_10: PackageOption = { id: 'pkg-oxy-10', label: '10 supp', qty: 10, unit: 'supp', wholesalePrice: 28, isDefault: true }
const ESTRADIOL_30: PackageOption = { id: 'pkg-e2-30', label: '30 supp', qty: 30, unit: 'supp', wholesalePrice: 23, isDefault: true }

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
        formulationId="formulation-oxytocin"
        pharmacyName="Strive Pharmacy"
        medicationName="Oxytocin Vaginal Suppository 400IU"
        form="Suppository"
        dose="400 units"
        wholesalePrice={28}
        deaSchedule={0}
        defaultMarkupPct={50}
        presetSigText="Insert 400 units intravaginal once daily for 30 days"
        presetFrequency="QD"
        presetDose="400 units"
        presetDurationDays={30}
        packages={[OXY_10]}
        presetRefills={0}
        formulationDetails={{ concentrationValue: 400, concentrationUnit: 'units', dosageFormName: 'Suppository' }}
        presetSigMode="standard"
        {...overrides}
      />
    </PrescriptionSessionProvider>,
  )
}

beforeEach(() => sessionStorage.clear())

describe('suppositories on the price step', () => {
  it('Oxytocin 400 IU daily × 30 days: 30 suppositories, 3 × 10 supp at $84.00', () => {
    renderMargin({})
    expect(screen.getByTestId('dispense-value')).toHaveTextContent('30 suppositories')
    expect(screen.getByTestId('package-summary')).toHaveTextContent('Package: 3 × 10 supp (suggested for 30 days) · $84.00')
  })

  it('Estradiol 0.5 mg daily × 60 days: 60 suppositories, 2 × 30 supp at $46.00', () => {
    renderMargin({
      formulationId: 'formulation-e2-supp', medicationName: 'Estradiol Vaginal Suppository 0.5mg',
      dose: '0.5 mg', presetDose: '0.5 mg', presetDurationDays: 60, wholesalePrice: 23, packages: [ESTRADIOL_30],
      presetSigText: 'Insert 0.5 mg intravaginal once daily for 60 days',
      formulationDetails: { concentrationValue: 0.5, concentrationUnit: 'mg', dosageFormName: 'Suppository' },
    })
    expect(screen.getByTestId('dispense-value')).toHaveTextContent('60 suppositories')
    expect(screen.getByTestId('package-summary')).toHaveTextContent('Package: 2 × 30 supp (suggested for 60 days) · $46.00')
  })
})
