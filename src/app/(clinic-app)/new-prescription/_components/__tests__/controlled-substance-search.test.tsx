/**
 * Compliance C6: a controlled substance shows in search with "Controlled
 * substance: prescribe through your EPCS system" and cannot be taken past
 * the dose step (Continue stays disabled), so it never reaches a signable
 * order. Before, it showed "EPCS requirements apply at signing" and went on.
 */

import { render, screen, fireEvent, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PrescriptionSessionProvider } from '../../_context/prescription-session'
import { CascadingPrescriptionBuilder } from '../cascading-prescription-builder'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}))

const LABEL = 'Controlled substance: prescribe through your EPCS system'
const PROVIDER_ID = '22222222-2222-4222-8222-222222222222'
const TESTO = {
  ingredient_id: 'ing-testo', common_name: 'Testosterone', therapeutic_category: 'Hormones',
  dea_schedule: 3, fda_alert_status: null, fda_alert_message: null, description: null,
}
const SALT_FORM = { salt_form_id: 'sf-testo-cyp', salt_name: 'Testosterone Cypionate', abbreviation: 'Cyp' }
const FORMULATION = {
  formulation_id: 'formulation-testo', name: 'Testosterone Cypionate 200mg/mL', concentration: '200 mg/mL',
  concentration_value: 200, concentration_unit: 'mg/mL', excipient_base: 'Grapeseed Oil', is_combination: false,
  total_ingredients: 1, description: null,
  dosage_forms: { name: 'Injectable Solution', is_sterile: true, requires_injection_supplies: true },
  routes_of_administration: { name: 'Intramuscular', abbreviation: 'IM', sig_prefix: 'Inject' },
  formulation_ingredients: [],
}
const FAVORITE = {
  favorite_id: 'fav-trt', provider_id: PROVIDER_ID, formulation_id: 'formulation-testo', pharmacy_id: 'pharmacy-strive',
  patient_id: null, label: 'Standard TRT', category: 'Hormones', dose_presets: [], sig_mode: 'standard', titration_steps: [],
  default_refills: 0, use_count: 1, last_used_at: null, formulation_active: true, pharmacy_licensed: true,
  pharmacies: { pharmacy_id: 'pharmacy-strive', name: 'Strive Pharmacy' },
  formulations: { ...FORMULATION, dosage_forms: { name: 'Injectable Solution' } },
}

const json = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })

beforeAll(() => {
  global.fetch = jest.fn((input: unknown) => {
    const url = String(input)
    if (url.startsWith('/api/favorites/recent')) return json({ data: [] })
    if (url.startsWith('/api/favorites')) return json({ data: [FAVORITE] })
    if (url.startsWith('/api/protocols')) return json({ data: [] })
    if (url.includes('level=ingredients')) return json({ data: [TESTO] })
    if (url.includes('level=formulation&')) return json({ data: { formulation: FORMULATION, salt_form: SALT_FORM, ingredient: TESTO } })
    if (url.includes('level=pharmacy_options')) {
      return json({ data: [{
        pharmacy_formulation_id: 'pf-testo', wholesale_price: 60, estimated_turnaround_days: 5,
        pharmacies: { pharmacy_id: 'pharmacy-strive', name: 'Strive Pharmacy', slug: 'strive', integration_tier: 'TIER_4_FAX', fax_number: null, supports_real_time_status: false },
        packages: [{ id: 'pkg-testo-10', label: '10 mL vial', qty: 10, unit: 'mL', wholesalePrice: 60, isDefault: true }],
      }] })
    }
    if (url.includes('level=')) return json({ data: [] })
    throw new Error(`Unexpected fetch: ${url}`)
  }) as unknown as typeof fetch
})

function renderBuilder() {
  sessionStorage.setItem('compoundiq-rx-session', JSON.stringify({
    patient: { patient_id: 'patient-1', first_name: 'Alex', last_name: 'Demo', date_of_birth: '1985-06-15', phone: '+15125550000', state: 'TX', sms_opt_in: true },
    provider: { provider_id: PROVIDER_ID, first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', signature_hash: null },
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

it('search results label a controlled ingredient', async () => {
  renderBuilder()
  fireEvent.change(screen.getByLabelText('Search medications'), { target: { value: 'Testo' } })
  const option = await screen.findByRole('button', { name: /Testosterone/ })
  expect(within(option).getByText(LABEL)).toBeInTheDocument()
})

it('a controlled medication shows the label and cannot continue to pricing', async () => {
  renderBuilder()
  fireEvent.click(await screen.findByRole('button', { name: /^Favorites/ }))
  fireEvent.click(within(screen.getByTestId('favorite-fav-trt')).getByTestId('favorite-custom'))
  expect(await screen.findByTestId('controlled-substance-label')).toHaveTextContent(LABEL)
  expect(await screen.findByRole('button', { name: /Continue/ })).toBeDisabled()
})
