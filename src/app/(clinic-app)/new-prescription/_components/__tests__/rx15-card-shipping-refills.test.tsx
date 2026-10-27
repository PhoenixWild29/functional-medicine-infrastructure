/**
 * Requirement 15 and the refills fix (D-2026-10-25-06), on the search step.
 *
 *   - Each pharmacy card states the shipping it adds, priced as Review
 *     prices it: the pharmacy's stored rates (GET /api/pharmacies/shipping),
 *     once per pharmacy across the session, at the formulation's default
 *     shipping type. Gina Rooks, 2026-09-11: "I don't see it listed
 *     anywhere with the med pricing".
 *   - The Refills select offers 0 to 12, as Review does (it offered 0 to 5).
 *   - MultiPharmacyNoticeBanner: one component, Review's re-route button
 *     only where Review passes one.
 *
 * Harness from wo101b-pharmacy-sizes.test.tsx (the real builder, APIs mocked).
 */

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PrescriptionSessionProvider } from '../../_context/prescription-session'
import { CascadingPrescriptionBuilder } from '../cascading-prescription-builder'
import { MultiPharmacyNoticeBanner } from '../multi-pharmacy-notice'
import { defaultRxDetails } from '@/lib/orders/rx-details'

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
  total_ingredients: 1, description: null, default_shipping_type: null,
  dosage_forms: { name: 'Injectable Solution', is_sterile: true, requires_injection_supplies: true },
  routes_of_administration: { name: 'Subcutaneous', abbreviation: 'SC', sig_prefix: 'Inject' },
  formulation_ingredients: [{ ingredient_id: 'ing-sema', concentration_per_unit: '5 mg/mL', role: 'active', ingredients: { common_name: 'Semaglutide', dea_schedule: null, fda_alert_status: null } }],
}

const pharmacy = (id: string, name: string) =>
  ({ pharmacy_id: id, name, slug: id, integration_tier: 'TIER_1_API', fax_number: null, supports_real_time_status: false })

const OPTIONS = [
  { pharmacy_formulation_id: 'pf-quickrx', wholesale_price: 95, estimated_turnaround_days: 3, packages: [], pharmacies: pharmacy('quick-rx', 'Quick Rx Pharmacy') },
  { pharmacy_formulation_id: 'pf-strive', wholesale_price: 95, estimated_turnaround_days: 5, packages: [], pharmacies: pharmacy('strive', 'Strive Pharmacy') },
  { pharmacy_formulation_id: 'pf-norates', wholesale_price: 90, estimated_turnaround_days: 7, packages: [], pharmacies: pharmacy('no-rates', 'No Rates Pharmacy') },
]

// Strive $9 / $22 cold chain; Quick Rx $12 / $25. No rates for the third.
const RATES = [
  { pharmacyId: 'strive', pharmacyName: 'Strive Pharmacy', standardCents: 900, coldChainCents: 2200, freeShippingThresholdCents: null },
  { pharmacyId: 'quick-rx', pharmacyName: 'Quick Rx Pharmacy', standardCents: 1200, coldChainCents: 2500, freeShippingThresholdCents: null },
]

function jsonResponse(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
}

const shippingCalls: string[] = []
const mockFetch = jest.fn((input: unknown) => {
  const url = String(input)
  if (url.startsWith('/api/pharmacies/shipping')) { shippingCalls.push(url); return jsonResponse({ rates: RATES, absorbShipping: false }) }
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
beforeEach(() => { sessionStorage.clear(); shippingCalls.length = 0 })

const SESSION_LINE_AT_STRIVE = {
  id: 'line-bpc', pharmacyId: 'strive', pharmacyName: 'Strive Pharmacy', itemId: null, formulationId: 'f-bpc',
  medicationName: 'BPC-157 Injectable', form: 'Injectable Solution', dose: '250 mcg', wholesaleCents: 6500, deaSchedule: null,
  retailCents: 13000, sigText: 'Inject 250 mcg subcutaneously daily', integrationTier: '',
  rxDetails: { ...defaultRxDetails(null), shippingType: 'cold_chain' },
}

async function renderToPharmacies(prescriptions: unknown[] = []) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
    patient: { patient_id: 'patient-1', first_name: 'Alex', last_name: 'Demo', date_of_birth: '1985-06-15', phone: '+15125550000', state: 'TX', sms_opt_in: true },
    provider: { provider_id: 'provider-1', first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', signature_hash: null },
    prescriptions, notices: [],
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
  fireEvent.change(await screen.findByLabelText('Dose amount'), { target: { value: '10' } })
  fireEvent.change(screen.getByLabelText('Dose unit'), { target: { value: 'units' } })
  fireEvent.change(screen.getByLabelText('Frequency'), { target: { value: 'QW' } })
  fireEvent.change(screen.getByLabelText('Duration'), { target: { value: '30' } })
  await screen.findByText('Quick Rx Pharmacy')
}

const card = (name: string) => screen.getByText(name).closest('button') as HTMLElement

describe('pharmacy cards: the shipping each one adds (requirement 15)', () => {
  it('first line: each card adds its own cold-chain rate (Semaglutide defaults to cold chain); rates come from /api/pharmacies/shipping', async () => {
    await renderToPharmacies()
    await waitFor(() => expect(within(card('Strive Pharmacy')).getByTestId('pharmacy-shipping')).toHaveTextContent('+ $22.00 shipping (cold chain)'))
    expect(within(card('Quick Rx Pharmacy')).getByTestId('pharmacy-shipping')).toHaveTextContent('+ $25.00 shipping (cold chain)')
    expect(shippingCalls[0]).toContain('/api/pharmacies/shipping?ids=')
  })

  it('a pharmacy with no rates on file shows no fee; none is invented', async () => {
    await renderToPharmacies()
    await waitFor(() => expect(within(card('Strive Pharmacy')).getByTestId('pharmacy-shipping')).toBeInTheDocument())
    expect(within(card('No Rates Pharmacy')).queryByTestId('pharmacy-shipping')).not.toBeInTheDocument()
  })

  it('with a session line at Strive: Strive ships with it (adds nothing), Quick Rx is a second charge', async () => {
    await renderToPharmacies([SESSION_LINE_AT_STRIVE])
    await waitFor(() => expect(within(card('Strive Pharmacy')).getByTestId('pharmacy-shipping')).toHaveTextContent('Ships with the other Strive Pharmacy prescription'))
    expect(within(card('Quick Rx Pharmacy')).getByTestId('pharmacy-shipping')).toHaveTextContent('+ $25.00 shipping (cold chain)')
  })
})

describe('Refills select (search step)', () => {
  it('offers 0 to 12 refills, as Review does', async () => {
    await renderToPharmacies()
    fireEvent.click(card('Strive Pharmacy'))
    const select = await screen.findByLabelText('Refills')
    const values = within(select).getAllByRole('option').map(o => (o as HTMLOptionElement).value)
    expect(values).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'])
    expect(within(select).getByRole('option', { name: '12 refills' })).toBeInTheDocument()
  })
})

describe('MultiPharmacyNoticeBanner', () => {
  const notice = { pharmacyCount: 2, currentShippingCents: 3100, plan: null, offerReroute: false, message: '2 pharmacies → 2 shipping charges ($31.00).' }

  it('shows the warning with no re-route button when none is passed', () => {
    render(<MultiPharmacyNoticeBanner notice={notice} />)
    expect(screen.getByTestId('multi-pharmacy-message')).toHaveTextContent('2 pharmacies → 2 shipping charges ($31.00).')
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('Review: the re-route button shows only when a saving is offered and a handler is passed', () => {
    const onReroute = jest.fn()
    const plan = { targetPharmacyId: 'strive', targetPharmacyName: 'Strive Pharmacy', lines: [], currentShippingCents: 3100, newShippingCents: 2200, shippingDeltaCents: -900, medicationDeltaCents: 0, netDeltaCents: -900 }
    render(<MultiPharmacyNoticeBanner notice={{ ...notice, plan, offerReroute: true }} disabled={false} onReroute={onReroute} />)
    fireEvent.click(screen.getByRole('button', { name: 'Route all to Strive Pharmacy' }))
    expect(onReroute).toHaveBeenCalledTimes(1)
  })
})
