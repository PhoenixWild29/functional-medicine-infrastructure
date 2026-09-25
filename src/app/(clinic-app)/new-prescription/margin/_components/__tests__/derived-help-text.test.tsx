/**
 * The price step's help text says what was actually computed (found on
 * prod, 2026-09-25).
 *
 * A titration line read "As-needed doses can't be counted, so dispense
 * is the selected package" while the dispense beside it was the
 * correctly summed 22.4 mL. The titration total reused the "duration,
 * no countable doses" explanation, which is the as-needed one. Each mode
 * gets its own sentence, and the as-needed one is only for as-needed.
 */

import { render, screen } from '@testing-library/react'
import { PrescriptionSessionProvider } from '../../../_context/prescription-session'
import { MarginBuilderForm } from '../margin-builder-form'
import { STANDARD_CLINICAL_DIFFERENCE_OPTIONS, type PackageOption } from '@/lib/orders/rx-details'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}))

const VIALS: PackageOption[] = [
  { id: 'pkg-1',   label: '1 mL vial',   qty: 1,   unit: 'mL', wholesalePrice: 60,  isDefault: false },
  { id: 'pkg-2.5', label: '2.5 mL vial', qty: 2.5, unit: 'mL', wholesalePrice: 120, isDefault: false },
  { id: 'pkg-5',   label: '5 mL vial',   qty: 5,   unit: 'mL', wholesalePrice: 200, isDefault: true },
]

const RX_DEFAULTS = {
  formulationId: 'formulation-sema',
  defaults: {
    default_syringe_option: 'sc_kit' as const,
    default_shipping_type: 'cold_chain' as const,
    clinical_difference_options: [...STANDARD_CLINICAL_DIFFERENCE_OPTIONS],
    requires_clinical_difference: true,
  },
  deaSchedule: null,
  suggestedDiagnosis: null,
}

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
        formulationId="formulation-sema"
        pharmacyName="Strive Pharmacy"
        medicationName="Semaglutide 5mg/mL Injectable"
        form="Injectable Solution"
        dose="10 units"
        wholesalePrice={200}
        deaSchedule={0}
        defaultMarkupPct={100}
        presetSigText="Inject 10 units subcutaneous once daily for 30 days"
        presetFrequency="QD"
        presetDose="10 units"
        packages={VIALS}
        presetRefills={0}
        formulationDetails={{ concentrationValue: 5, concentrationUnit: 'mg/mL', dosageFormName: 'Injectable Solution' }}
        rxDefaults={RX_DEFAULTS}
        {...overrides}
      />
    </PrescriptionSessionProvider>,
  )
}

const help = () => screen.getByTestId('derived-help')

beforeEach(() => sessionStorage.clear())

describe('the help text under Days supply / Dispense', () => {
  it('titration: the steps add up — never the as-needed sentence', () => {
    renderMargin({
      presetSigMode: 'titration',
      presetDurationDays: 84,
      presetTitrationSteps: [
        { dose: '10', unit: 'units', frequency: 'QW', weeks: 4 },
        { dose: '20', unit: 'units', frequency: 'QW', weeks: 4 },
        { dose: '40', unit: 'units', frequency: 'QW', weeks: 4 },
      ],
    })
    expect(screen.getByTestId('dispense-value')).toHaveTextContent('2.8 mL')
    expect(help()).toHaveTextContent(
      "Days supply is the 84 days the 3 titration steps add up to. Dispense is the sum over the steps: each step's doses × that step's dose.",
    )
    expect(help()).not.toHaveTextContent(/as-needed/i)
  })

  it('cycling: the doses are the on-days in the cycle length', () => {
    renderMargin({ presetSigMode: 'cycling', presetCycle: { onDays: 5, offDays: 2 }, presetDurationDays: 30 })
    expect(help()).toHaveTextContent(
      'Days supply is the 30-day cycle length selected on the dose step. Dispense is 22 doses (the on-days in those 30 days) × the dose.',
    )
  })

  it('cycling, ongoing: the package, dosed on on-days only', () => {
    renderMargin({ presetSigMode: 'cycling', presetCycle: { onDays: 5, offDays: 2 }, presetDurationDays: null, packages: VIALS.slice(2) })
    expect(help()).toHaveTextContent('No cycle length (ongoing), so days supply is how long the 5 mL package lasts, dosing on on-days only.')
  })

  it('standard: unchanged', () => {
    renderMargin({ presetSigMode: 'standard', presetDurationDays: 30 })
    expect(help()).toHaveTextContent('Days supply is the 30-day duration selected on the dose step. Dispense is 30 doses over those days × the dose.')
  })

  it('as-needed keeps the as-needed sentence — and only as-needed does', () => {
    renderMargin({ presetSigMode: 'standard', presetDurationDays: 30, presetFrequency: 'PRN' })
    expect(help()).toHaveTextContent("As-needed doses can't be counted, so dispense is the selected package.")
  })
})
