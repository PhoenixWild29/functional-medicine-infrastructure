/**
 * The dose step refuses a package it cannot size (#181): the pharmacy
 * row says so, the refusal message is shown, and Continue stays disabled.
 * An mg vial on a formulation with no concentration, dosed in mL for 30
 * days, has no honest vial count — it is never priced as one package.
 */

import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PrescriptionSessionProvider } from '../../_context/prescription-session'
import { CascadingPrescriptionBuilder } from '../cascading-prescription-builder'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}))

const PROVIDER_ID = '22222222-2222-4222-8222-222222222222'
const INGREDIENT = {
  ingredient_id: 'ing-bpc', common_name: 'BPC-157', therapeutic_category: 'Peptides',
  dea_schedule: null, fda_alert_status: null, fda_alert_message: null, description: null,
}
const SALT_FORM = { salt_form_id: 'sf-bpc', salt_name: 'BPC-157 Acetate', abbreviation: null }
// No concentration: an mg vial cannot be converted to mL.
const FORMULATION = {
  formulation_id: 'formulation-bpc', name: 'BPC-157 Injectable 5mg', concentration: null,
  concentration_value: null, concentration_unit: null, excipient_base: null, is_combination: false,
  total_ingredients: 1, description: null,
  dosage_forms: { name: 'Injectable Solution', is_sterile: true, requires_injection_supplies: true },
  routes_of_administration: { name: 'Subcutaneous', abbreviation: 'SC', sig_prefix: 'Inject' },
  formulation_ingredients: [],
}
const FAVORITE = {
  favorite_id: 'fav-bpc', provider_id: PROVIDER_ID, formulation_id: 'formulation-bpc', pharmacy_id: 'pharmacy-strive',
  patient_id: null, label: 'BPC-157', category: 'Peptides', dose_presets: [], sig_mode: 'standard', titration_steps: [],
  default_refills: 0, use_count: 1, last_used_at: null, formulation_active: true, pharmacy_licensed: true,
  pharmacies: { pharmacy_id: 'pharmacy-strive', name: 'Strive Pharmacy' },
  formulations: { ...FORMULATION, dosage_forms: { name: 'Injectable Solution' } },
}

function json(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
}

beforeAll(() => {
  global.fetch = jest.fn((input: unknown) => {
    const url = String(input)
    if (url.startsWith('/api/favorites/recent')) return json({ data: [] })
    if (url.startsWith('/api/favorites')) return json({ data: [FAVORITE] })
    if (url.startsWith('/api/protocols')) return json({ data: [] })
    if (url.includes('level=formulation&')) return json({ data: { formulation: FORMULATION, salt_form: SALT_FORM, ingredient: INGREDIENT } })
    if (url.includes('level=pharmacy_options')) {
      return json({ data: [{
        pharmacy_formulation_id: 'pf-bpc', wholesale_price: 62, estimated_turnaround_days: 5,
        pharmacies: { pharmacy_id: 'pharmacy-strive', name: 'Strive Pharmacy', slug: 'strive', integration_tier: 'TIER_4_FAX', fax_number: null, supports_real_time_status: false },
        packages: [{ id: 'pkg-bpc-5', label: '5 mg vial', qty: 5, unit: 'mg', wholesalePrice: 62, isDefault: true }],
      }] })
    }
    if (url.includes('level=')) return json({ data: [] })
    throw new Error(`Unexpected fetch: ${url}`)
  }) as unknown as typeof fetch
})

it('shows the refusal and keeps Continue disabled', async () => {
  sessionStorage.setItem('compoundiq-rx-session', JSON.stringify({
    patient: { patient_id: 'patient-1', first_name: 'Alex', last_name: 'Demo', date_of_birth: '1985-06-15', phone: '+15125550000', state: 'TX', sms_opt_in: true },
    provider: { provider_id: PROVIDER_ID, first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', signature_hash: null },
    prescriptions: [], notices: [],
  }))
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
      <PrescriptionSessionProvider>
        <CascadingPrescriptionBuilder />
      </PrescriptionSessionProvider>
    </QueryClientProvider>,
  )
  fireEvent.click(await screen.findByRole('button', { name: /^Favorites/ }))
  fireEvent.click(within(screen.getByTestId('favorite-fav-bpc')).getByTestId('favorite-custom'))
  await screen.findByTestId('dose-step')

  fireEvent.change(screen.getByLabelText('Dose amount'), { target: { value: '1' } })
  fireEvent.change(screen.getByLabelText('Dose unit'), { target: { value: 'mL' } })
  fireEvent.change(screen.getByLabelText('Frequency'), { target: { value: 'QD' } })
  fireEvent.change(screen.getByLabelText('Duration'), { target: { value: '30' } })

  const row = await screen.findByRole('button', { name: /Strive Pharmacy/ })
  await waitFor(() => expect(within(row).getByTestId('pharmacy-package-unsized')).toHaveTextContent("Package can't be sized"))
  fireEvent.click(row)

  expect(await screen.findByTestId('package-unit-mismatch')).toHaveTextContent('The 5 mg vial package is not measured in mL')
  expect(screen.getByRole('button', { name: 'Continue — Set Retail Price' })).toBeDisabled()
})
