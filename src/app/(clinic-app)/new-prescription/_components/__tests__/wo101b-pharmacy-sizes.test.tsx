/**
 * WO-101b: a pharmacy option lists only the sizes it prices.
 *
 * Reproduced on prod (dr.chen, Alex Demo, Semaglutide Injectable 5 mg/mL,
 * 20 units once weekly for 90 days → 2.4 mL): the Quick Rx card read
 * "3 × 1 mL vials · Available: 1 mL vial, 3 mL vial" — its size list came
 * from pharmacy_formulations.available_quantities while the suggestion
 * ranked pharmacy_formulation_packages. The 3 mL vial had no price.
 *
 * Pinned here (the real builder, APIs mocked):
 *   - one active package → exactly one size listed
 *   - three active packages → three sizes listed (with their prices)
 *   - available_quantities entries with no package never reach the page,
 *     not on the card and not in the Quantity dropdown
 */

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PrescriptionSessionProvider } from '../../_context/prescription-session'
import { CascadingPrescriptionBuilder } from '../cascading-prescription-builder'
import { pharmacySizeLabels } from '@/lib/orders/rx-details'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}))

const STORAGE_KEY = 'compoundiq-rx-session'

const INGREDIENT = {
  ingredient_id: 'ing-sema', common_name: 'Semaglutide', therapeutic_category: 'Weight Management',
  dea_schedule: null, fda_alert_status: null, fda_alert_message: null, description: null,
}
const SALT_FORM = { salt_form_id: 'sf-sema', salt_name: 'Semaglutide Base', abbreviation: null }
const FORMULATION = {
  formulation_id: 'formulation-sema', name: 'Semaglutide Injectable 5 mg/mL', concentration: '5 mg/mL',
  concentration_value: 5, concentration_unit: 'mg/mL', excipient_base: null, is_combination: false,
  total_ingredients: 1, description: null,
  dosage_forms: { name: 'Injectable Solution', is_sterile: true, requires_injection_supplies: true },
  routes_of_administration: { name: 'Subcutaneous', abbreviation: 'SC', sig_prefix: 'Inject' },
  formulation_ingredients: [],
}

const vial = (id: string, label: string, qty: number, price: number, isDefault = false) =>
  ({ id, label, qty, unit: 'mL', wholesalePrice: price, isDefault })

const pharmacy = (id: string, name: string) =>
  ({ pharmacy_id: id, name, slug: id, integration_tier: 'TIER_1_API', fax_number: null, supports_real_time_status: false })

// A stale payload that still carries available_quantities proves the page
// ignores it, whatever the API sends.
const OPTIONS = [
  {
    pharmacy_formulation_id: 'pf-quickrx', wholesale_price: 95, estimated_turnaround_days: 3,
    available_quantities: ['1 mL vial', '3 mL vial'],
    packages: [vial('q-1', '1 mL vial', 1, 95, true)],
    pharmacies: pharmacy('quick-rx', 'Quick Rx Pharmacy'),
  },
  {
    pharmacy_formulation_id: 'pf-strive', wholesale_price: 95, estimated_turnaround_days: 5,
    available_quantities: ['1 mL vial', '3 mL vial'],
    packages: [vial('s-1', '1 mL vial', 1, 95, true), vial('s-25', '2.5 mL vial', 2.5, 165), vial('s-5', '5 mL vial', 5, 285)],
    pharmacies: pharmacy('strive', 'Strive Pharmacy'),
  },
  {
    pharmacy_formulation_id: 'pf-unpriced', wholesale_price: 90, estimated_turnaround_days: 7,
    available_quantities: ['5mL vial', '10mL vial'],
    packages: [],
    pharmacies: pharmacy('unpriced', 'Unpriced Sizes Pharmacy'),
  },
]

function jsonResponse(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
}

const mockFetch = jest.fn((input: unknown) => {
  const url = String(input)
  if (url.startsWith('/api/favorites')) return jsonResponse({ data: [] })
  if (url.startsWith('/api/protocols')) return jsonResponse({ data: [] })
  if (url.includes('level=ingredients')) return jsonResponse({ data: [INGREDIENT] })
  if (url.includes('level=salt_forms')) return jsonResponse({ data: [SALT_FORM] })
  if (url.includes('level=formulations')) return jsonResponse({ data: [FORMULATION] })
  if (url.includes('level=pharmacy_options')) return jsonResponse({ data: OPTIONS })
  if (url.includes('level=')) return jsonResponse({ data: [] })
  return jsonResponse({})
})

beforeAll(() => { global.fetch = mockFetch as unknown as typeof fetch })
beforeEach(() => { sessionStorage.clear() })

async function renderToPharmacies(doseUnits: string, durationDays: string) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
    patient: { patient_id: 'patient-1', first_name: 'Alex', last_name: 'Demo', date_of_birth: '1985-06-15', phone: '+15125550000', state: 'TX', sms_opt_in: true },
    provider: { provider_id: 'provider-1', first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', signature_hash: null },
    prescriptions: [], notices: [],
  }))
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  render(
    <QueryClientProvider client={queryClient}>
      <PrescriptionSessionProvider>
        <CascadingPrescriptionBuilder />
      </PrescriptionSessionProvider>
    </QueryClientProvider>,
  )
  fireEvent.change(screen.getByLabelText('Search medications'), { target: { value: 'Sema' } })
  fireEvent.click(await screen.findByRole('button', { name: /^Semaglutide/ }))
  fireEvent.click(await screen.findByRole('button', { name: /Semaglutide Injectable 5 mg\/mL/ }))
  fireEvent.change(await screen.findByLabelText('Dose amount'), { target: { value: doseUnits } })
  fireEvent.change(screen.getByLabelText('Dose unit'), { target: { value: 'units' } })
  fireEvent.change(screen.getByLabelText('Frequency'), { target: { value: 'QW' } })
  fireEvent.change(screen.getByLabelText('Duration'), { target: { value: durationDays } })
  await screen.findByText('Quick Rx Pharmacy')
}

const card = (name: string) => screen.getByText(name).closest('button') as HTMLElement

describe('pharmacySizeLabels', () => {
  it('lists the priced packages, smallest first', () => {
    expect(pharmacySizeLabels([vial('a', '5 mL vial', 5, 285), vial('b', '1 mL vial', 1, 95)])).toEqual(['1 mL vial', '5 mL vial'])
    expect(pharmacySizeLabels([])).toEqual([])
    expect(pharmacySizeLabels(undefined)).toEqual([])
  })
})

describe('pharmacy option cards — WO-101b', () => {
  it('the prod reproduction: Quick Rx (one priced vial) lists only the 1 mL vial and recommends 3 of it; no 3 mL vial anywhere', async () => {
    await renderToPharmacies('20', '90')   // 12 doses × 0.2 mL = 2.4 mL

    const quickRx = card('Quick Rx Pharmacy')
    await waitFor(() => expect(within(quickRx).getByTestId('pharmacy-suggested-package')).toHaveTextContent('3 × 1 mL vials'))
    expect(quickRx).toHaveTextContent('$285.00')
    expect(within(quickRx).getByTestId('pharmacy-sizes')).toHaveTextContent('Available: 1 mL vial')
    expect(quickRx).not.toHaveTextContent('3 mL vial')

    // Strive prices its vials: the 2.5 mL covers 2.4 mL.
    const strive = card('Strive Pharmacy')
    expect(within(strive).getByTestId('pharmacy-suggested-package')).toHaveTextContent('2.5 mL vial')
    expect(strive).toHaveTextContent('$165.00')
    expect(screen.queryByText(/3 mL vial/)).not.toBeInTheDocument()
  })

  it('one active package → exactly one size listed', async () => {
    await renderToPharmacies('10', '30')
    const sizes = within(card('Quick Rx Pharmacy')).getByTestId('pharmacy-sizes')
    expect(sizes.textContent).toBe('Available: 1 mL vial')
  })

  it('three active packages → three sizes listed, each with its price', async () => {
    await renderToPharmacies('10', '30')
    expect(within(card('Strive Pharmacy')).getByTestId('pharmacy-package-prices').textContent)
      .toBe('1 mL vial $95.00 · 2.5 mL vial $165.00 · 5 mL vial $285.00')
  })

  it('available_quantities with no package never reach the page — not on the card, not in the Quantity dropdown', async () => {
    await renderToPharmacies('10', '30')
    const unpriced = card('Unpriced Sizes Pharmacy')
    expect(within(unpriced).queryByTestId('pharmacy-sizes')).not.toBeInTheDocument()
    expect(unpriced).not.toHaveTextContent('5mL vial')
    expect(unpriced).not.toHaveTextContent('10mL vial')

    fireEvent.click(unpriced)
    const quantity = await screen.findByLabelText('Quantity')
    const options = Array.from((quantity as HTMLSelectElement).options).map(o => o.value)
    expect(options).toEqual(['1'])
    expect(screen.queryByText(/10mL vial|5mL vial/)).not.toBeInTheDocument()

    // A one-package pharmacy's Quantity dropdown offers that package only.
    fireEvent.click(card('Quick Rx Pharmacy'))
    await waitFor(() => expect(Array.from((screen.getByLabelText('Quantity') as HTMLSelectElement).options).map(o => o.value)).toEqual(['1 mL vial']))
  })
})
