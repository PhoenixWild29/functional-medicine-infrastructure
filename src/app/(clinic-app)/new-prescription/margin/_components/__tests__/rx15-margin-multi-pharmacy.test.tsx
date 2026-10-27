/**
 * Requirement 15 on the price step: pricing a line at a pharmacy other than
 * the session's other lines warns that it is another shipping charge, in
 * the words Review uses, before the line is added. Harness from
 * wo102-margin-shipping.test.tsx.
 */

import { render, screen, waitFor } from '@testing-library/react'
import { PrescriptionSessionProvider } from '../../../_context/prescription-session'
import { MarginBuilderForm } from '../margin-builder-form'
import { STANDARD_CLINICAL_DIFFERENCE_OPTIONS, defaultRxDetails, type PackageOption } from '@/lib/orders/rx-details'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}))

const STORAGE_KEY = 'compoundiq-rx-session'

const STRIVE_RATES = { pharmacyId: 'pharmacy-strive', pharmacyName: 'Strive Pharmacy', standardCents: 900, coldChainCents: 2200, freeShippingThresholdCents: null }
const QUICK_RATES  = { pharmacyId: 'pharmacy-quick', pharmacyName: 'Quick Rx Pharmacy', standardCents: 1200, coldChainCents: 2500, freeShippingThresholdCents: null }

const VIALS: PackageOption[] = [{ id: 'pkg-1', label: '1 mL vial', qty: 1, unit: 'mL', wholesalePrice: 95, isDefault: true }]

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

function lineAt(id: string, pharmacyId: string, pharmacyName: string) {
  return {
    id, pharmacyId, pharmacyName, itemId: null, formulationId: 'f-bpc',
    medicationName: 'BPC-157 Injectable', form: 'Injectable Solution', dose: '250 mcg', wholesaleCents: 6500, deaSchedule: null,
    retailCents: 13000, sigText: 'Inject 250 mcg subcutaneously daily', integrationTier: '',
    rxDetails: { ...defaultRxDetails(null), shippingType: 'standard' },
  }
}

const shippingCalls: string[] = []
beforeEach(() => {
  sessionStorage.clear()
  shippingCalls.length = 0
  global.fetch = jest.fn(async (input: unknown) => {
    const url = String(input)
    if (url.startsWith('/api/pharmacies/shipping')) {
      shippingCalls.push(url)
      return { ok: true, status: 200, json: async () => ({ rates: [STRIVE_RATES, QUICK_RATES], absorbShipping: false }) } as unknown as Response
    }
    return { ok: true, status: 200, json: async () => ({ data: [] }) } as unknown as Response
  }) as unknown as typeof fetch
})

function renderAtStrive(prescriptions: unknown[]) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ patient: PATIENT, provider: PROVIDER, prescriptions, notices: [] }))
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
        packages={VIALS}
        shippingRates={STRIVE_RATES}
        presetRefills={0}
        formulationDetails={{ concentrationValue: 5, concentrationUnit: 'mg/mL', dosageFormName: 'Injectable Solution' }}
        rxDefaults={SEMAGLUTIDE_DEFAULTS}
      />
    </PrescriptionSessionProvider>,
  )
}

describe('price step: the multi-pharmacy shipping warning (requirement 15)', () => {
  it('a Semaglutide line at Strive with a session line at Quick Rx: "2 pharmacies → 2 shipping charges ($34.00)."', async () => {
    renderAtStrive([lineAt('line-quick', 'pharmacy-quick', 'Quick Rx Pharmacy')])
    // Strive cold chain $22 + Quick Rx standard $12.
    expect(await screen.findByTestId('multi-pharmacy-message')).toHaveTextContent('2 pharmacies → 2 shipping charges ($34.00).')
    expect(shippingCalls[0]).toContain('pharmacy-quick')
    // No re-route here: that is at Review.
    expect(screen.queryByRole('button', { name: /^Route all to/ })).not.toBeInTheDocument()
  })

  it('no warning when the session is empty or already at this pharmacy', async () => {
    renderAtStrive([lineAt('line-strive', 'pharmacy-strive', 'Strive Pharmacy')])
    // The session's standard Strive line ships with this one (upgraded to cold chain).
    await waitFor(() => expect(screen.getByTestId('shipping-line')).toHaveTextContent("upgrades this session's Strive Pharmacy shipment to cold chain"))
    expect(screen.queryByTestId('multi-pharmacy-notice')).not.toBeInTheDocument()
    expect(shippingCalls).toEqual([])
  })
})
