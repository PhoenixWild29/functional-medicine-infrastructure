/**
 * WO-102 on the price step: shipping shows as a line under wholesale,
 * OUTSIDE the margin calculation (platform fee and clinic margin are
 * unchanged by it), passed to the patient at cost by default, absorbed
 * when the clinic chooses. It is what this line adds to the session's
 * shipping — once per pharmacy.
 */

import { render, screen, waitFor } from '@testing-library/react'
import { PrescriptionSessionProvider } from '../../../_context/prescription-session'
import { MarginBuilderForm } from '../margin-builder-form'
import { STANDARD_CLINICAL_DIFFERENCE_OPTIONS, defaultRxDetails, type PackageOption } from '@/lib/orders/rx-details'

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), refresh: jest.fn() }),
}))

const STORAGE_KEY = 'compoundiq-rx-session'

// WO-102: Strive ships $9 standard / $22 cold chain.
const STRIVE_RATES = { pharmacyId: 'pharmacy-strive', pharmacyName: 'Strive Pharmacy', standardCents: 900, coldChainCents: 2200, freeShippingThresholdCents: null }

// Strive Semaglutide 5 mg/mL as seeded by migration 20260914000001.
const STRIVE_VIALS: PackageOption[] = [
  { id: 'pkg-1',   label: '1 mL vial',   qty: 1,   unit: 'mL', wholesalePrice: 95,  isDefault: true },
  { id: 'pkg-2.5', label: '2.5 mL vial', qty: 2.5, unit: 'mL', wholesalePrice: 165, isDefault: false },
  { id: 'pkg-5',   label: '5 mL vial',   qty: 5,   unit: 'mL', wholesalePrice: 285, isDefault: false },
]

const PATIENT = {
  patient_id: '11111111-1111-4111-8111-111111111111',
  first_name: 'Alex', last_name: 'Demo', date_of_birth: '1985-06-15',
  phone: '+15125550000', state: 'TX', sms_opt_in: true,
}
const PROVIDER = {
  provider_id: '22222222-2222-4222-8222-222222222222',
  first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', signature_hash: null,
}

const SEMAGLUTIDE_DEFAULTS = {
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


function renderMargin(overrides: Partial<React.ComponentProps<typeof MarginBuilderForm>> = {}) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ patient: PATIENT, provider: PROVIDER, prescriptions: [], notices: [] }))
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
        wholesalePrice={95}
        deaSchedule={0}
        defaultMarkupPct={100}
        presetSigText="Inject 10 units (0.10mL / 0.50mg) subcutaneously once weekly in the morning for 30 days"
        presetFrequency="QW"
        presetQuantity="1 mL vial"
        presetDose="10 units"
        presetDurationDays={30}
        packages={STRIVE_VIALS}
        shippingRates={STRIVE_RATES}
        presetRefills={0}
        formulationDetails={{ concentrationValue: 5, concentrationUnit: 'mg/mL', dosageFormName: 'Injectable Solution' }}
        rxDefaults={SEMAGLUTIDE_DEFAULTS}
        {...overrides}
      />
    </PrescriptionSessionProvider>,
  )
}

beforeEach(() => {
  sessionStorage.clear()
  mockPush.mockReset()
})

function sessionLineAtStrive(id: string, shippingType: 'standard' | 'cold_chain') {
  return {
    id, pharmacyId: 'pharmacy-strive', pharmacyName: 'Strive Pharmacy', itemId: null, formulationId: 'f-bpc',
    medicationName: 'BPC-157 Injectable', form: 'Injectable Solution', dose: '250 mcg', wholesaleCents: 6500, deaSchedule: null,
    retailCents: 13000, sigText: 'Inject 250 mcg subcutaneously daily', integrationTier: '',
    rxDetails: { ...defaultRxDetails(null), shippingType },
  }
}

function seedSession(prescriptions: unknown[]) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ patient: PATIENT, provider: PROVIDER, prescriptions, notices: [] }))
}

describe('MarginBuilderForm — WO-102 shipping line', () => {
  it('first item to Strive (Semaglutide, cold chain) → $22.00, passed to the patient, outside the margin', () => {
    renderMargin()
    expect(screen.getByTestId('shipping-line')).toHaveTextContent(
      'Shipping (cold chain): $22.00 — charged once for Strive Pharmacy, however many prescriptions it ships. Passed to the patient at cost; not part of the margin.',
    )
    // Platform fee and clinic margin are computed on retail − wholesale only.
    const summary = screen.getByText('Margin Summary').parentElement!.textContent ?? ''
    expect(summary).toContain('$14.25')   // 15% of $95
    expect(summary).toContain('$80.75')
  })

  it('a second cold-chain line to the same pharmacy adds nothing — it ships in the same box', async () => {
    const existing = { ...sessionLineAtStrive('line-other', 'cold_chain'), medicationName: 'Tirzepatide' }
    seedSession([existing])
    render(
      <PrescriptionSessionProvider>
        <MarginBuilderForm
          pharmacyId="pharmacy-strive" itemId={null} formulationId="formulation-sema" pharmacyName="Strive Pharmacy"
          medicationName="Semaglutide 5mg/mL Injectable" form="Injectable Solution" dose="10 units" wholesalePrice={95}
          deaSchedule={0} defaultMarkupPct={100} presetFrequency="QW" presetDurationDays={30}
          formulationDetails={{ concentrationValue: 5, concentrationUnit: 'mg/mL', dosageFormName: 'Injectable Solution' }}
          rxDefaults={SEMAGLUTIDE_DEFAULTS} shippingRates={STRIVE_RATES}
        />
      </PrescriptionSessionProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('shipping-line-amount')).toHaveTextContent('$0.00'))
    expect(screen.getByTestId('shipping-line')).toHaveTextContent('ships with the other Strive Pharmacy prescription in this session ($22.00 once)')
  })

  it('a cold-chain line joining a standard shipment adds the difference ($22 − $9)', async () => {
    seedSession([sessionLineAtStrive('line-bpc', 'standard')])
    render(
      <PrescriptionSessionProvider>
        <MarginBuilderForm
          pharmacyId="pharmacy-strive" itemId={null} formulationId="formulation-sema" pharmacyName="Strive Pharmacy"
          medicationName="Semaglutide 5mg/mL Injectable" form="Injectable Solution" dose="10 units" wholesalePrice={95}
          deaSchedule={0} defaultMarkupPct={100} presetFrequency="QW" presetDurationDays={30}
          formulationDetails={{ concentrationValue: 5, concentrationUnit: 'mg/mL', dosageFormName: 'Injectable Solution' }}
          rxDefaults={SEMAGLUTIDE_DEFAULTS} shippingRates={STRIVE_RATES}
        />
      </PrescriptionSessionProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('shipping-line-amount')).toHaveTextContent('$13.00'))
    expect(screen.getByTestId('shipping-line')).toHaveTextContent("upgrades this session's Strive Pharmacy shipment to cold chain ($22.00 once)")
  })

  it('the clinic absorbs shipping → says so', () => {
    renderMargin({ absorbShipping: true })
    expect(screen.getByTestId('shipping-line')).toHaveTextContent('Absorbed by the clinic.')
  })

  it('no rates on the page (legacy callers) → no shipping line', () => {
    renderMargin({ shippingRates: null })
    expect(screen.queryByTestId('shipping-line')).not.toBeInTheDocument()
  })
})
