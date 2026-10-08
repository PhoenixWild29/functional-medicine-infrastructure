/**
 * Review warns when even 20 packages (the most one line can carry) do not
 * cover a line's course: "Shorten the duration or split the course." The
 * provider shortens it on the price step and saves. The warning must go
 * once the line fits, and stay (restated) when the new length still does
 * not fit. It used to stay forever: the save never touched it.
 */

import { act, fireEvent, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { PrescriptionSessionProvider, usePrescriptionSession, type SessionPrescription } from '../../../_context/prescription-session'
import { MarginBuilderForm } from '../margin-builder-form'
import { STANDARD_CLINICAL_DIFFERENCE_OPTIONS, defaultRxDetails, type PackageOption } from '@/lib/orders/rx-details'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}))

const STORAGE_KEY = 'compoundiq-rx-session'
const PHARMACY = 'pharmacy-portal-plus'
const RATES = { pharmacyId: PHARMACY, pharmacyName: 'Portal Plus Pharmacy', standardCents: 1100, coldChainCents: 2500, freeShippingThresholdCents: null }
const PATIENT = { patient_id: '11111111-1111-4111-8111-111111111111', first_name: 'Alex', last_name: 'Demo', date_of_birth: '1975-06-15', phone: '+15125550000', state: 'TX', sms_opt_in: true }
const PROVIDER = { provider_id: '22222222-2222-4222-8222-222222222222', first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', signature_hash: null }
const CAPS_30: PackageOption[] = [{ id: 'pkg-30', label: '30 caps', qty: 30, unit: 'capsule', wholesalePrice: 18.5, isDefault: true }]

const STALE = '20 × 30 caps is the most one line can carry and does not cover the 900 capsules needed for 900 days. Shorten the duration or split the course.'

const LINE: SessionPrescription = {
  id: 'line-prog', pharmacyId: PHARMACY, pharmacyName: 'Portal Plus Pharmacy', itemId: null, formulationId: 'f-prog',
  medicationName: 'Progesterone 100 mg Capsule', form: 'Capsule', dose: '1 capsule', wholesaleCents: 37000, deaSchedule: null,
  retailCents: 51800, sigText: 'Take 1 capsule by mouth at bedtime', integrationTier: 'TIER_2_PORTAL',
  frequencyCode: 'QHS', quantityLabel: '30 caps', packageId: 'pkg-30', packageLabel: '30 caps', packageCount: 20,
  rxDetails: { ...defaultRxDetails(null), shippingType: 'standard', daysSupply: 900, dispenseQuantity: 900, dispenseUnit: 'capsule' },
  sizingWarning: STALE,
}

const latest: { session: ReturnType<typeof usePrescriptionSession> | null } = { session: null }
function SessionProbe() {
  const current = usePrescriptionSession()
  useEffect(() => { latest.session = current })
  return null
}

function renderEdit(durationDays: number) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ patient: PATIENT, provider: PROVIDER, prescriptions: [LINE], notices: [] }))
  render(
    <PrescriptionSessionProvider>
      <SessionProbe />
      <MarginBuilderForm
        pharmacyId={PHARMACY} itemId={null} formulationId="f-prog" pharmacyName="Portal Plus Pharmacy"
        medicationName={LINE.medicationName} form="Capsule" dose="1 capsule" wholesalePrice={18.5} deaSchedule={0}
        defaultMarkupPct={40} presetSigText={LINE.sigText} presetFrequency="QHS" presetQuantity="30 caps" presetDose="1 capsule"
        presetDurationDays={durationDays} presetRefills={0} packages={CAPS_30} shippingRates={RATES}
        formulationDetails={{ concentrationValue: null, concentrationUnit: null, dosageFormName: 'Capsule' }}
        rxDefaults={{
          formulationId: 'f-prog',
          defaults: { default_syringe_option: 'none', default_shipping_type: 'standard', clinical_difference_options: [...STANDARD_CLINICAL_DIFFERENCE_OPTIONS], requires_clinical_difference: false },
          deaSchedule: null, suggestedDiagnosis: null,
        }}
        editTarget={{ kind: 'session', lineId: LINE.id }}
      />
    </PrescriptionSessionProvider>,
  )
}

async function save() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Save Changes — Back to Review/ }))
  })
}

beforeEach(() => {
  sessionStorage.clear()
  latest.session = null
})

it('shortened to 90 days (3 bottles): the 20-package warning is gone', async () => {
  renderEdit(90)
  await save()
  const saved = latest.session!.prescriptions.find(rx => rx.id === LINE.id)!
  expect(saved.rxDetails?.daysSupply).toBe(90)
  expect(saved.sizingWarning ?? null).toBeNull()
})

it('still too long (900 days): the warning stays, restated for the saved line', async () => {
  renderEdit(900)
  await save()
  const saved = latest.session!.prescriptions.find(rx => rx.id === LINE.id)!
  expect(saved.sizingWarning).toEqual(expect.stringContaining('is the most one line can carry'))
  expect(saved.sizingWarning).toEqual(expect.stringContaining('900 days'))
})
