/**
 * WO-103 / WO-104: search bar first, Favorites / Protocols as buttons that
 * open panels, favorites editable in place with the computed mg shown.
 *
 * Acceptance criteria pinned here (component layer):
 *   - the medication search is rendered BEFORE the quick-action buttons
 *   - "Favorites (N)" and "Protocols (N)" open panels; counts still shown
 *   - a favorite's dose chip reads "10 units (0.5 mg) weekly" (mg computed
 *     from units × the formulation's mg/mL concentration, never typed)
 *   - editing a dose to 20 units previews and saves "(1.0 mg)" as a
 *     structured preset (WO-104: no sig is stored or regenerated)
 *   - delete keeps the two-step confirm and calls DELETE
 *   - "Mine" narrows the clinic-wide list to the session provider
 *   - "+ New" in Favorites hands focus back to the search; "+ New" in
 *     Protocols saves the session lines as a protocol
 *
 * The WO-104 behaviours (groups, Custom, Recent, patient favorites) are in
 * wo104-favorites-panel.test.tsx.
 */

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PrescriptionSessionProvider } from '../../_context/prescription-session'
import { QuickActionsPanel } from '../quick-actions-panel'

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), refresh: jest.fn() }),
}))

const STORAGE_KEY = 'compoundiq-rx-session'

const PROVIDER_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_PROVIDER_ID = '33333333-3333-4333-8333-333333333333'

const PATIENT = {
  patient_id: '11111111-1111-4111-8111-111111111111',
  first_name: 'Alex', last_name: 'Demo', date_of_birth: '1985-06-15',
  phone: '+15125550000', state: 'TX', sms_opt_in: true,
}
const PROVIDER = {
  provider_id: PROVIDER_ID,
  first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', signature_hash: null,
}

const SEMA_FORMULATION = {
  formulation_id: 'formulation-sema',
  name: 'Semaglutide 5mg/mL Injectable',
  concentration: '5mg/mL',
  concentration_value: 5,
  concentration_unit: 'mg/mL',
  dosage_forms: { name: 'Injectable Solution' },
  routes_of_administration: { name: 'Subcutaneous', abbreviation: 'SC', sig_prefix: 'Inject' },
}

const preset = (dose: string, unit = 'units', frequency = 'QW') =>
  ({ dose, unit, frequency, timing: '', duration: '', label: null })

function favorite(overrides: Record<string, unknown>) {
  return {
    favorite_id: 'fav-default',
    provider_id: PROVIDER_ID,
    formulation_id: 'formulation-sema',
    pharmacy_id: 'pharmacy-strive',
    patient_id: null,
    label: 'Favorite',
    category: 'Weight Management',
    dose_presets: [preset('10')],
    sig_mode: 'standard',
    default_refills: 0,
    use_count: 0,
    last_used_at: null,
    formulation_active: true,
    pharmacy_licensed: true,
    pharmacies: { pharmacy_id: 'pharmacy-strive', name: 'Strive Pharmacy' },
    formulations: SEMA_FORMULATION,
    ...overrides,
  }
}

const SEMA_FAV = favorite({ favorite_id: 'fav-sema', label: 'Semaglutide' })
const OTHER_FAV = favorite({
  favorite_id: 'fav-other',
  provider_id: OTHER_PROVIDER_ID,
  label: 'TRT Cyp 200 — Weekly',
  category: 'Hormones',
  dose_presets: [preset('1', 'mL')],
  formulations: { ...SEMA_FORMULATION, formulation_id: 'formulation-trt', name: 'Testosterone Cypionate 200mg/mL', concentration_value: 200 },
  formulation_id: 'formulation-trt',
})

let favorites: unknown[] = []
let calls: Array<{ url: string; method: string; body: unknown }> = []

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) })
}

const mockFetch = jest.fn((input: unknown, init?: { method?: string; body?: string }) => {
  const url = String(input)
  const method = init?.method ?? 'GET'
  calls.push({ url, method, body: init?.body ? JSON.parse(init.body) : null })
  if (url.startsWith('/api/favorites/recent')) return jsonResponse({ data: [] })
  if (url.startsWith('/api/favorites') && method === 'GET') return jsonResponse({ data: favorites })
  if (url.startsWith('/api/favorites') && method === 'PATCH') return jsonResponse({ data: {} })
  if (url.startsWith('/api/favorites') && method === 'DELETE') {
    favorites = favorites.filter(f => !url.includes((f as { favorite_id: string }).favorite_id))
    return jsonResponse({ ok: true })
  }
  if (url.startsWith('/api/protocols') && method === 'POST') return jsonResponse({ data: { protocol_id: 'p-new', name: 'x', item_count: 1 } }, 201)
  if (url.startsWith('/api/protocols')) return jsonResponse({ data: [{ protocol_id: 'p1', name: 'Weight Loss Protocol', description: null, therapeutic_category: null, total_duration_weeks: null, use_count: 1 }] })
  if (url.startsWith('/api/formulations?level=pharmacy_options')) {
    return jsonResponse({ data: [
      { pharmacy_formulation_id: 'pf-1', wholesale_price: 95, pharmacies: { pharmacy_id: 'pharmacy-strive', name: 'Strive Pharmacy' } },
      { pharmacy_formulation_id: 'pf-2', wholesale_price: 99, pharmacies: { pharmacy_id: 'pharmacy-quickrx', name: 'Quick Rx' } },
    ] })
  }
  throw new Error(`Unexpected fetch: ${method} ${url}`)
})

function seedSession(prescriptions: unknown[] = []) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ patient: PATIENT, provider: PROVIDER, prescriptions, notices: [] }))
}

function renderPanel(props: Partial<React.ComponentProps<typeof QuickActionsPanel>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <PrescriptionSessionProvider>
        <QuickActionsPanel onLoadFavorite={jest.fn()} {...props}>
          <input id="medication-search" aria-label="Search medications" />
        </QuickActionsPanel>
      </PrescriptionSessionProvider>
    </QueryClientProvider>,
  )
}

beforeAll(() => { global.fetch = mockFetch as unknown as typeof fetch })

beforeEach(() => {
  jest.clearAllMocks()
  sessionStorage.clear()
  favorites = [SEMA_FAV, OTHER_FAV]
  calls = []
  seedSession()
})

describe('layout — search first, buttons beside it', () => {
  it('renders the search input before the Favorites / Protocols buttons, with counts', async () => {
    renderPanel()
    const search = screen.getByLabelText('Search medications')
    const favButton = await screen.findByRole('button', { name: 'Favorites (2)' })
    const protoButton = await screen.findByRole('button', { name: 'Protocols (1)' })
    // DOM order: search precedes both buttons.
    expect(search.compareDocumentPosition(favButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(search.compareDocumentPosition(protoButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Nothing is open until a button is clicked.
    expect(screen.queryByTestId('favorites-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('protocols-panel')).not.toBeInTheDocument()
  })

  it('buttons open and close their panel; only one panel at a time', async () => {
    renderPanel()
    const favButton = await screen.findByRole('button', { name: 'Favorites (2)' })
    fireEvent.click(favButton)
    expect(screen.getByTestId('favorites-panel')).toBeInTheDocument()
    expect(favButton).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Protocols (1)' }))
    expect(screen.queryByTestId('favorites-panel')).not.toBeInTheDocument()
    expect(screen.getByTestId('protocols-panel')).toBeInTheDocument()
    expect(within(screen.getByTestId('protocols-panel')).getByText('Weight Loss Protocol')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Protocols (1)' }))
    expect(screen.queryByTestId('protocols-panel')).not.toBeInTheDocument()
  })
})

describe('favorites panel — mg display, Mine filter, + New', () => {
  it('writes each dose out with the computed mg: "10 units (0.5 mg) weekly"', async () => {
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Favorites (2)' }))
    const row = screen.getByTestId('favorite-fav-sema')
    expect(within(row).getByText('Semaglutide')).toBeInTheDocument()
    expect(within(row).getByTestId('favorite-preset')).toHaveTextContent('10 units (0.5 mg) weekly')
    // 1 mL of a 200 mg/mL formulation → 200 mg
    expect(within(screen.getByTestId('favorite-fav-other')).getByTestId('favorite-preset')).toHaveTextContent('1 mL (200.0 mg) weekly')
  })

  it('"Mine" narrows the clinic-wide list to the session provider', async () => {
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Favorites (2)' }))
    expect(screen.getByTestId('favorite-fav-other')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Mine'))
    expect(screen.queryByTestId('favorite-fav-other')).not.toBeInTheDocument()
    expect(screen.getByTestId('favorite-fav-sema')).toBeInTheDocument()
    // The button count stays clinic-wide; the panel heading shows the filtered count.
    expect(screen.getByRole('button', { name: 'Favorites (2)' })).toBeInTheDocument()
    expect(within(screen.getByTestId('favorites-panel')).getByText('Favorites (1)')).toBeInTheDocument()
  })

  it('"+ New" closes the panel and hands off to the search', async () => {
    const onNewFavorite = jest.fn()
    renderPanel({ onNewFavorite })
    fireEvent.click(await screen.findByRole('button', { name: 'Favorites (2)' }))
    fireEvent.click(within(screen.getByTestId('favorites-panel')).getByRole('button', { name: '+ New' }))
    expect(onNewFavorite).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('favorites-panel')).not.toBeInTheDocument()
  })
})

describe('favorites panel — edit', () => {
  it('editing a dose to 20 units previews "(1.0 mg)" and PATCHes the structured presets', async () => {
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Favorites (2)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit favorite Semaglutide' }))

    const form = screen.getByTestId('favorite-edit-fav-sema')
    expect(within(form).getByLabelText('Favorite name')).toHaveValue('Semaglutide')
    expect(within(form).getByTestId('favorite-dose-preview-1')).toHaveTextContent('10 units (0.5 mg) weekly')

    fireEvent.change(within(form).getByLabelText('Favorite dose amount 1'), { target: { value: '20' } })
    expect(within(form).getByTestId('favorite-dose-preview-1')).toHaveTextContent('20 units (1.0 mg) weekly')

    // Pharmacy select offers the live options for this formulation.
    await within(form).findByRole('option', { name: 'Quick Rx' })
    fireEvent.change(within(form).getByLabelText('Favorite pharmacy'), { target: { value: 'pharmacy-quickrx' } })

    favorites = [favorite({ ...SEMA_FAV, dose_presets: [preset('20')] }), OTHER_FAV]
    fireEvent.click(within(form).getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(calls.some(c => c.method === 'PATCH')).toBe(true))
    const patch = calls.find(c => c.method === 'PATCH')!
    expect(patch.url).toBe('/api/favorites?id=fav-sema')
    expect(patch.body).toEqual({
      label: 'Semaglutide',
      pharmacy_id: 'pharmacy-quickrx',
      dose_presets: [preset('20')],
      patient_id: null,
    })

    // The list refetches and shows the new mg.
    await waitFor(() => expect(screen.queryByTestId('favorite-edit-fav-sema')).not.toBeInTheDocument())
    await waitFor(() =>
      expect(within(screen.getByTestId('favorite-fav-sema')).getByTestId('favorite-preset')).toHaveTextContent('20 units (1.0 mg) weekly'),
    )
  })

  it('adds and removes doses; never sends a sig', async () => {
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Favorites (2)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit favorite Semaglutide' }))
    const form = screen.getByTestId('favorite-edit-fav-sema')
    fireEvent.click(within(form).getByRole('button', { name: '+ Add dose' }))
    fireEvent.change(within(form).getByLabelText('Favorite dose amount 2'), { target: { value: '40' } })
    expect(within(form).getByTestId('favorite-dose-preview-2')).toHaveTextContent('40 units (2.0 mg) weekly')
    fireEvent.click(within(form).getByRole('button', { name: '+ Add dose' }))
    fireEvent.click(within(form).getByRole('button', { name: 'Remove dose 3' }))
    fireEvent.click(within(form).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(calls.some(c => c.method === 'PATCH')).toBe(true))
    const body = calls.find(c => c.method === 'PATCH')!.body as Record<string, unknown>
    expect(body['dose_presets']).toEqual([preset('10'), preset('40')])
    expect(body).not.toHaveProperty('sig_text')
  })

  it('surfaces a failed save inline and keeps the form open', async () => {
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Favorites (2)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit favorite Semaglutide' }))
    const form = screen.getByTestId('favorite-edit-fav-sema')
    mockFetch.mockImplementationOnce((input: unknown, init?: { method?: string }) => {
      if (init?.method === 'PATCH') return jsonResponse({ error: 'That pharmacy does not offer this formulation' }, 400)
      return mockFetch.getMockImplementation()!(input, init)
    })
    fireEvent.click(within(form).getByRole('button', { name: 'Save changes' }))
    expect(await within(form).findByRole('alert')).toHaveTextContent(/does not offer/)
    expect(screen.getByTestId('favorite-edit-fav-sema')).toBeInTheDocument()
  })
})

describe('favorites panel — delete (two-step confirm, clinic-wide)', () => {
  it('asks for confirmation, then DELETEs and drops the row', async () => {
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Favorites (2)' }))
    // Another provider's favorite is deletable too — the list is clinic-wide.
    fireEvent.click(screen.getByRole('button', { name: 'Delete favorite TRT Cyp 200 — Weekly' }))
    expect(calls.some(c => c.method === 'DELETE')).toBe(false)
    const row = screen.getByTestId('favorite-fav-other')
    fireEvent.click(within(row).getByRole('button', { name: 'Cancel' }))
    expect(calls.some(c => c.method === 'DELETE')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Delete favorite TRT Cyp 200 — Weekly' }))
    fireEvent.click(within(row).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(calls.find(c => c.method === 'DELETE')?.url).toBe('/api/favorites?id=fav-other'))
    await waitFor(() => expect(screen.queryByTestId('favorite-fav-other')).not.toBeInTheDocument())
    await screen.findByRole('button', { name: 'Favorites (1)' })
  })
})

describe('protocols panel — + New saves the session lines', () => {
  it('explains when the session is empty, otherwise POSTs the lines as a protocol', async () => {
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Protocols (1)' }))
    fireEvent.click(within(screen.getByTestId('protocols-panel')).getByRole('button', { name: '+ New' }))
    expect(screen.getByText(/Add prescriptions to this session first/)).toBeInTheDocument()
  })

  it('POSTs the session lines and refreshes the list', async () => {
    seedSession([{
      id: 'line-1', pharmacyId: 'pharmacy-strive', pharmacyName: 'Strive Pharmacy', itemId: null,
      formulationId: 'formulation-sema', medicationName: 'Semaglutide 5mg/mL Injectable', form: 'Injectable Solution',
      dose: '10 units', wholesaleCents: 9500, deaSchedule: null, retailCents: 19000,
      sigText: 'Inject 10 units (0.10mL / 0.50mg) subcutaneously once weekly', integrationTier: '',
      frequencyCode: 'QW', quantityLabel: '5mL vial', rxDetails: { refills: 2 },
    }])
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Protocols (1)' }))
    fireEvent.click(within(screen.getByTestId('protocols-panel')).getByRole('button', { name: '+ New' }))
    const form = screen.getByTestId('new-protocol-form')
    expect(form).toHaveTextContent(/Saves the 1 prescription in this session/)
    fireEvent.change(within(form).getByLabelText('Protocol name'), { target: { value: 'GLP-1 Starter' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save protocol' }))

    await waitFor(() => expect(calls.some(c => c.method === 'POST')).toBe(true))
    const post = calls.find(c => c.method === 'POST')!
    expect(post.url).toBe('/api/protocols')
    expect(post.body).toEqual({
      name: 'GLP-1 Starter',
      created_by: PROVIDER_ID,
      items: [{
        formulation_id: 'formulation-sema', pharmacy_id: 'pharmacy-strive',
        dose_amount: '10', dose_unit: 'units', frequency_code: 'QW',
        sig_text: 'Inject 10 units (0.10mL / 0.50mg) subcutaneously once weekly',
        default_quantity: '5mL vial', default_refills: 2,
      }],
    })
    expect(await screen.findByRole('status')).toHaveTextContent(/Protocol “GLP-1 Starter” saved/)
  })
})
