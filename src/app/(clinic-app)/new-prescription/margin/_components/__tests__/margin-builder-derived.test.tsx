/**
 * WO-96 on the margin/sig page: days supply and dispense are derived from
 * dose × frequency × quantity and shown read-only next to the sig
 * (rule 3), the provider can override them, and the session line that
 * leaves this page carries the derived values plus the formulation's
 * pre-filled Rx details (rule 2).
 *
 * Acceptance criterion pinned: Semaglutide 10 units weekly, qty 1 vial
 * 5 mg/mL → days supply and dispense computed and shown without typing.
 */

import { useEffect } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PrescriptionSessionProvider, usePrescriptionSession } from '../../../_context/prescription-session'
import { MarginBuilderForm, splitDose } from '../margin-builder-form'
import { STANDARD_CLINICAL_DIFFERENCE_OPTIONS } from '@/lib/orders/rx-details'

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), refresh: jest.fn() }),
}))

const STORAGE_KEY = 'compoundiq-rx-session'

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

let lastSession: ReturnType<typeof usePrescriptionSession> | null = null
function SessionProbe({ onSession }: { onSession: (s: ReturnType<typeof usePrescriptionSession>) => void }) {
  const session = usePrescriptionSession()
  useEffect(() => { onSession(session) }, [session, onSession])
  return null
}
const captureSession = (s: ReturnType<typeof usePrescriptionSession>) => { lastSession = s }

function renderMargin(overrides: Partial<React.ComponentProps<typeof MarginBuilderForm>> = {}) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ patient: PATIENT, provider: PROVIDER, prescriptions: [], notices: [] }))
  return render(
    <PrescriptionSessionProvider>
      <SessionProbe onSession={captureSession} />
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
        presetSigText="Inject 10 units (0.10mL / 0.50mg) subcutaneously once weekly"
        presetFrequency="QW"
        presetQuantity="5mL vial"
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
  lastSession = null
})

describe('splitDose', () => {
  it('separates amount and unit', () => {
    expect(splitDose('10 units')).toEqual({ amount: '10', unit: 'units' })
    expect(splitDose('0.5mg')).toEqual({ amount: '0.5', unit: 'mg' })
    expect(splitDose('')).toEqual({ amount: '', unit: '' })
  })
})

describe('MarginBuilderForm — derived days supply + dispense', () => {
  it('shows 350 days / 5 mL for Semaglutide 10 units weekly from one 5 mL vial, with nothing typed', () => {
    renderMargin()
    expect(screen.getByTestId('days-supply-value')).toHaveTextContent('350 days')
    expect(screen.getByTestId('dispense-value')).toHaveTextContent('5 mL')
    expect(screen.getByText(/No duration selected, so days supply is how long the 5 mL package lasts at this dose and frequency/)).toBeInTheDocument()
    // Read-only until the provider chooses to override.
    expect(screen.queryByLabelText('Days supply')).not.toBeInTheDocument()
  })

  it('carries the derived values and the formulation defaults onto the session line', async () => {
    renderMargin()
    fireEvent.click(screen.getByRole('button', { name: /^Review & Send/ }))

    await waitFor(() => expect(lastSession?.prescriptions).toHaveLength(1))
    const rx = lastSession!.prescriptions[0]!
    expect(rx.frequencyCode).toBe('QW')
    expect(rx.quantityLabel).toBe('5mL vial')
    expect(rx.rxRules).toEqual({
      isControlled: false,
      requiresClinicalDifference: true,
      clinicalDifferenceOptions: [...STANDARD_CLINICAL_DIFFERENCE_OPTIONS],
    })
    expect(rx.rxDetails).toEqual({
      daysSupply: 350,
      dispenseQuantity: 5,
      dispenseUnit: 'mL',
      refills: 0,
      substitutionAllowed: true,
      syringeOption: 'sc_kit',
      shippingType: 'cold_chain',
      clinicalDifference: STANDARD_CLINICAL_DIFFERENCE_OPTIONS[0],
      diagnosisCode: null,
      diagnosisText: null,
      specialInstructions: null,
    })
    expect(mockPush).toHaveBeenCalledWith('/new-prescription/review')
  })

  it('lets the provider override the derived values inline', async () => {
    renderMargin()
    fireEvent.click(screen.getByRole('button', { name: 'Override' }))
    fireEvent.change(screen.getByLabelText('Days supply'), { target: { value: '28' } })
    fireEvent.change(screen.getByLabelText('Dispense qty'), { target: { value: '2.5' } })

    expect(screen.getByTestId('days-supply-value')).toHaveTextContent('28 days')
    expect(screen.getByTestId('dispense-value')).toHaveTextContent('2.5 mL')
    expect(screen.getByText(/Provider override in effect/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^Review & Send/ }))
    await waitFor(() => expect(lastSession?.prescriptions).toHaveLength(1))
    expect(lastSession!.prescriptions[0]!.rxDetails).toEqual(expect.objectContaining({
      daysSupply: 28, dispenseQuantity: 2.5, dispenseUnit: 'mL',
    }))
  })

  it('reverts to the computed values when the override is cleared', () => {
    renderMargin()
    fireEvent.click(screen.getByRole('button', { name: 'Override' }))
    fireEvent.change(screen.getByLabelText('Days supply'), { target: { value: '28' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use computed values' }))
    expect(screen.getByTestId('days-supply-value')).toHaveTextContent('350 days')
  })

  it('never shows "—" when no quantity came upstream: defaults to the smallest listed package', () => {
    renderMargin({ presetQuantity: undefined, availableQuantities: ['5mL vial', '2.5mL vial'] })
    // No duration in this sig → derived from the smallest package, 2.5 mL.
    expect(screen.getByTestId('days-supply-value')).toHaveTextContent('175 days')
    expect(screen.getByTestId('dispense-value')).toHaveTextContent('2.5 mL')
    expect(screen.queryByText(/Computed once a quantity is selected/)).not.toBeInTheDocument()
  })

  it('with no quantity and no package list, still computes from one package ("1")', () => {
    renderMargin({ presetQuantity: undefined, availableQuantities: [] })
    expect(screen.getByTestId('days-supply-value')).toHaveTextContent('70 days')
    expect(screen.getByTestId('dispense-value')).toHaveTextContent('1 mL')
  })

  it('carries the builder refills and the clinic’s suggested diagnosis', async () => {
    renderMargin({
      presetRefills: 2,
      rxDefaults: { ...SEMAGLUTIDE_DEFAULTS, suggestedDiagnosis: { code: 'E66.9', text: 'Obesity, unspecified' } },
    })
    fireEvent.click(screen.getByRole('button', { name: /^Review & Send/ }))
    await waitFor(() => expect(lastSession?.prescriptions).toHaveLength(1))
    expect(lastSession!.prescriptions[0]!.rxDetails).toEqual(expect.objectContaining({
      refills: 2, diagnosisCode: 'E66.9', diagnosisText: 'Obesity, unspecified',
    }))
  })

  it('blocks the single-line Save as Draft when a rule-required field has no default', async () => {
    // Controlled substance with no prior diagnosis in the clinic.
    renderMargin({
      deaSchedule: 3,
      rxDefaults: { ...SEMAGLUTIDE_DEFAULTS, defaults: { ...SEMAGLUTIDE_DEFAULTS.defaults, requires_clinical_difference: false, clinical_difference_options: [] } },
    })
    global.fetch = jest.fn() as unknown as typeof fetch
    fireEvent.click(screen.getByRole('button', { name: /Save as Draft/ }))
    expect(await screen.findByText(/needs a diagnosis \(controlled substance\)/)).toBeInTheDocument()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('does not render the derived block for legacy catalog items', () => {
    renderMargin({ formulationDetails: null, rxDefaults: null, itemId: 'legacy-item', formulationId: null })
    expect(screen.queryByTestId('derived-dispense')).not.toBeInTheDocument()
  })
})

// ============================================================
// WO-96 fix — duration-based derivation (Gina Rooks, 2026-09-11 items 1-2)
// ============================================================

describe('MarginBuilderForm — WO-96 fix: days supply from the duration the provider picked', () => {
  const GINA_SIG = 'Inject 10 units (0.10mL / 0.50mg) subcutaneous once weekly in the morning for 30 days'
  const STRIVE_PACKAGES = ['5mL vial', '2.5mL vial', '1mL vial']

  it("Gina's scenario with no quantity picked: 30 days / 0.4 mL, never '—'", () => {
    renderMargin({ presetSigText: GINA_SIG, presetQuantity: undefined, availableQuantities: STRIVE_PACKAGES })
    expect(screen.getByTestId('days-supply-value')).toHaveTextContent('30 days')
    expect(screen.getByTestId('dispense-value')).toHaveTextContent('0.4 mL')
    expect(screen.getByText(/Days supply is the 30-day duration selected on the dose step. Dispense is 4 doses over those days × the dose./)).toBeInTheDocument()
    expect(screen.queryByText('—')).not.toBeInTheDocument()
  })

  it('the session line carries the derived values and the default package (smallest covering 0.4 mL)', async () => {
    renderMargin({ presetSigText: GINA_SIG, presetQuantity: undefined, availableQuantities: STRIVE_PACKAGES })
    fireEvent.click(screen.getByRole('button', { name: /^Review & Send/ }))
    await waitFor(() => expect(lastSession?.prescriptions).toHaveLength(1))
    const rx = lastSession!.prescriptions[0]!
    expect(rx.quantityLabel).toBe('1mL vial')
    expect(rx.rxDetails).toEqual(expect.objectContaining({ daysSupply: 30, dispenseQuantity: 0.4, dispenseUnit: 'mL' }))
  })

  it('a quantity the provider picked upstream is kept, and the duration still sets the days supply', async () => {
    renderMargin({ presetSigText: GINA_SIG, presetQuantity: '5mL vial', availableQuantities: STRIVE_PACKAGES })
    expect(screen.getByTestId('days-supply-value')).toHaveTextContent('30 days')
    fireEvent.click(screen.getByRole('button', { name: /^Review & Send/ }))
    await waitFor(() => expect(lastSession?.prescriptions).toHaveLength(1))
    expect(lastSession!.prescriptions[0]!.quantityLabel).toBe('5mL vial')
  })

  // WO-104: the sig fallback is for a legacy saved link only, and reads
  // the sig that link carried once — editing the sig on the page no longer
  // changes the derived values (the structured duration never did, WO-101).
  it('a legacy link reads the duration from the sig it carried; editing the sig does not change it', () => {
    renderMargin({ presetSigText: GINA_SIG, presetQuantity: undefined, availableQuantities: STRIVE_PACKAGES })
    expect(screen.getByTestId('days-supply-value')).toHaveTextContent('30 days')
    fireEvent.change(screen.getByLabelText(/Sig \(Prescription Directions\)/), {
      target: { value: 'Inject 10 units (0.10mL / 0.50mg) subcutaneous once weekly in the morning for 90 days' },
    })
    expect(screen.getByTestId('days-supply-value')).toHaveTextContent('30 days')
    expect(screen.getByTestId('dispense-value')).toHaveTextContent('0.4 mL')   // 4 doses × 0.1 mL
  })

  it('a structured duration from the builder is used as is', () => {
    renderMargin({ presetSigText: GINA_SIG, presetDurationDays: 90, presetQuantity: undefined, availableQuantities: STRIVE_PACKAGES })
    expect(screen.getByTestId('days-supply-value')).toHaveTextContent('90 days')
    expect(screen.getByTestId('dispense-value')).toHaveTextContent('1.2 mL')   // 12 doses × 0.1 mL
  })

  it('an override still wins and persists as sent', async () => {
    renderMargin({ presetSigText: GINA_SIG, presetQuantity: undefined, availableQuantities: STRIVE_PACKAGES })
    fireEvent.click(screen.getByRole('button', { name: 'Override' }))
    fireEvent.change(screen.getByLabelText('Days supply'), { target: { value: '28' } })
    fireEvent.change(screen.getByLabelText('Dispense qty'), { target: { value: '1' } })
    expect(screen.getByTestId('days-supply-value')).toHaveTextContent('28 days')
    expect(screen.getByText(/Provider override in effect/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^Review & Send/ }))
    await waitFor(() => expect(lastSession?.prescriptions).toHaveLength(1))
    expect(lastSession!.prescriptions[0]!.rxDetails).toEqual(expect.objectContaining({
      daysSupply: 28, dispenseQuantity: 1, dispenseUnit: 'mL',
    }))
  })

  it('Save as Draft posts the default quantity and the overridden values (they round-trip on edit)', async () => {
    renderMargin({
      presetSigText: GINA_SIG, presetQuantity: undefined, availableQuantities: STRIVE_PACKAGES, presetDose: '10 units',
      rxDefaults: { ...SEMAGLUTIDE_DEFAULTS },
    })
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ orderId: 'order-1' }) })
    global.fetch = fetchMock as unknown as typeof fetch
    fireEvent.click(screen.getByRole('button', { name: 'Override' }))
    fireEvent.change(screen.getByLabelText('Days supply'), { target: { value: '28' } })

    fireEvent.click(screen.getByRole('button', { name: /Save as Draft/ }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)
    expect(body).toEqual(expect.objectContaining({ dose: '10 units', frequencyCode: 'QW', quantityLabel: '1mL vial' }))
    expect(body.rxDetails).toEqual(expect.objectContaining({ daysSupply: 28, dispenseQuantity: 0.4, dispenseUnit: 'mL' }))
  })
})

describe('MarginBuilderForm — WO-96 fix: a hand-edited sig does not change the structured inputs', () => {
  it('session line and Save as Draft keep the builder dose, frequency and quantity after the sig is edited', async () => {
    renderMargin({ presetDose: '10 units', presetQuantity: '5mL vial', rxDefaults: { ...SEMAGLUTIDE_DEFAULTS } })
    fireEvent.change(screen.getByLabelText(/Sig \(Prescription Directions\)/), {
      target: { value: 'Inject 20 units (0.20mL / 1.00mg) subcutaneously twice daily' },
    })

    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ orderId: 'order-1' }) })
    global.fetch = fetchMock as unknown as typeof fetch
    fireEvent.click(screen.getByRole('button', { name: /Save as Draft/ }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)
    expect(body).toEqual(expect.objectContaining({
      sigText:       'Inject 20 units (0.20mL / 1.00mg) subcutaneously twice daily',
      dose:          '10 units',
      frequencyCode: 'QW',
      quantityLabel: '5mL vial',
    }))
  })
})
