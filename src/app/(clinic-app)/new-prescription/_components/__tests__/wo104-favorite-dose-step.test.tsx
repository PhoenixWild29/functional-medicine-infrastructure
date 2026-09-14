/**
 * WO-104: a favorite lands on the DOSE STEP with the builder dropdowns
 * populated — not on the price step with a free-text sig — and it never
 * goes through sig parsing.
 *
 * Gina Rooks, 2026-09-11: "when selected, it would be nice to still be
 * able to revert to the Rx builder drop downs rather than editing a free
 * text box."
 *
 * Pinned here (the real builder, APIs mocked):
 *   - "20 units" chip → dose step: amount 20, unit units, Once weekly, In
 *     the morning, For 30 days; the generated sig reads
 *     "Inject 20 units (0.20mL / 1.00mg) subcutaneous once weekly in the
 *     morning for 30 days"; nothing navigates until Continue
 *   - Continue carries the structured duration + timing to the price step
 *     (so the price step never falls back to the sig)
 *   - Custom → dose step with the formulation and pharmacy pre-selected,
 *     dose fields empty and live
 *   - the clinic's common doses also show as chips on the dose step
 *   - timingAndDurationFromSig / durationDaysFromSig are never called
 */

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PrescriptionSessionProvider } from '../../_context/prescription-session'
import { CascadingPrescriptionBuilder } from '../cascading-prescription-builder'
import { timingAndDurationFromSig } from '../../_lib/sig-recovery'
import { durationDaysFromSig } from '@/lib/orders/rx-details'

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), refresh: jest.fn() }),
}))

// The only two sig parsers that recover timing / duration. A favorite
// must never reach either.
jest.mock('../../_lib/sig-recovery', () => ({
  timingAndDurationFromSig: jest.fn(() => ({ timing: '', duration: '', customDurationDays: '' })),
}))
jest.mock('@/lib/orders/rx-details', () => ({
  ...jest.requireActual('@/lib/orders/rx-details'),
  durationDaysFromSig: jest.fn(() => null),
}))

const STORAGE_KEY = 'compoundiq-rx-session'
const PROVIDER_ID = '22222222-2222-4222-8222-222222222222'

const INGREDIENT = {
  ingredient_id: 'ing-sema', common_name: 'Semaglutide', therapeutic_category: 'Weight Management',
  dea_schedule: null, fda_alert_status: null, fda_alert_message: null, description: null,
}
const SALT_FORM = { salt_form_id: 'sf-sema', salt_name: 'Semaglutide Base', abbreviation: null }
const FORMULATION = {
  formulation_id: 'formulation-sema', name: 'Semaglutide 5mg/mL Injectable', concentration: '5mg/mL',
  concentration_value: 5, concentration_unit: 'mg/mL', excipient_base: null, is_combination: false,
  total_ingredients: 1, description: null,
  dosage_forms: { name: 'Injectable Solution', is_sterile: true, requires_injection_supplies: true },
  routes_of_administration: { name: 'Subcutaneous', abbreviation: 'SC', sig_prefix: 'Inject' },
  formulation_ingredients: [],
}

const preset = (dose: string, extra: Record<string, unknown> = {}) =>
  ({ dose, unit: 'units', frequency: 'QW', timing: 'MORNING', duration: '30', label: null, ...extra })

const SEMA_FAVORITE = {
  favorite_id: 'fav-sema', provider_id: PROVIDER_ID, formulation_id: 'formulation-sema', pharmacy_id: 'pharmacy-strive',
  patient_id: null, label: 'Semaglutide', category: 'Weight Management',
  dose_presets: [preset('10'), preset('20'), preset('40', { duration: 'ONGOING', timing: '' })],
  sig_mode: 'standard', default_refills: 2, use_count: 3, last_used_at: null,
  formulation_active: true, pharmacy_licensed: true,
  pharmacies: { pharmacy_id: 'pharmacy-strive', name: 'Strive Pharmacy' },
  formulations: { ...FORMULATION, dosage_forms: { name: 'Injectable Solution' } },
}

function jsonResponse(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
}

const mockFetch = jest.fn((input: unknown, init?: { method?: string }) => {
  const url = String(input)
  const method = init?.method ?? 'GET'
  if (url.startsWith('/api/favorites/recent')) return jsonResponse({ data: [] })
  if (url.startsWith('/api/favorites') && method === 'PATCH') return jsonResponse({ ok: true })
  if (url.startsWith('/api/favorites')) return jsonResponse({ data: [SEMA_FAVORITE] })
  if (url.startsWith('/api/protocols')) return jsonResponse({ data: [] })
  if (url.includes('level=formulation&')) return jsonResponse({ data: { formulation: FORMULATION, salt_form: SALT_FORM, ingredient: INGREDIENT } })
  if (url.includes('level=salt_forms')) return jsonResponse({ data: [SALT_FORM] })
  if (url.includes('level=formulations')) return jsonResponse({ data: [FORMULATION] })
  if (url.includes('level=pharmacy_options')) {
    return jsonResponse({ data: [{
      pharmacy_formulation_id: 'pf-strive', wholesale_price: 95, available_quantities: ['1mL vial', '5mL vial'],
      estimated_turnaround_days: 5,
      pharmacies: { pharmacy_id: 'pharmacy-strive', name: 'Strive Pharmacy', slug: 'strive', integration_tier: 'TIER_4_FAX', fax_number: null, supports_real_time_status: false },
    }] })
  }
  if (url.includes('level=')) return jsonResponse({ data: [] })
  throw new Error(`Unexpected fetch: ${method} ${url}`)
})

function renderBuilder() {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
    patient: { patient_id: 'patient-1', first_name: 'Alex', last_name: 'Demo', date_of_birth: '1985-06-15', phone: '+15125550000', state: 'TX', sms_opt_in: true },
    provider: { provider_id: PROVIDER_ID, first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', signature_hash: null },
    prescriptions: [], notices: [],
  }))
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <PrescriptionSessionProvider>
        <CascadingPrescriptionBuilder />
      </PrescriptionSessionProvider>
    </QueryClientProvider>,
  )
}

async function openCard() {
  fireEvent.click(await screen.findByRole('button', { name: 'Favorites (1)' }))
  return screen.getByTestId('favorite-fav-sema')
}

beforeAll(() => {
  global.fetch = mockFetch as unknown as typeof fetch
})

beforeEach(() => {
  jest.clearAllMocks()
  sessionStorage.clear()
})

describe('favorite chip → dose step (structured, no sig parsing)', () => {
  it('"20 units" populates every dropdown and generates the sig on the dose step', async () => {
    renderBuilder()
    const card = await openCard()
    fireEvent.click(within(card).getByRole('button', { name: /^20 units/ }))

    await waitFor(() => expect(screen.getByLabelText('Dose amount')).toHaveValue('20'))
    expect(screen.getByLabelText('Dose unit')).toHaveValue('units')
    expect(screen.getByLabelText('Frequency')).toHaveValue('QW')
    expect(screen.getByLabelText('Timing')).toHaveValue('MORNING')
    expect(screen.getByLabelText('Duration')).toHaveValue('30')
    expect(screen.getByText('“Inject 20 units (0.20mL / 1.00mg) subcutaneous once weekly in the morning for 30 days”')).toBeInTheDocument()
    expect(screen.getByLabelText('Search medications')).toHaveValue('Semaglutide')
    // Still on the dose step: nothing navigated, the panel closed.
    expect(mockPush).not.toHaveBeenCalled()
    expect(screen.queryByTestId('favorites-panel')).not.toBeInTheDocument()

    // The pinned pharmacy is selected; Continue prices as normal.
    const cont = await screen.findByRole('button', { name: 'Continue — Set Retail Price' })
    await waitFor(() => expect(cont).toBeEnabled())
    fireEvent.click(cont)
    expect(mockPush).toHaveBeenCalledTimes(1)
    const url = new URL(mockPush.mock.calls[0]![0] as string, 'http://localhost')
    expect(url.pathname).toBe('/new-prescription/margin')
    expect(Object.fromEntries(url.searchParams)).toEqual(expect.objectContaining({
      pharmacyId: 'pharmacy-strive', formulation_id: 'formulation-sema',
      dose: '20 units', frequency: 'QW', durationDays: '30', timing: 'MORNING', refills: '2',
      sigText: 'Inject 20 units (0.20mL / 1.00mg) subcutaneous once weekly in the morning for 30 days',
    }))

    expect(timingAndDurationFromSig).not.toHaveBeenCalled()
    expect(durationDaysFromSig).not.toHaveBeenCalled()
  })

  it('Custom lands on the dose step with the formulation and pharmacy pre-selected and the dose empty', async () => {
    renderBuilder()
    const card = await openCard()
    fireEvent.click(within(card).getByRole('button', { name: 'Custom' }))

    await waitFor(() => expect(screen.getByTestId('dose-step')).toBeInTheDocument())
    expect(screen.getByLabelText('Dose amount')).toHaveValue('')
    expect(screen.getByLabelText('Frequency')).toHaveValue('')
    expect(screen.getByLabelText('Timing')).toHaveValue('')
    expect(screen.getByLabelText('Duration')).toHaveValue('')
    // Unit defaults from the dosage form, as picking the formulation by hand does.
    expect(screen.getByLabelText('Dose unit')).toHaveValue('units')
    expect(await screen.findByText('Strive Pharmacy')).toBeInTheDocument()

    // The dropdowns are live: the common-dose chips and free entry both work.
    const chips = within(screen.getByTestId('dose-step-presets'))
    expect(chips.getAllByRole('button').map(b => b.textContent)).toEqual([
      '10 units (0.5 mg) weekly', '20 units (1.0 mg) weekly', '40 units (2.0 mg) weekly',
    ])
    fireEvent.click(chips.getByRole('button', { name: /^40 units/ }))
    expect(screen.getByLabelText('Dose amount')).toHaveValue('40')
    expect(screen.getByLabelText('Duration')).toHaveValue('ONGOING')
    fireEvent.change(screen.getByLabelText('Dose amount'), { target: { value: '15' } })
    expect(screen.getByText('“Inject 15 units (0.15mL / 0.75mg) subcutaneous once weekly, ongoing”')).toBeInTheDocument()
    expect(mockPush).not.toHaveBeenCalled()
    expect(timingAndDurationFromSig).not.toHaveBeenCalled()
  })
})
