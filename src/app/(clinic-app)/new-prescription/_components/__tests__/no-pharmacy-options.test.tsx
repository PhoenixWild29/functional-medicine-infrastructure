/**
 * Meeting check 2026-11-05: a new clinic's patient in PA got no Pharmacy &
 * Pricing section at all and no reason, because no pharmacy is licensed
 * for PA. The builder now says so.
 */

import { render, screen, fireEvent, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PrescriptionSessionProvider } from '../../_context/prescription-session'
import { CascadingPrescriptionBuilder } from '../cascading-prescription-builder'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}))

const PROVIDER_ID = '22222222-2222-4222-8222-222222222222'
const SEMA = {
  ingredient_id: 'ing-sema', common_name: 'Semaglutide', therapeutic_category: 'Weight Management',
  dea_schedule: null, fda_alert_status: null, fda_alert_message: null, description: null,
}
const SALT_FORM = { salt_form_id: 'sf-sema', salt_name: 'Semaglutide', abbreviation: null }
const FORMULATION = {
  formulation_id: 'formulation-sema', name: 'Semaglutide Injectable 5 mg/mL', concentration: '5 mg/mL',
  concentration_value: 5, concentration_unit: 'mg/mL', excipient_base: null, is_combination: false,
  total_ingredients: 1, description: null,
  dosage_forms: { name: 'Injectable Solution', is_sterile: true, requires_injection_supplies: true },
  routes_of_administration: { name: 'Subcutaneous', abbreviation: 'SubQ', sig_prefix: 'Inject' },
  formulation_ingredients: [],
}
const FAVORITE = {
  favorite_id: 'fav-sema', provider_id: PROVIDER_ID, formulation_id: 'formulation-sema', pharmacy_id: 'pharmacy-strive',
  patient_id: null, label: 'Semaglutide', category: 'Weight Management', dose_presets: [], sig_mode: 'standard', titration_steps: [],
  default_refills: 0, use_count: 1, last_used_at: null, formulation_active: true, pharmacy_licensed: true,
  pharmacies: { pharmacy_id: 'pharmacy-strive', name: 'Strive Pharmacy' },
  formulations: { ...FORMULATION, dosage_forms: { name: 'Injectable Solution' } },
}

const json = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
let pharmacyUrls: string[] = []
let pharmacyResponse: () => Promise<unknown> = () => json({ data: [] })

beforeEach(() => {
  pharmacyUrls = []
  pharmacyResponse = () => json({ data: [] })
  global.fetch = jest.fn((input: unknown) => {
    const url = String(input)
    if (url.startsWith('/api/favorites/frequent')) return json({ data: [] })
    if (url.startsWith('/api/favorites')) return json({ data: [FAVORITE] })
    if (url.startsWith('/api/protocols')) return json({ data: [] })
    if (url.includes('level=ingredients')) return json({ data: [SEMA] })
    if (url.includes('level=formulation&')) return json({ data: { formulation: FORMULATION, salt_form: SALT_FORM, ingredient: SEMA } })
    if (url.includes('level=formulations')) return json({ data: [FORMULATION] })
    if (url.includes('level=salt_forms')) return json({ data: [SALT_FORM] })
    if (url.includes('level=pharmacy_options')) { pharmacyUrls.push(url); return pharmacyResponse() }
    if (url.includes('level=')) return json({ data: [] })
    throw new Error(`Unexpected fetch: ${url}`)
  }) as unknown as typeof fetch
})

function renderBuilder(state: string | null) {
  sessionStorage.setItem('compoundiq-rx-session', JSON.stringify({
    patient: { patient_id: 'patient-1', first_name: 'Jamie', last_name: 'Test', date_of_birth: '1985-06-15', phone: '+14125550000', state, sms_opt_in: false },
    provider: { provider_id: PROVIDER_ID, first_name: 'Gina', last_name: 'Test', npi_number: '1666666668', signature_hash: null },
    prescriptions: [], notices: [],
  }))
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
      <PrescriptionSessionProvider>
        <CascadingPrescriptionBuilder />
      </PrescriptionSessionProvider>
    </QueryClientProvider>,
  )
}

async function openFormulation() {
  fireEvent.click(await screen.findByRole('button', { name: /^Favorites/ }))
  fireEvent.click(within(screen.getByTestId('favorite-fav-sema')).getByTestId('favorite-custom'))
}

it('a patient in a state no pharmacy is licensed for: says so, names the state, shows no pharmacy list', async () => {
  renderBuilder('PA')
  await openFormulation()
  expect(await screen.findByTestId('no-pharmacy-options')).toHaveTextContent(
    'No pharmacy on CompoundIQ can fill Semaglutide Injectable 5 mg/mL for a patient in PA yet.')
  expect(pharmacyUrls.some(u => u.includes('state=PA'))).toBe(true)
  expect(screen.queryByText('Pharmacy & Pricing')).not.toBeInTheDocument()
})

it('no patient state: says no pharmacy offers it', async () => {
  renderBuilder(null)
  await openFormulation()
  expect(await screen.findByTestId('no-pharmacy-options')).toHaveTextContent('No pharmacy on CompoundIQ offers Semaglutide Injectable 5 mg/mL yet.')
})

it('nothing shows while the pharmacies are still loading', async () => {
  pharmacyResponse = () => new Promise(() => {})
  renderBuilder('PA')
  await openFormulation()
  await new Promise(r => setTimeout(r, 300))
  expect(pharmacyUrls.length).toBeGreaterThan(0)
  expect(screen.queryByTestId('no-pharmacy-options')).not.toBeInTheDocument()
  expect(screen.queryByTestId('pharmacy-options-error')).not.toBeInTheDocument()
})

it('a failed load says so with Try again, instead of a blank', async () => {
  pharmacyResponse = () => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ error: 'x' }) })
  renderBuilder('PA')
  await openFormulation()
  expect(await screen.findByTestId('pharmacy-options-error')).toHaveTextContent('Pharmacies could not be loaded.')
  expect(screen.queryByTestId('no-pharmacy-options')).not.toBeInTheDocument()
})

it('pharmacies found: no message', async () => {
  pharmacyResponse = () => json({ data: [{
    pharmacy_formulation_id: 'pf-sema', wholesale_price: 95, estimated_turnaround_days: 5,
    pharmacies: { pharmacy_id: 'pharmacy-strive', name: 'Strive Pharmacy', slug: 'strive', integration_tier: 'TIER_4_FAX', fax_number: null, supports_real_time_status: false },
    packages: [{ id: 'pkg-1', label: '1 mL vial', qty: 1, unit: 'mL', wholesalePrice: 95, isDefault: true }],
  }] })
  renderBuilder('TX')
  await openFormulation()
  expect(await screen.findByText('Pharmacy & Pricing')).toBeInTheDocument()
  expect(screen.queryByTestId('no-pharmacy-options')).not.toBeInTheDocument()
})
