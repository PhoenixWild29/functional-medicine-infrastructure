/**
 * Cycling dose math on the price step and the Review card (rule 3:
 * nothing on screen the app could have computed, and what it computed
 * is shown).
 *
 * 10 units once daily, 5 days on / 2 days off, for 30 days: 22 dosing
 * days, 2.2 mL, the 2.5 mL vial. Before this, the page priced 30 doses
 * (3.0 mL) and the 5 mL vial.
 */

import { useEffect } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PrescriptionSessionProvider, usePrescriptionSession, type SessionPrescription } from '../../../_context/prescription-session'
import { MarginBuilderForm } from '../margin-builder-form'
import { RxDetailsRow } from '../../../review/_components/rx-details-row'
import { orderPostBody, sendBlock } from '../../../review/_components/batch-review-form'
import { STANDARD_CLINICAL_DIFFERENCE_OPTIONS, defaultRxDetails, type PackageOption } from '@/lib/orders/rx-details'

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

const CYCLING_SIG = 'Inject 10 units (0.10mL / 0.50mg) subcutaneous once daily, 5 days on / 2 days off, for 30 days then reassess'

let lastSession: ReturnType<typeof usePrescriptionSession> | null = null
function SessionProbe() {
  const session = usePrescriptionSession()
  useEffect(() => { lastSession = session }, [session])
  return null
}

let sentBody: Record<string, unknown> | null = null

function renderMargin(overrides: Partial<React.ComponentProps<typeof MarginBuilderForm>> = {}) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ patient: PATIENT, provider: PROVIDER, prescriptions: [], notices: [] }))
  return render(
    <PrescriptionSessionProvider>
      <SessionProbe />
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
        presetSigText={CYCLING_SIG}
        presetFrequency="QD"
        presetDose="10 units"
        presetDurationDays={30}
        packages={VIALS}
        presetRefills={0}
        formulationDetails={{ concentrationValue: 5, concentrationUnit: 'mg/mL', dosageFormName: 'Injectable Solution' }}
        rxDefaults={RX_DEFAULTS}
        presetSigMode="cycling"
        presetCycle={{ onDays: 5, offDays: 2 }}
        {...overrides}
      />
    </PrescriptionSessionProvider>,
  )
}

beforeEach(() => {
  sessionStorage.clear()
  mockPush.mockReset()
  lastSession = null
  sentBody = null
  global.fetch = jest.fn(async (_url: unknown, init?: { body?: string }) => {
    sentBody = JSON.parse(init?.body ?? '{}') as Record<string, unknown>
    return { ok: true, status: 201, json: async () => ({ orderId: 'new-draft-1' }) } as unknown as Response
  }) as unknown as typeof fetch
})

describe('the price step sizes a cycling line by its dosing days', () => {
  it('shows 22 dosing days, dispenses 2.2 mL and suggests the 2.5 mL vial', () => {
    renderMargin()
    expect(screen.getByTestId('days-supply-value')).toHaveTextContent('30 days')
    expect(screen.getByTestId('dispense-value')).toHaveTextContent('2.2 mL')
    expect(screen.getByTestId('dosing-days')).toHaveTextContent(
      '22 dosing days in 30 days (5 days on / 2 days off, starting on an on-day)',
    )
    expect(screen.getByTestId('package-summary')).toHaveTextContent('Package: 2.5 mL vial (suggested for 30 days)')
  })

  it('the line it adds carries the pattern and the corrected numbers', async () => {
    renderMargin()
    fireEvent.click(screen.getByRole('button', { name: /^Review & Send/ }))
    await waitFor(() => expect(lastSession?.prescriptions).toHaveLength(1))
    const rx = lastSession!.prescriptions[0]!
    expect(rx.sigMode).toBe('cycling')
    expect(rx.cycle).toEqual({ onDays: 5, offDays: 2, lengthDays: 30 })
    expect(rx.rxDetails?.dispenseQuantity).toBe(2.2)
    expect(rx.packageLabel).toBe('2.5 mL vial')
  })

  it('Save as Draft sends the pattern', async () => {
    renderMargin()
    fireEvent.click(screen.getByRole('button', { name: /Save as Draft/ }))
    await waitFor(() => expect(sentBody).not.toBeNull())
    expect(sentBody!['sigMode']).toBe('cycling')
    expect(sentBody!['cycleOnDays']).toBe(5)
    expect(sentBody!['cycleOffDays']).toBe(2)
  })

  it('a standard line shows no dosing-day line and is sized as before', () => {
    renderMargin({
      presetSigMode: 'standard', presetCycle: null,
      presetSigText: 'Inject 10 units (0.10mL / 0.50mg) subcutaneous once daily for 30 days',
    })
    expect(screen.queryByTestId('dosing-days')).not.toBeInTheDocument()
    expect(screen.getByTestId('dispense-value')).toHaveTextContent('3 mL')
    expect(screen.getByTestId('package-summary')).toHaveTextContent('Package: 5 mL vial (suggested for 30 days)')
  })
})

describe('the Review card', () => {
  const LINE: SessionPrescription = {
    id: 'line-1', pharmacyId: 'pharmacy-strive', pharmacyName: 'Strive Pharmacy', itemId: null,
    formulationId: 'formulation-sema', medicationName: 'Semaglutide', form: 'Injectable Solution',
    dose: '10 units', frequencyCode: 'QD', wholesaleCents: 12000, retailCents: 24000,
    sigText: CYCLING_SIG, deaSchedule: null, sigMode: 'cycling',
    cycle: { onDays: 5, offDays: 2, lengthDays: 30 },
    rxDetails: { ...defaultRxDetails(null), daysSupply: 30, dispenseQuantity: 2.2, dispenseUnit: 'mL' },
  } as SessionPrescription

  it('shows the dosing-day count beside the days supply', () => {
    render(
      <RxDetailsRow
        lineId="line-1"
        details={LINE.rxDetails!}
        rules={{ isControlled: false, requiresClinicalDifference: false, clinicalDifferenceOptions: [] }}
        missing={[]}
        disabled={false}
        onChange={() => {}}
        cycle={{ onDays: 5, offDays: 2 }}
      />,
    )
    expect(screen.getByTestId('rx-dosing-days-line-1')).toHaveTextContent('22 dosing days (5 on / 2 off)')
  })

  it('sends the pattern with the order', () => {
    const body = orderPostBody(LINE, { patient_id: PATIENT.patient_id, state: 'TX' }, { provider_id: PROVIDER.provider_id }, LINE.rxDetails!)
    expect(body.sigMode).toBe('cycling')
    expect(body.cycleOnDays).toBe(5)
    expect(body.cycleOffDays).toBe(2)
  })

  it('a cycling line with no pattern cannot be sent: the days on and off are owed', () => {
    expect(sendBlock(LINE)).toBeNull()
    expect(sendBlock({ ...LINE, cycle: null })).toBe('cycle_pattern')
    expect(sendBlock({ ...LINE, sigMode: 'standard', cycle: null })).toBeNull()
  })
})
