/**
 * WO-101a on the price step: when no single vial holds the Rx, the
 * suggestion is how many of which vial, priced as package × count.
 *
 *   "Package: 2 × 5 mL vials (suggested for 90 days) · $570.00"
 *
 * The provider can change the package or the count; either recomputes
 * wholesale, retail, platform fee and clinic margin. Count 1 reads
 * exactly as WO-101. Hidden only when the pharmacy has one package and
 * one of it covers the Rx.
 */

import { useEffect } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PrescriptionSessionProvider, usePrescriptionSession } from '../../../_context/prescription-session'
import { MarginBuilderForm } from '../margin-builder-form'
import { STANDARD_CLINICAL_DIFFERENCE_OPTIONS, type PackageOption } from '@/lib/orders/rx-details'

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), refresh: jest.fn() }),
}))

const STORAGE_KEY = 'compoundiq-rx-session'

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
        presetSigText="Inject 10 units (0.10mL / 0.50mg) subcutaneously once weekly in the morning for 30 days"
        presetFrequency="QW"
        presetQuantity="1 mL vial"
        presetDose="10 units"
        presetDurationDays={30}
        packages={STRIVE_VIALS}
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

/** The locked wholesale figure in the header card. */
function lockedWholesale(): string {
  return document.querySelector('p.text-xl')?.textContent ?? ''
}

function marginSummary(): string {
  return screen.getByText('Margin Summary').parentElement!.textContent ?? ''
}

// 80 units weekly for 90 days = 12 doses × 0.8 mL = 9.6 mL.
const HIGH_DOSE = {
  dose: '80 units', presetDose: '80 units', presetDurationDays: 90,
  presetSigText: 'Inject 80 units (0.80mL / 4.00mg) subcutaneously once weekly in the morning for 90 days',
}

describe('MarginBuilderForm — WO-101a package count', () => {
  it('no single vial covers 9.6 mL → 2 × 5 mL vials at $570.00', () => {
    renderMargin(HIGH_DOSE)
    expect(screen.getByTestId('package-summary')).toHaveTextContent('Package: 2 × 5 mL vials (suggested for 90 days) · $570.00')
    expect(screen.getByLabelText('Package')).toHaveValue('pkg-5')
    expect(screen.getByLabelText('Number of packages')).toHaveValue(2)
    expect(lockedWholesale()).toBe('$570.00')
    // 100% default markup on the total.
    expect(screen.getByLabelText(/Retail Price/)).toHaveValue(1140)
    expect(marginSummary()).toContain('$85.50')    // 15% of $570
    expect(marginSummary()).toContain('$484.50')
    expect(screen.queryByText(/does not cover/)).not.toBeInTheDocument()
  })

  it('count 1 reads exactly as WO-101', () => {
    renderMargin()
    expect(screen.getByTestId('package-summary')).toHaveTextContent('Package: 1 mL vial (suggested for 30 days) · $95.00')
    expect(screen.getByLabelText('Number of packages')).toHaveValue(1)
  })

  it('changing the count recomputes wholesale, retail, fee and margin', () => {
    renderMargin(HIGH_DOSE)
    fireEvent.change(screen.getByLabelText('Number of packages'), { target: { value: '3' } })
    expect(screen.getByTestId('package-summary')).toHaveTextContent('Package: 3 × 5 mL vials (changed by provider) · $855.00')
    expect(lockedWholesale()).toBe('$855.00')
    expect(screen.getByLabelText(/Retail Price/)).toHaveValue(1710)   // 2× markup kept
    expect(marginSummary()).toContain('$128.25')   // 15% of $855
    expect(marginSummary()).toContain('$726.75')
  })

  it('the count is clamped to 1..20', () => {
    renderMargin(HIGH_DOSE)
    fireEvent.change(screen.getByLabelText('Number of packages'), { target: { value: '50' } })
    expect(screen.getByLabelText('Number of packages')).toHaveValue(20)
    expect(lockedWholesale()).toBe('$5700.00')
    fireEvent.change(screen.getByLabelText('Number of packages'), { target: { value: '0' } })
    expect(screen.getByLabelText('Number of packages')).toHaveValue(1)
  })

  it('changing the package gives it the count that package needs', () => {
    renderMargin(HIGH_DOSE)
    fireEvent.change(screen.getByLabelText('Package'), { target: { value: 'pkg-2.5' } })
    // 9.6 mL from 2.5 mL vials → 4 × $165 = $660; retail keeps the 2× markup.
    expect(screen.getByTestId('package-summary')).toHaveTextContent('Package: 4 × 2.5 mL vials (changed by provider) · $660.00')
    expect(screen.getByLabelText('Number of packages')).toHaveValue(4)
    expect(screen.getByLabelText(/Retail Price/)).toHaveValue(1320)
  })

  it('the session line and Save as Draft carry the count', async () => {
    renderMargin(HIGH_DOSE)
    fireEvent.click(screen.getByRole('button', { name: /^Review & Send/ }))
    await waitFor(() => expect(lastSession?.prescriptions).toHaveLength(1))
    expect(lastSession!.prescriptions[0]).toEqual(expect.objectContaining({
      packageId: 'pkg-5', packageLabel: '5 mL vial', packageCount: 2, wholesaleCents: 57000, quantityLabel: '5 mL vial',
    }))
    expect(lastSession!.prescriptions[0]!.rxDetails).toEqual(expect.objectContaining({ daysSupply: 90, dispenseQuantity: 9.6, dispenseUnit: 'mL' }))
  })

  it('Save as Draft sends packageId + packageCount for the server to price', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ orderId: 'o1' }) })
    global.fetch = fetchMock as unknown as typeof fetch
    renderMargin(HIGH_DOSE)
    await waitFor(() => expect(screen.getByRole('button', { name: /Save as Draft/ })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: /Save as Draft/ }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)
    expect(body).toEqual(expect.objectContaining({ packageId: 'pkg-5', packageCount: 2, retailCents: 114000 }))
  })

  it('a single-package pharmacy shows the control when more than one of it is needed', () => {
    renderMargin({ ...HIGH_DOSE, packages: [STRIVE_VIALS[2]!] })
    expect(screen.getByTestId('package-summary')).toHaveTextContent('Package: 2 × 5 mL vials (suggested for 90 days) · $570.00')
  })

  it('a single-package pharmacy whose one package covers the Rx shows no control (unchanged)', () => {
    renderMargin({ packages: [STRIVE_VIALS[2]!] })
    expect(screen.queryByTestId('package-control')).not.toBeInTheDocument()
  })

  it('more than 20 vials would be needed → 20, and the line says it does not cover', () => {
    renderMargin({
      dose: '1 mL', presetDose: '1 mL', presetFrequency: 'QD', presetDurationDays: 150,
      presetSigText: 'Inject 1 mL subcutaneously once daily for 150 days',
    })
    expect(screen.getByTestId('package-summary')).toHaveTextContent('Package: 20 × 5 mL vials (20 is the most per prescription — does not cover 150 days) · $5700.00')
  })

  it('editing a session line keeps its package and count', async () => {
    const line = {
      id: 'line-1', pharmacyId: 'pharmacy-strive', pharmacyName: 'Strive Pharmacy', itemId: null,
      formulationId: 'formulation-sema', medicationName: 'Semaglutide 5mg/mL Injectable', form: 'Injectable Solution',
      dose: '80 units', wholesaleCents: 49500, deaSchedule: null, retailCents: 99000,
      sigText: 'Inject 80 units subcutaneously once weekly for 90 days', integrationTier: '',
      packageId: 'pkg-2.5', packageLabel: '2.5 mL vial', packageCount: 3,
    }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ patient: PATIENT, provider: PROVIDER, prescriptions: [line], notices: [] }))
    render(
      <PrescriptionSessionProvider>
        <MarginBuilderForm
          pharmacyId="pharmacy-strive" itemId={null} formulationId="formulation-sema" pharmacyName="Strive Pharmacy"
          medicationName="Semaglutide 5mg/mL Injectable" form="Injectable Solution" dose="80 units" wholesalePrice={95}
          deaSchedule={0} defaultMarkupPct={100} presetFrequency="QW" presetDurationDays={90}
          formulationDetails={{ concentrationValue: 5, concentrationUnit: 'mg/mL', dosageFormName: 'Injectable Solution' }}
          rxDefaults={SEMAGLUTIDE_DEFAULTS} packages={STRIVE_VIALS}
          editTarget={{ kind: 'session', lineId: 'line-1' }}
        />
      </PrescriptionSessionProvider>,
    )
    await waitFor(() => expect(screen.getByLabelText('Package')).toHaveValue('pkg-2.5'))
    expect(screen.getByLabelText('Number of packages')).toHaveValue(3)
    expect(lockedWholesale()).toBe('$495.00')
  })
})
