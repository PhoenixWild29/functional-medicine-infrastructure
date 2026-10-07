/**
 * Prod, 5 Oct, as dr.chen: a row's Refill opens /refill?order=<id> and
 * the patient select stayed on "Select a patient…".
 *
 * The picker pre-selected only an order it could tick: one still
 * refillable and not itself a refill. A prescription with no refills left
 * (0 authorized is common) or a refill order matched nothing, and the page
 * looked as if the link had been ignored.
 *
 * Now ?order= always selects that order's patient. The prescription is
 * ticked when it can be refilled; a refill order points at its source
 * prescription (refills count against the source); one that cannot be
 * refilled is shown unticked with its reason. An order that is not this
 * clinic's, or does not exist, leaves the normal page with a short notice
 * — no crash, nothing about the order shown.
 */

import { render, screen } from '@testing-library/react'
import RefillPage from '../page'
import { PrescriptionSessionProvider } from '../../new-prescription/_context/prescription-session'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}))
jest.mock('@/components/hipaa-timeout', () => ({ HipaaTimeout: () => null }))

const CLINIC = 'a1000000-0000-0000-0000-000000000001'

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockImplementation(async () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: 'user-1', app_metadata: { clinic_id: CLINIC, app_role: 'clinic_admin' } } },
      }),
    },
  })),
}))

let orderRows: unknown[] = []
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn().mockImplementation(() => {
    const chain: Record<string, unknown> = {}
    for (const k of ['from', 'select', 'eq', 'is', 'neq', 'order']) chain[k] = () => chain
    chain['limit'] = () => Promise.resolve({ data: orderRows, error: null })
    chain['then'] = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve)
    return chain
  }),
}))

const PATIENT = {
  patient_id: 'p-maya', first_name: 'Maya', last_name: 'Thompson', date_of_birth: '1979-11-02',
  phone: '+12125550111', state: 'TX', sms_opt_in: true, allergies: [], nkda: true, allergies_updated_at: null,
}
const OTHER = { ...PATIENT, patient_id: 'p-alex', first_name: 'Alex', last_name: 'Adams' }

function row(over: Record<string, unknown>) {
  return {
    order_id: 'o-x', patient_id: PATIENT.patient_id, provider_id: 'prov-1', status: 'DELIVERED',
    created_at: '2026-09-20T10:00:00.000Z', refills: 2, sig_text: 'Take one capsule daily', sig_mode: 'standard',
    medication_snapshot: { medication_name: 'Progesterone 100mg', prescribed_dose: '1 capsule' },
    pharmacy_snapshot: { name: 'Portal Plus Pharmacy' }, pharmacy_id: 'ph-1',
    package_label: '30 caps', package_count: 3, refill_of_order_id: null, patients: PATIENT,
    ...over,
  }
}

async function renderPage(order: string) {
  const element = await RefillPage({ searchParams: Promise.resolve({ order }) })
  return render(<PrescriptionSessionProvider>{element}</PrescriptionSessionProvider>)
}

beforeEach(() => {
  orderRows = [
    row({ order_id: 'o-other-patient', patient_id: OTHER.patient_id, patients: OTHER }),
    row({ order_id: 'o-source', refills: 2 }),
    row({ order_id: 'o-refill', refill_of_order_id: 'o-source', created_at: '2026-09-28T10:00:00.000Z' }),
    row({ order_id: 'o-no-refills', refills: 0, medication_snapshot: { medication_name: 'DHEA 10mg' } }),
  ]
})

describe('/refill?order=', () => {
  it('a refillable prescription: its patient is selected and it is ticked', async () => {
    await renderPage('o-source')
    expect(screen.getByTestId('refill-patient-select')).toHaveValue(PATIENT.patient_id)
    expect(screen.getByTestId('refill-order-o-source')).toBeChecked()
  })

  it('a refill order: its patient is selected and its source prescription is ticked', async () => {
    await renderPage('o-refill')
    expect(screen.getByTestId('refill-patient-select')).toHaveValue(PATIENT.patient_id)
    expect(screen.getByTestId('refill-order-o-source')).toBeChecked()
  })

  it('a prescription with no refills: its patient is still selected, the line unticked with its reason', async () => {
    await renderPage('o-no-refills')
    expect(screen.getByTestId('refill-patient-select')).toHaveValue(PATIENT.patient_id)
    expect(screen.getByTestId('refill-order-o-no-refills')).not.toBeChecked()
    expect(screen.getByTestId('refill-blocked-o-no-refills')).toBeInTheDocument()
  })

  it('an order not in this clinic (or not at all): the normal page, a short notice, nothing selected', async () => {
    await renderPage('d1000000-0000-4000-8000-00000000dead')
    expect(screen.getByTestId('refill-patient-select')).toHaveValue('')
    expect(screen.getByTestId('refill-preselect-missing')).toHaveTextContent(
      'The prescription in that link could not be found for this clinic. Choose a patient below.',
    )
    expect(screen.queryByTestId('refill-order-list')).toBeNull()
  })
})
