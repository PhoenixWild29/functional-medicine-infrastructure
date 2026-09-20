/**
 * WO-105 data loss, first half: the price step's Save as Draft must send
 * the sig mode and the titration steps.
 *
 * handleSaveDraft writes its POST body out by hand instead of using
 * lineBody(), so when WO-105 added sig_mode and titration_steps this
 * path silently dropped both — a titration saved as a draft landed
 * sig_mode 'standard' with no steps, and reopened as a standard line.
 * Nothing failed loudly; the schedule was just gone.
 *
 * The real form runs here. What it sends is asserted against the shared
 * fixture that the companion node test feeds to the real POST handler
 * and the real reopen path, so neither half is driving an invented
 * shape.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PrescriptionSessionProvider } from '../../../_context/prescription-session'
import { MarginBuilderForm } from '../margin-builder-form'
import { STANDARD_CLINICAL_DIFFERENCE_OPTIONS, type PackageOption } from '@/lib/orders/rx-details'
import { STEPS, TITRATION_SIG, PATIENT_ID, PROVIDER_ID } from './wo105-draft-titration-fixture'

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), refresh: jest.fn() }),
}))

const STORAGE_KEY = 'compoundiq-rx-session'

const PATIENT = {
  patient_id: PATIENT_ID,
  first_name: 'Alex', last_name: 'Demo', date_of_birth: '1985-06-15',
  phone: '+15125550000', state: 'TX', sms_opt_in: true,
}
const PROVIDER = {
  provider_id: PROVIDER_ID,
  first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', signature_hash: null,
}

const VIALS: PackageOption[] = [
  { id: 'pkg-1', label: '1 mL vial', qty: 1, unit: 'mL', wholesalePrice: 95,  isDefault: true },
  { id: 'pkg-5', label: '5 mL vial', qty: 5, unit: 'mL', wholesalePrice: 285, isDefault: false },
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

let sentBody: Record<string, unknown> | null = null

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
        presetSigText={TITRATION_SIG}
        presetFrequency="QW"
        presetQuantity="1 mL vial"
        presetDose="10 units"
        presetDurationDays={84}
        packages={VIALS}
        presetRefills={0}
        formulationDetails={{ concentrationValue: 5, concentrationUnit: 'mg/mL', dosageFormName: 'Injectable Solution' }}
        rxDefaults={RX_DEFAULTS}
        presetSigMode="titration"
        presetTitrationSteps={STEPS}
        {...overrides}
      />
    </PrescriptionSessionProvider>,
  )
}

beforeEach(() => {
  sessionStorage.clear()
  mockPush.mockReset()
  sentBody = null
  global.fetch = jest.fn(async (_url: unknown, init?: { body?: string }) => {
    sentBody = JSON.parse(init?.body ?? '{}') as Record<string, unknown>
    return { ok: true, status: 201, json: async () => ({ orderId: 'new-draft-1' }) } as unknown as Response
  }) as unknown as typeof fetch
})

describe('Save as Draft on the price step', () => {
  it('sends the sig mode and the titration steps', async () => {
    renderMargin()
    fireEvent.click(screen.getByRole('button', { name: /Save as Draft/ }))

    await waitFor(() => expect(sentBody).not.toBeNull())
    expect(sentBody!['sigMode']).toBe('titration')
    expect(sentBody!['titrationSteps']).toEqual(STEPS)
  })

  it('sends them alongside everything the draft already carried', async () => {
    renderMargin()
    fireEvent.click(screen.getByRole('button', { name: /Save as Draft/ }))
    await waitFor(() => expect(sentBody).not.toBeNull())

    // The fixture the node half feeds to the real POST handler is this
    // body — so that test is not driving an invented shape.
    expect(sentBody).toEqual(expect.objectContaining({
      patientId:     PATIENT_ID,
      providerId:    PROVIDER_ID,
      formulationId: 'formulation-sema',
      pharmacyId:    'pharmacy-strive',
      patientState:  'TX',
      sigText:       TITRATION_SIG,
      dose:          '10 units',
      frequencyCode: 'QW',
      sigMode:        'titration',
      titrationSteps: STEPS,
    }))
  })

  it('a standard line sends standard and no steps', async () => {
    renderMargin({
      presetSigMode: 'standard',
      presetTitrationSteps: [],
      presetSigText: 'Inject 10 units (0.10mL / 0.50mg) subcutaneous once weekly for 30 days',
      presetDurationDays: 30,
    })
    fireEvent.click(screen.getByRole('button', { name: /Save as Draft/ }))

    await waitFor(() => expect(sentBody).not.toBeNull())
    expect(sentBody!['sigMode']).toBe('standard')
    expect(sentBody!['titrationSteps']).toEqual([])
  })
})
