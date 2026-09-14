/**
 * WO-104: Favorites panel — drug → common doses, categories, Recent,
 * patient favorites.
 *
 * Acceptance criteria pinned here (component layer):
 *   - one card per drug + formulation + pharmacy with its doses as chips
 *     (10 units · 20 units · 40 units · Custom)
 *   - a chip hands the favorite AND that preset to the builder; Custom
 *     hands the favorite with no preset; the panel closes, use is recorded
 *   - groups in a fixed category order, A–Z within each group
 *   - the selected patient's own favorites come first ("For Alex Demo");
 *     the request carries patient_id so other patients' are never fetched
 *   - Recent strip: the provider's last formulations; clicking one loads
 *     it, "Make favorite" creates a card, which then reads "★ Favorite"
 *   - an unlicensed card's chips are disabled
 */

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PrescriptionSessionProvider } from '../../_context/prescription-session'
import { QuickActionsPanel } from '../quick-actions-panel'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}))

const STORAGE_KEY = 'compoundiq-rx-session'
const PROVIDER_ID = '22222222-2222-4222-8222-222222222222'
const PATIENT_ID = '11111111-1111-4111-8111-111111111111'

const PATIENT = {
  patient_id: PATIENT_ID, first_name: 'Alex', last_name: 'Demo', date_of_birth: '1985-06-15',
  phone: '+15125550000', state: 'TX', sms_opt_in: true,
}
const PROVIDER = { provider_id: PROVIDER_ID, first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', signature_hash: null }

const SEMA_FORMULATION = {
  formulation_id: 'formulation-sema', name: 'Semaglutide 5mg/mL Injectable', concentration: '5mg/mL',
  concentration_value: 5, concentration_unit: 'mg/mL',
  dosage_forms: { name: 'Injectable Solution' },
  routes_of_administration: { name: 'Subcutaneous', abbreviation: 'SC', sig_prefix: 'Inject' },
}

const preset = (dose: string, extra: Record<string, unknown> = {}) =>
  ({ dose, unit: 'units', frequency: 'QW', timing: '', duration: '', label: null, ...extra })

function favorite(overrides: Record<string, unknown>) {
  return {
    favorite_id: 'fav', provider_id: PROVIDER_ID, formulation_id: 'formulation-sema', pharmacy_id: 'pharmacy-strive',
    patient_id: null, label: 'Favorite', category: 'Weight Management', dose_presets: [preset('10')],
    sig_mode: 'standard', default_refills: 0, use_count: 0, last_used_at: null,
    formulation_active: true, pharmacy_licensed: true,
    pharmacies: { pharmacy_id: 'pharmacy-strive', name: 'Strive Pharmacy' },
    formulations: SEMA_FORMULATION,
    ...overrides,
  }
}

const SEMA = favorite({
  favorite_id: 'fav-sema', label: 'Semaglutide',
  dose_presets: [preset('10', { label: 'Semaglutide 0.5mg weekly' }), preset('20'), preset('40')],
})
const TRT = favorite({ favorite_id: 'fav-trt', label: 'TRT Cyp 200 — Weekly', category: 'Hormones', formulation_id: 'f-trt', dose_presets: [preset('1', { unit: 'mL' })] })
const BIEST = favorite({ favorite_id: 'fav-biest', label: 'Biest 80/20', category: 'Hormones', formulation_id: 'f-biest' })
const BPC = favorite({ favorite_id: 'fav-bpc', label: 'BPC-157 daily cycling', category: 'Peptides', formulation_id: 'f-bpc', sig_mode: 'cycling' })
const LDN = favorite({ favorite_id: 'fav-ldn', label: 'LDN 4.5 Maintenance', category: null, formulation_id: 'f-ldn', pharmacy_licensed: false })
const ALEX_SEMA = favorite({ favorite_id: 'fav-alex', label: 'Semaglutide — Alex', patient_id: PATIENT_ID, dose_presets: [preset('80')] })

const RECENT = [
  {
    formulation_id: 'f-tirz', pharmacy_id: 'pharmacy-strive', medication_name: 'Tirzepatide', formulation_name: 'Tirzepatide 10mg/mL Injectable',
    pharmacy_name: 'Strive Pharmacy', last_prescribed_at: '2026-09-12T00:00:00Z', formulation_active: true,
    preset: preset('25'), formulations: { concentration_value: 10, concentration_unit: 'mg/mL', dosage_forms: { name: 'Injectable Solution' } },
  },
  {
    formulation_id: 'formulation-sema', pharmacy_id: 'pharmacy-strive', medication_name: 'Semaglutide', formulation_name: 'Semaglutide 5mg/mL Injectable',
    pharmacy_name: 'Strive Pharmacy', last_prescribed_at: '2026-09-10T00:00:00Z', formulation_active: true,
    preset: preset('20'), formulations: { concentration_value: 5, concentration_unit: 'mg/mL', dosage_forms: { name: 'Injectable Solution' } },
  },
]

let favorites: unknown[] = []
let calls: Array<{ url: string; method: string; body: unknown }> = []

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) })
}

const mockFetch = jest.fn((input: unknown, init?: { method?: string; body?: string }) => {
  const url = String(input)
  const method = init?.method ?? 'GET'
  calls.push({ url, method, body: init?.body ? JSON.parse(init.body) : null })
  if (url.startsWith('/api/favorites/recent')) return jsonResponse({ data: RECENT })
  if (url.startsWith('/api/favorites') && method === 'GET') return jsonResponse({ data: favorites })
  if (url.startsWith('/api/favorites') && method === 'PATCH') return jsonResponse({ ok: true })
  if (url.startsWith('/api/favorites') && method === 'POST') {
    favorites = [...favorites, favorite({ favorite_id: 'fav-tirz', label: 'Tirzepatide 10mg/mL Injectable', formulation_id: 'f-tirz', dose_presets: [preset('25')] })]
    return jsonResponse({ data: { favorite_id: 'fav-tirz' }, merged: false }, 201)
  }
  if (url.startsWith('/api/protocols')) return jsonResponse({ data: [] })
  throw new Error(`Unexpected fetch: ${method} ${url}`)
})

function renderPanel(props: Partial<React.ComponentProps<typeof QuickActionsPanel>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  const onLoadFavorite = jest.fn()
  const onLoadRecent = jest.fn()
  render(
    <QueryClientProvider client={queryClient}>
      <PrescriptionSessionProvider>
        <QuickActionsPanel onLoadFavorite={onLoadFavorite} onLoadRecent={onLoadRecent} {...props}>
          <input id="medication-search" aria-label="Search medications" />
        </QuickActionsPanel>
      </PrescriptionSessionProvider>
    </QueryClientProvider>,
  )
  return { onLoadFavorite, onLoadRecent }
}

beforeAll(() => { global.fetch = mockFetch as unknown as typeof fetch })

beforeEach(() => {
  jest.clearAllMocks()
  sessionStorage.clear()
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ patient: PATIENT, provider: PROVIDER, prescriptions: [], notices: [] }))
  favorites = [TRT, SEMA, LDN, BPC, ALEX_SEMA, BIEST]
  calls = []
})

async function openFavorites() {
  fireEvent.click(await screen.findByRole('button', { name: /^Favorites \(\d+\)$/ }))
  return screen.getByTestId('favorites-panel')
}

describe('cards with dose chips', () => {
  it('shows one Semaglutide card with 10 · 20 · 40 units and Custom, mg computed', async () => {
    renderPanel()
    await openFavorites()
    const card = screen.getByTestId('favorite-fav-sema')
    expect(within(card).getAllByTestId('favorite-preset').map(c => c.textContent)).toEqual([
      '10 units (0.5 mg) weekly', '20 units (1.0 mg) weekly', '40 units (2.0 mg) weekly',
    ])
    expect(within(card).getByTestId('favorite-custom')).toHaveTextContent('Custom')
    expect(within(card).getAllByTestId('favorite-preset')[0]).toHaveAttribute('title', 'Semaglutide 0.5mg weekly')
  })

  it('a chip hands the favorite and that preset to the builder; Custom hands no preset', async () => {
    const { onLoadFavorite } = renderPanel()
    await openFavorites()
    fireEvent.click(within(screen.getByTestId('favorite-fav-sema')).getAllByTestId('favorite-preset')[1]!)
    expect(onLoadFavorite).toHaveBeenCalledWith(expect.objectContaining({ favorite_id: 'fav-sema' }), preset('20'))
    expect(calls).toEqual(expect.arrayContaining([expect.objectContaining({ url: '/api/favorites?id=fav-sema', method: 'PATCH' })]))
    expect(screen.queryByTestId('favorites-panel')).not.toBeInTheDocument()

    await openFavorites()
    fireEvent.click(within(screen.getByTestId('favorite-fav-sema')).getByTestId('favorite-custom'))
    expect(onLoadFavorite).toHaveBeenLastCalledWith(expect.objectContaining({ favorite_id: 'fav-sema' }), null)
  })

  it('an unlicensed card cannot be loaded', async () => {
    const { onLoadFavorite } = renderPanel()
    await openFavorites()
    const card = screen.getByTestId('favorite-fav-ldn')
    expect(within(card).getByTestId('favorite-preset')).toBeDisabled()
    expect(within(card).getByTestId('favorite-custom')).toBeDisabled()
    fireEvent.click(within(card).getByTestId('favorite-custom'))
    expect(onLoadFavorite).not.toHaveBeenCalled()
  })
})

describe('sorting and patient favorites', () => {
  it('asks for this patient\'s favorites and lists them first, then categories in a fixed order, A–Z', async () => {
    renderPanel()
    const panel = await openFavorites()
    expect(calls.find(c => c.url.startsWith('/api/favorites?'))!.url).toBe(`/api/favorites?patient_state=TX&patient_id=${PATIENT_ID}`)
    const groups = within(panel).getAllByTestId(/^favorite-group-/)
    expect(groups.map(g => [
      g.getAttribute('data-testid'),
      within(g).queryAllByTestId(/^favorite-fav-/).map(c => c.getAttribute('data-testid')),
    ])).toEqual([
      ['favorite-group-For Alex Demo', ['favorite-fav-alex']],
      ['favorite-group-Peptides', ['favorite-fav-bpc']],
      ['favorite-group-Hormones', ['favorite-fav-biest', 'favorite-fav-trt']],
      ['favorite-group-Weight Management', ['favorite-fav-sema']],
      ['favorite-group-Other', ['favorite-fav-ldn']],
    ])
    expect(within(screen.getByTestId('favorite-fav-alex')).getByText('this patient only')).toBeInTheDocument()
  })

  it('"Mine" still narrows every group to the session provider', async () => {
    favorites = [SEMA, favorite({ ...TRT, provider_id: 'someone-else' })]
    renderPanel()
    await openFavorites()
    expect(screen.getByTestId('favorite-fav-trt')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Mine'))
    expect(screen.queryByTestId('favorite-fav-trt')).not.toBeInTheDocument()
    expect(screen.queryByTestId('favorite-group-Hormones')).not.toBeInTheDocument()
    expect(screen.getByTestId('favorite-fav-sema')).toBeInTheDocument()
  })
})

describe('Recent strip', () => {
  it('lists the provider\'s recent formulations; a click loads it onto the dose step', async () => {
    const { onLoadRecent } = renderPanel()
    await openFavorites()
    const strip = await screen.findByTestId('favorites-recent')
    expect(calls.some(c => c.url === `/api/favorites/recent?provider_id=${PROVIDER_ID}`)).toBe(true)
    expect(within(strip).getByTestId('recent-f-tirz')).toHaveTextContent('Tirzepatide 10mg/mL Injectable')
    expect(within(strip).getByTestId('recent-f-tirz')).toHaveTextContent('25 units (2.5 mg) weekly · Strive Pharmacy')
    // Semaglutide 20 units at Strive is already on the Semaglutide card.
    expect(within(strip).getByTestId('recent-formulation-sema')).toHaveTextContent('★ Favorite')

    fireEvent.click(within(strip).getByText('Tirzepatide 10mg/mL Injectable'))
    expect(onLoadRecent).toHaveBeenCalledWith(RECENT[0])
  })

  it('"Make favorite" creates a practice card from the recent dose', async () => {
    renderPanel()
    await openFavorites()
    fireEvent.click(await screen.findByRole('button', { name: 'Make Tirzepatide 10mg/mL Injectable a favorite' }))
    await waitFor(() => expect(calls.some(c => c.method === 'POST')).toBe(true))
    expect(calls.find(c => c.method === 'POST')!.body).toEqual({
      provider_id: PROVIDER_ID, formulation_id: 'f-tirz', pharmacy_id: 'pharmacy-strive', patient_id: null,
      label: 'Tirzepatide 10mg/mL Injectable', dose_presets: [preset('25')],
    })
    expect(await screen.findByTestId('favorite-fav-tirz')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('recent-f-tirz')).toHaveTextContent('★ Favorite'))
  })
})
