/**
 * Save as Draft clears the prescription session only once the price step
 * has unmounted (the dashboard navigation committed), never before, and
 * leaving the page without saving keeps it. Pinned before the latest
 * clearSession stopped being written to a ref during render
 * (eslint-plugin-react-hooks 7.1: refs); behaviour unchanged.
 */

import { useEffect, useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PrescriptionSessionProvider, usePrescriptionSession } from '../../../_context/prescription-session'
import { MarginBuilderForm } from '../margin-builder-form'
import { STANDARD_CLINICAL_DIFFERENCE_OPTIONS, type PackageOption } from '@/lib/orders/rx-details'

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), refresh: jest.fn() }),
}))

const STORAGE_KEY = 'compoundiq-rx-session'
const VIALS: PackageOption[] = [
  { id: 'pkg-1',   label: '1 mL vial',   qty: 1,   unit: 'mL', wholesalePrice: 95,  isDefault: true },
  { id: 'pkg-2.5', label: '2.5 mL vial', qty: 2.5, unit: 'mL', wholesalePrice: 165, isDefault: false },
]
const PATIENT = { patient_id: '11111111-1111-4111-8111-111111111111', first_name: 'Alex', last_name: 'Demo', date_of_birth: '1985-06-15', phone: '+15125550000', state: 'TX', sms_opt_in: true }
const PROVIDER = { provider_id: '22222222-2222-4222-8222-222222222222', first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', signature_hash: null }
const DEFAULTS = {
  formulationId: 'formulation-sema',
  defaults: { default_syringe_option: 'sc_kit' as const, default_shipping_type: 'cold_chain' as const, clinical_difference_options: [...STANDARD_CLINICAL_DIFFERENCE_OPTIONS], requires_clinical_difference: true },
  deaSchedule: null,
  suggestedDiagnosis: null,
}

let session: ReturnType<typeof usePrescriptionSession> | null = null
function Probe() {
  const s = usePrescriptionSession()
  useEffect(() => { session = s }, [s])
  return null
}

// The route change: the price step unmounts, the session provider stays.
const unmountForm = () => fireEvent.click(screen.getByRole('button', { name: 'Leave the price step' }))
function Page() {
  const [shown, setShown] = useState(true)
  return (
    <PrescriptionSessionProvider>
      <Probe />
      <button type="button" onClick={() => setShown(false)}>Leave the price step</button>
      {shown && (
        <MarginBuilderForm
          pharmacyId="pharmacy-strive" itemId={null} formulationId="formulation-sema" pharmacyName="Strive Pharmacy"
          medicationName="Semaglutide 5mg/mL Injectable" form="Injectable Solution" dose="40 units" wholesalePrice={95}
          deaSchedule={0} defaultMarkupPct={100}
          presetSigText="Inject 40 units (0.40mL / 2mg) subcutaneously once weekly for 30 days"
          presetFrequency="QW" presetQuantity="2.5 mL vial" presetDose="40 units" presetDurationDays={30}
          packages={VIALS} presetRefills={0}
          formulationDetails={{ concentrationValue: 5, concentrationUnit: 'mg/mL', dosageFormName: 'Injectable Solution' }}
          rxDefaults={DEFAULTS}
        />
      )}
    </PrescriptionSessionProvider>
  )
}

beforeEach(() => {
  sessionStorage.clear()
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ patient: PATIENT, provider: PROVIDER, prescriptions: [], notices: [] }))
  mockPush.mockReset()
  session = null
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ orderId: 'o1' }) }) as unknown as typeof fetch
})

it('Save as Draft: the session survives until the price step unmounts, then is cleared', async () => {
  render(<Page />)
  const save = screen.getByRole('button', { name: /Save as Draft/ })
  await waitFor(() => expect(save).not.toBeDisabled())
  fireEvent.click(save)
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith(expect.stringMatching(/^\/dashboard/)))
  expect(session?.patient?.patient_id).toBe(PATIENT.patient_id)
  act(() => unmountForm())
  await waitFor(() => expect(session?.patient).toBeNull())
})

it('leaving without saving keeps the session', async () => {
  render(<Page />)
  await waitFor(() => expect(session?.patient?.patient_id).toBe(PATIENT.patient_id))
  act(() => unmountForm())
  await act(async () => {})
  expect(session?.patient?.patient_id).toBe(PATIENT.patient_id)
})
