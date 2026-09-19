/**
 * WO-106: the refill picker, and why multiples exist.
 *
 * Lauren Perkins, 2026-09-11 (01:35:48): "they definitely are going to
 * need to do refills, whether that's a oneoff refill or whether that's
 * refilling multiples."
 *
 * Selecting several must produce ONE session holding sibling drafts —
 * that is what lets WO-102 charge shipping once per pharmacy instead of
 * once per refill. The arithmetic is pinned in wo106-refill.test.ts;
 * what is pinned here is that the lines land together.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { RefillPicker, type RefillablePatient } from '../_components/refill-picker'
import { PrescriptionSessionProvider } from '../../new-prescription/_context/prescription-session'

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), refresh: jest.fn() }),
}))

const PATIENT = {
  patient_id: 'patient-1', first_name: 'Alex', last_name: 'Demo',
  date_of_birth: '1985-06-15', phone: '+15125550000', state: 'TX', sms_opt_in: true,
}
const PROVIDER = {
  provider_id: 'prov-1', first_name: 'Sarah', last_name: 'Chen',
  npi_number: '1234567890', signature_hash: null,
}

function order(over: Partial<RefillablePatient['orders'][number]> = {}) {
  return {
    orderId: 'order-1', medicationName: 'Semaglutide', dose: '40 units',
    pharmacyId: 'ph-strive', pharmacyName: 'Strive Pharmacy',
    createdAt: '2026-08-12T10:00:00.000Z', status: 'DELIVERED',
    isTitration: false, packageLabel: '5 mL vial', packageCount: 2,
    refillsUsed: 0, refillsAuthorized: 2, refillable: true, blockedReason: null,
    ...over,
  }
}

const PATIENTS: RefillablePatient[] = [{
  patient: PATIENT,
  orders: [
    order(),
    order({ orderId: 'order-2', medicationName: 'BPC-157', dose: '250 mcg' }),
    order({
      orderId: 'order-3', medicationName: 'Testosterone', dose: '100 mg',
      refillsUsed: 2, refillsAuthorized: 2, refillable: false,
      blockedReason: 'All 2 authorized refills have been used. Write a new prescription.',
    }),
  ],
}]

const fetchMock = jest.fn()
beforeAll(() => { global.fetch = fetchMock as unknown as typeof fetch })
beforeEach(() => {
  jest.clearAllMocks()
  sessionStorage.clear()
  fetchMock.mockResolvedValue({
    ok: true, status: 200,
    json: async () => ({
      patientId: PATIENT.patient_id,
      // The shape /api/orders/refill returns: a full session line per
      // source order, each pointing back at it.
      lines: [
        {
          refillOfOrderId: 'order-1', pharmacyId: 'ph-strive', pharmacyName: 'Strive Pharmacy',
          itemId: null, formulationId: 'f-sema', medicationName: 'Semaglutide', form: 'Injectable Solution',
          dose: '40 units', frequencyCode: 'QW', quantityLabel: '5 mL vial',
          sigText: 'Inject 40 units subcutaneous once weekly', sigMode: 'standard', titrationSteps: [],
          retailCents: 23100, wholesaleCents: 28500, deaSchedule: null, integrationTier: '',
        },
        {
          refillOfOrderId: 'order-2', pharmacyId: 'ph-strive', pharmacyName: 'Strive Pharmacy',
          itemId: null, formulationId: 'f-bpc', medicationName: 'BPC-157', form: 'Injectable Solution',
          dose: '250 mcg', frequencyCode: 'QD', quantityLabel: '5 mL vial',
          sigText: 'Inject 250 mcg subcutaneous once daily', sigMode: 'standard', titrationSteps: [],
          retailCents: 13000, wholesaleCents: 6500, deaSchedule: null, integrationTier: '',
        },
      ],
    }),
  })
})

function renderPicker(preselect: string | null = null) {
  return render(
    <PrescriptionSessionProvider>
      <RefillPicker patients={PATIENTS} provider={PROVIDER} preselectOrderId={preselect} />
    </PrescriptionSessionProvider>,
  )
}

const STORAGE_KEY = 'compoundiq-rx-session'
const storedSession = () => JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '{}') as {
  patient?: { patient_id: string }
  prescriptions?: { refillOfOrderId?: string; pharmacyId?: string }[]
}

describe('refilling several at once', () => {
  it('sends both orders and lands both lines in ONE session', async () => {
    renderPicker()
    fireEvent.change(screen.getByTestId('refill-patient-select'), { target: { value: 'patient-1' } })

    fireEvent.click(screen.getByTestId('refill-order-order-1'))
    fireEvent.click(screen.getByTestId('refill-order-order-2'))
    fireEvent.click(screen.getByTestId('refill-start'))

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/new-prescription/review'))

    // One request, both orders — not one request per refill.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body) as { orderIds: string[] }
    expect(body.orderIds.sort()).toEqual(['order-1', 'order-2'])

    // Both lines are siblings in one session, at the same pharmacy, which
    // is what makes WO-102 charge shipping once rather than twice.
    await waitFor(() => expect(storedSession().prescriptions).toHaveLength(2))
    const stored = storedSession()
    expect(stored.patient?.patient_id).toBe('patient-1')
    expect(stored.prescriptions!.map(p => p.refillOfOrderId)).toEqual(['order-1', 'order-2'])
    expect(new Set(stored.prescriptions!.map(p => p.pharmacyId))).toEqual(new Set(['ph-strive']))
  })

  it('the session is already in storage at the moment it navigates', async () => {
    // Review mounts under a different session provider (its own layout),
    // which can only see what is in sessionStorage. So the session must
    // be there when router.push runs — not written later by an effect of
    // the provider this page is leaving.
    let atPush: ReturnType<typeof storedSession> | null = null
    mockPush.mockImplementation(() => { atPush = storedSession() })

    renderPicker()
    fireEvent.change(screen.getByTestId('refill-patient-select'), { target: { value: 'patient-1' } })
    fireEvent.click(screen.getByTestId('refill-order-order-1'))
    fireEvent.click(screen.getByTestId('refill-order-order-2'))
    fireEvent.click(screen.getByTestId('refill-start'))

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/new-prescription/review'))
    expect(atPush).not.toBeNull()
    expect(atPush!.patient?.patient_id).toBe('patient-1')
    expect(atPush!.prescriptions?.map(p => p.refillOfOrderId)).toEqual(['order-1', 'order-2'])
  })

  it('the button says how many, and does nothing with none selected', () => {
    renderPicker()
    fireEvent.change(screen.getByTestId('refill-patient-select'), { target: { value: 'patient-1' } })
    expect(screen.getByTestId('refill-start')).toBeDisabled()
    fireEvent.click(screen.getByTestId('refill-order-order-1'))
    expect(screen.getByTestId('refill-start')).toHaveTextContent('Refill 1 prescription')
    fireEvent.click(screen.getByTestId('refill-order-order-2'))
    expect(screen.getByTestId('refill-start')).toHaveTextContent('Refill 2 prescriptions')
  })
})

describe('an exhausted authorization', () => {
  it('cannot be selected, and says what to do instead', () => {
    renderPicker()
    fireEvent.change(screen.getByTestId('refill-patient-select'), { target: { value: 'patient-1' } })
    expect(screen.getByTestId('refill-order-order-3')).toBeDisabled()
    expect(screen.getByTestId('refill-blocked-order-3'))
      .toHaveTextContent('All 2 authorized refills have been used. Write a new prescription.')
  })

  it('shows how many refills each prescription has left', () => {
    renderPicker()
    fireEvent.change(screen.getByTestId('refill-patient-select'), { target: { value: 'patient-1' } })
    expect(screen.getByTestId('refill-order-list')).toHaveTextContent('0 of 2 refills used')
  })
})

describe('one order from the drawer or a table row', () => {
  it('opens pre-selected, with the patient\'s other prescriptions beside it', () => {
    renderPicker('order-2')
    expect(screen.getByTestId('refill-order-order-2')).toBeChecked()
    expect(screen.getByTestId('refill-order-order-1')).not.toBeChecked()
    // The one-off can become a multiple, which is the point.
    expect(screen.getByTestId('refill-start')).toHaveTextContent('Refill 1 prescription')
  })
})

describe('a server refusal is shown, not swallowed', () => {
  it('surfaces the message and stays on the page', async () => {
    fetchMock.mockResolvedValue({
      ok: false, status: 409,
      json: async () => ({ error: 'All 2 authorized refills have been used. Write a new prescription.' }),
    })
    renderPicker()
    fireEvent.change(screen.getByTestId('refill-patient-select'), { target: { value: 'patient-1' } })
    fireEvent.click(screen.getByTestId('refill-order-order-1'))
    fireEvent.click(screen.getByTestId('refill-start'))

    await waitFor(() => expect(screen.getByTestId('refill-error')).toHaveTextContent('All 2 authorized refills have been used'))
    expect(mockPush).not.toHaveBeenCalled()
  })
})
