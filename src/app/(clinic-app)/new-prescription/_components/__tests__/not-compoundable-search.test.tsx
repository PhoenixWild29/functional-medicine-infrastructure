/**
 * Compliance C8: an ingredient that may not be compounded (FDA Category 2
 * or 3, withdrawn or removed, not eligible), or whose status nobody has
 * verified, shows in search as "Not compoundable" and cannot be taken past
 * the dose step (Continue stays disabled), so it never reaches a signable
 * order. A verified, compoundable one goes on.
 *
 * Owner decision: one pending FDA evaluation is orderable, with a
 * non-blocking warning in search and on the dose step.
 */
import { render, screen, fireEvent, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PrescriptionSessionProvider } from '../../_context/prescription-session'
import { CascadingPrescriptionBuilder } from '../cascading-prescription-builder'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}))

const LABEL = 'Not compoundable: cannot be ordered through CompoundIQ'
const PROVIDER_ID = '22222222-2222-4222-8222-222222222222'
let status = 'pending_evaluation'
const TESTO = () => ({
  ingredient_id: 'ing-bpc', common_name: 'BPC-157', therapeutic_category: 'Peptides',
  dea_schedule: null, fda_alert_status: null, fda_alert_message: null, description: null,
  compounding_status: status, commercial_equivalent: false, on_fda_shortage: false,
})
const SALT_FORM = { salt_form_id: 'sf-bpc', salt_name: 'BPC-157 Acetate', abbreviation: null }
const FORMULATION = {
  formulation_id: 'formulation-bpc', name: 'BPC-157 5mg/mL Injectable', concentration: '5 mg/mL',
  concentration_value: 5, concentration_unit: 'mg/mL', excipient_base: null, is_combination: false,
  total_ingredients: 1, description: null,
  dosage_forms: { name: 'Injectable Solution', is_sterile: true, requires_injection_supplies: true },
  routes_of_administration: { name: 'Subcutaneous', abbreviation: 'SC', sig_prefix: 'Inject' },
  formulation_ingredients: [],
}
const FAVORITE = {
  favorite_id: 'fav-bpc', provider_id: PROVIDER_ID, formulation_id: 'formulation-bpc', pharmacy_id: 'pharmacy-strive',
  patient_id: null, label: 'BPC weekly', category: 'Peptides', dose_presets: [], sig_mode: 'standard', titration_steps: [],
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
    if (url.includes('level=ingredients')) return json({ data: [TESTO()] })
    if (url.includes('level=formulation&')) return json({ data: { formulation: FORMULATION, salt_form: SALT_FORM, ingredient: TESTO() } })
    if (url.includes('level=pharmacy_options')) {
      return json({ data: [{
        pharmacy_formulation_id: 'pf-bpc', wholesale_price: 60, estimated_turnaround_days: 5,
        pharmacies: { pharmacy_id: 'pharmacy-strive', name: 'Strive Pharmacy', slug: 'strive', integration_tier: 'TIER_4_FAX', fax_number: null, supports_real_time_status: false },
        packages: [{ id: 'pkg-bpc-5', label: '5 mL vial', qty: 5, unit: 'mL', wholesalePrice: 60, isDefault: true }],
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

beforeEach(() => { status = 'category_2' })

it('search results label an ingredient that may not be compounded', async () => {
  renderBuilder()
  fireEvent.change(screen.getByLabelText('Search medications'), { target: { value: 'BPC' } })
  const option = await screen.findByRole('button', { name: /BPC-157/ })
  expect(within(option).getByText(LABEL)).toBeInTheDocument()
})

it('search results label an unverified ingredient too', async () => {
  status = 'unverified'
  renderBuilder()
  fireEvent.change(screen.getByLabelText('Search medications'), { target: { value: 'BPC' } })
  expect(within(await screen.findByRole('button', { name: /BPC-157/ })).getByText(LABEL)).toBeInTheDocument()
})

it('a compoundable ingredient carries no such label', async () => {
  status = 'approved_drug_component'
  renderBuilder()
  fireEvent.change(screen.getByLabelText('Search medications'), { target: { value: 'BPC' } })
  expect(within(await screen.findByRole('button', { name: /BPC-157/ })).queryByText(LABEL)).not.toBeInTheDocument()
})

it('a product that may not be compounded shows why and cannot continue to pricing', async () => {
  renderBuilder()
  fireEvent.click(await screen.findByRole('button', { name: /^Favorites/ }))
  fireEvent.click(within(screen.getByTestId('favorite-fav-bpc')).getByTestId('favorite-custom'))
  const banner = await screen.findByTestId('not-compoundable-label')
  expect(banner).toHaveTextContent(LABEL)
  expect(banner).toHaveTextContent('BPC-157 is 503A Category 2')
  expect(await screen.findByRole('button', { name: /Continue/ })).toBeDisabled()
})

const WARNING = 'FDA evaluation pending for this substance. The dispensing pharmacy confirms it can compound it.'

describe('pending FDA evaluation (orderable)', () => {
  beforeEach(() => { status = 'pending_evaluation' })

  it('search shows the warning, not the block label', async () => {
    renderBuilder()
    fireEvent.change(screen.getByLabelText('Search medications'), { target: { value: 'BPC' } })
    const option = await screen.findByRole('button', { name: /BPC-157/ })
    expect(within(option).getByText(WARNING)).toBeInTheDocument()
    expect(within(option).queryByText(LABEL)).not.toBeInTheDocument()
  })

  it('the dose step shows the warning and no block', async () => {
    renderBuilder()
    fireEvent.click(await screen.findByRole('button', { name: /^Favorites/ }))
    fireEvent.click(within(screen.getByTestId('favorite-fav-bpc')).getByTestId('favorite-custom'))
    expect(await screen.findByTestId('pending-evaluation-warning')).toHaveTextContent(WARNING)
    expect(screen.queryByTestId('not-compoundable-label')).not.toBeInTheDocument()
  })
})
