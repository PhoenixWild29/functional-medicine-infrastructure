/**
 * The cascade picks an ingredient's only salt form by itself, so the
 * formulations show straight away; with two or more the provider picks.
 * Pinned before the auto-select moved out of an effect
 * (eslint-plugin-react-hooks 7.1: set-state-in-effect); behaviour unchanged.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PrescriptionSessionProvider } from '../../_context/prescription-session'
import { CascadingPrescriptionBuilder } from '../cascading-prescription-builder'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}))

const INGREDIENT = {
  ingredient_id: 'ing-sema', common_name: 'Semaglutide', therapeutic_category: 'Weight Management',
  dea_schedule: null, fda_alert_status: null, fda_alert_message: null, description: null, compounding_status: 'approved_drug_component',
}
const BASE = { salt_form_id: 'sf-base', salt_name: 'Semaglutide Base', abbreviation: null }
const SODIUM = { salt_form_id: 'sf-sodium', salt_name: 'Semaglutide Sodium', abbreviation: null }
const FORMULATION = {
  formulation_id: 'formulation-sema', name: 'Semaglutide 5mg/mL Injectable', concentration: '5mg/mL',
  concentration_value: 5, concentration_unit: 'mg/mL', excipient_base: null, is_combination: false,
  total_ingredients: 1, description: null,
  dosage_forms: { name: 'Injectable Solution', is_sterile: true, requires_injection_supplies: true },
  routes_of_administration: { name: 'Subcutaneous', abbreviation: 'SC', sig_prefix: 'Inject' },
  formulation_ingredients: [],
}

let saltForms: unknown[] = [BASE]
const json = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
const fetchMock = jest.fn((input: unknown) => {
  const url = String(input)
  if (url.startsWith('/api/favorites') || url.startsWith('/api/protocols')) return json({ data: [] })
  if (url.includes('level=salt_forms')) return json({ data: saltForms })
  if (url.includes('level=formulations')) return json({ data: [FORMULATION] })
  if (url.includes('level=ingredients')) return json({ data: [INGREDIENT] })
  return json({ data: [] })
})

beforeAll(() => { global.fetch = fetchMock as unknown as typeof fetch })
beforeEach(() => {
  fetchMock.mockClear()
  sessionStorage.clear()
  sessionStorage.setItem('compoundiq-rx-session', JSON.stringify({
    patient: { patient_id: 'patient-1', first_name: 'Alex', last_name: 'Demo', date_of_birth: '1985-06-15', phone: '+15125550000', state: 'TX', sms_opt_in: true },
    provider: { provider_id: '22222222-2222-4222-8222-222222222222', first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', signature_hash: null },
    prescriptions: [], notices: [],
  }))
})

function renderBuilder() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(
    <QueryClientProvider client={client}>
      <PrescriptionSessionProvider>
        <CascadingPrescriptionBuilder />
      </PrescriptionSessionProvider>
    </QueryClientProvider>,
  )
}

async function pickIngredient() {
  renderBuilder()
  fireEvent.change(await screen.findByPlaceholderText('Search medication name...'), { target: { value: 'Sema' } })
  fireEvent.click(await screen.findByRole('button', { name: /^Semaglutide/ }))
}

it('one salt form: chosen by itself; the formulations are listed for it', async () => {
  saltForms = [BASE]
  await pickIngredient()
  expect(await screen.findByRole('button', { name: /Semaglutide 5mg\/mL Injectable/ })).toBeInTheDocument()
  expect(screen.queryByText('Salt / Ester Form')).not.toBeInTheDocument()
  await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).includes('level=formulations') && String(u).includes('salt_form_id=sf-base'))).toBe(true))
})

it('two salt forms: the provider picks; no formulations until then', async () => {
  saltForms = [BASE, SODIUM]
  await pickIngredient()
  expect(await screen.findByText('Salt / Ester Form')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Semaglutide 5mg\/mL Injectable/ })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Semaglutide Sodium' }))
  expect(await screen.findByRole('button', { name: /Semaglutide 5mg\/mL Injectable/ })).toBeInTheDocument()
})
