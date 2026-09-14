/**
 * WO-101 on the price step (Gina Rooks 2026-09-11, item 3):
 *   a) the provider can select the vial size,
 *   b) cost changes with the vial size,
 *   c) the app suggests the vial size from the Rx entered.
 *
 * "Package: 1 mL vial (suggested for 30 days)" with its price and a
 * dropdown; hidden when the pharmacy has a single package. Changing it
 * recomputes wholesale, retail, platform fee and clinic margin, and the
 * quantity the line stores.
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
        availableQuantities={['1 mL vial', '2.5 mL vial', '5 mL vial']}
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

describe('MarginBuilderForm — WO-101 package (vial size)', () => {
  it('10 units weekly for 30 days → suggests the 1 mL vial at $95.00', () => {
    renderMargin()
    expect(screen.getByTestId('package-summary')).toHaveTextContent('Package: 1 mL vial (suggested for 30 days) · $95.00')
    expect(screen.getByLabelText('Package')).toHaveValue('pkg-1')
    expect(lockedWholesale()).toBe('$95.00')
    // 100% default markup → $190.00; fee 15% of the $95 margin; clinic keeps the rest.
    expect(screen.getByLabelText(/Retail Price/)).toHaveValue(190)
    expect(marginSummary()).toContain('$14.25')
    expect(marginSummary()).toContain('$80.75')
  })

  it('40 units weekly for 30 days → suggests the 2.5 mL vial and the price moves to $165.00', () => {
    renderMargin({ dose: '40 units', presetDose: '40 units' })
    expect(screen.getByTestId('package-summary')).toHaveTextContent('Package: 2.5 mL vial (suggested for 30 days) · $165.00')
    expect(lockedWholesale()).toBe('$165.00')
    expect(screen.getByLabelText(/Retail Price/)).toHaveValue(330)
    expect(marginSummary()).toContain('$24.75')   // 15% of $165
    expect(marginSummary()).toContain('$140.25')
  })

  it('the dropdown lists every package with its price and marks the suggestion', () => {
    renderMargin()
    const options = Array.from((screen.getByLabelText('Package') as HTMLSelectElement).options).map(o => o.textContent)
    expect(options).toEqual([
      '1 mL vial — $95.00 (suggested)',
      '2.5 mL vial — $165.00',
      '5 mL vial — $285.00',
    ])
  })

  it('changing the package updates wholesale, retail, platform fee, clinic margin and the stored quantity', async () => {
    renderMargin()
    fireEvent.change(screen.getByLabelText('Package'), { target: { value: 'pkg-5' } })

    expect(screen.getByTestId('package-summary')).toHaveTextContent('Package: 5 mL vial (changed by provider) · $285.00')
    expect(lockedWholesale()).toBe('$285.00')
    // Retail keeps the 2× markup the provider had: $190 × 285 / 95.
    expect(screen.getByLabelText(/Retail Price/)).toHaveValue(570)
    expect(marginSummary()).toContain('$42.75')   // 15% of $285
    expect(marginSummary()).toContain('$242.25')

    fireEvent.click(screen.getByRole('button', { name: /^Review & Send/ }))
    await waitFor(() => expect(lastSession?.prescriptions).toHaveLength(1))
    const rx = lastSession!.prescriptions[0]!
    expect(rx).toEqual(expect.objectContaining({
      packageId:      'pkg-5',
      packageLabel:   '5 mL vial',
      quantityLabel:  '5 mL vial',
      wholesaleCents: 28500,
      retailCents:    57000,
    }))
    // Days supply / dispense still come from the Rx, not the vial.
    expect(rx.rxDetails).toEqual(expect.objectContaining({ daysSupply: 30, dispenseQuantity: 0.4, dispenseUnit: 'mL' }))
  })

  it('the suggested package travels on the session line when left alone', async () => {
    renderMargin({ dose: '40 units', presetDose: '40 units' })
    fireEvent.click(screen.getByRole('button', { name: /^Review & Send/ }))
    await waitFor(() => expect(lastSession?.prescriptions).toHaveLength(1))
    expect(lastSession!.prescriptions[0]).toEqual(expect.objectContaining({
      packageId: 'pkg-2.5', packageLabel: '2.5 mL vial', quantityLabel: '2.5 mL vial', wholesaleCents: 16500,
    }))
  })

  it('a formulation with a single package shows no package control and keeps its price', () => {
    renderMargin({ packages: [STRIVE_VIALS[0]!] })
    expect(screen.queryByTestId('package-control')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Package')).not.toBeInTheDocument()
    expect(lockedWholesale()).toBe('$95.00')
  })

  it('no packages at all (not yet imported) → no control, price from the pharmacy formulation', () => {
    renderMargin({ packages: [], wholesalePrice: 120, presetQuantity: '5mL vial' })
    expect(screen.queryByTestId('package-control')).not.toBeInTheDocument()
    expect(lockedWholesale()).toBe('$120.00')
  })

  it('the suggestion uses the structured duration, not a hand-edited sig', () => {
    renderMargin({ dose: '40 units', presetDose: '40 units' })
    fireEvent.change(screen.getByLabelText(/Sig \(Prescription Directions\)/), {
      target: { value: 'Inject 40 units subcutaneously once weekly for 90 days' },
    })
    expect(screen.getByTestId('package-summary')).toHaveTextContent('Package: 2.5 mL vial (suggested for 30 days)')
    expect(screen.getByTestId('days-supply-value')).toHaveTextContent('30 days')
  })

  it('no duration selected → the pharmacy default package, labelled as such', () => {
    renderMargin({ dose: '40 units', presetDose: '40 units', presetDurationDays: null })
    expect(screen.getByTestId('package-summary')).toHaveTextContent('Package: 1 mL vial (default package — no duration selected) · $95.00')
  })

  it('Save as Draft sends the package id so the server prices from it', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ orderId: 'o1' }) })
    global.fetch = fetchMock as unknown as typeof fetch
    renderMargin({ dose: '40 units', presetDose: '40 units' })
    await waitFor(() => expect(screen.getByRole('button', { name: /Save as Draft/ })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: /Save as Draft/ }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)
    expect(body).toEqual(expect.objectContaining({ packageId: 'pkg-2.5', quantityLabel: '2.5 mL vial', retailCents: 33000 }))
  })

  it('editing a session line keeps the package it was saved with', async () => {
    const line = {
      id: 'line-1', pharmacyId: 'pharmacy-strive', pharmacyName: 'Strive Pharmacy', itemId: null,
      formulationId: 'formulation-sema', medicationName: 'Semaglutide 5mg/mL Injectable', form: 'Injectable Solution',
      dose: '10 units', wholesaleCents: 28500, deaSchedule: null, retailCents: 57000,
      sigText: 'Inject 10 units subcutaneously once weekly for 30 days', integrationTier: '',
      packageId: 'pkg-5', packageLabel: '5 mL vial',
    }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ patient: PATIENT, provider: PROVIDER, prescriptions: [line], notices: [] }))
    render(
      <PrescriptionSessionProvider>
        <MarginBuilderForm
          pharmacyId="pharmacy-strive" itemId={null} formulationId="formulation-sema" pharmacyName="Strive Pharmacy"
          medicationName="Semaglutide 5mg/mL Injectable" form="Injectable Solution" dose="10 units" wholesalePrice={95}
          deaSchedule={0} defaultMarkupPct={100} presetFrequency="QW" presetDurationDays={30}
          formulationDetails={{ concentrationValue: 5, concentrationUnit: 'mg/mL', dosageFormName: 'Injectable Solution' }}
          rxDefaults={SEMAGLUTIDE_DEFAULTS} packages={STRIVE_VIALS}
          editTarget={{ kind: 'session', lineId: 'line-1' }}
        />
      </PrescriptionSessionProvider>,
    )
    await waitFor(() => expect(screen.getByLabelText('Package')).toHaveValue('pkg-5'))
    expect(lockedWholesale()).toBe('$285.00')
  })
})
