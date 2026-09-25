/**
 * Cycling dose math on the dose step.
 *
 *   - a cycling line carries a length (the cycle length the provider
 *     entered, defaulting to the builder's 6 weeks) and the dosing-day
 *     count is shown, computed, never typed
 *   - Continue sends the pattern and the length as structured values
 *   - a cycling favorite opens in cycling mode, from the Favorites panel
 *     AND from the dose step's Common doses chips (both opened Standard)
 *   - a line saved before the pattern was stored opens in cycling mode,
 *     asks for the days on and off, and shows the old sig for reference;
 *     it produces no sig (so no Continue) until they are entered
 */

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PrescriptionSessionProvider } from '../../_context/prescription-session'
import { CascadingPrescriptionBuilder } from '../cascading-prescription-builder'
import { StructuredSigBuilder } from '../structured-sig-builder'

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), refresh: jest.fn() }),
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

const STANDARD_FAVORITE = {
  favorite_id: 'fav-plain', provider_id: PROVIDER_ID, formulation_id: 'formulation-sema', pharmacy_id: 'pharmacy-strive',
  patient_id: null, label: 'Semaglutide', category: 'Weight Management',
  dose_presets: [], sig_mode: 'standard', titration_steps: [],
  cycle_on_days: null, cycle_off_days: null, cycle_duration_days: null,
  default_refills: 0, use_count: 5, last_used_at: null,
  formulation_active: true, pharmacy_licensed: true,
  pharmacies: { pharmacy_id: 'pharmacy-strive', name: 'Strive Pharmacy' },
  formulations: { ...FORMULATION, dosage_forms: { name: 'Injectable Solution' } },
}
const CYCLING_FAVORITE = {
  ...STANDARD_FAVORITE,
  favorite_id: 'fav-cycling', label: 'Semaglutide daily cycling',
  dose_presets: [{ dose: '20', unit: 'units', frequency: 'QD', timing: '', duration: '', label: null }],
  sig_mode: 'cycling', cycle_on_days: 5, cycle_off_days: 2, cycle_duration_days: 42,
}

function jsonResponse(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
}

const mockFetch = jest.fn((input: unknown, init?: { method?: string }) => {
  const url = String(input)
  const method = init?.method ?? 'GET'
  if (url.startsWith('/api/favorites/recent')) return jsonResponse({ data: [] })
  if (url.startsWith('/api/favorites') && method === 'PATCH') return jsonResponse({ ok: true })
  if (url.startsWith('/api/favorites')) return jsonResponse({ data: [STANDARD_FAVORITE, CYCLING_FAVORITE] })
  if (url.startsWith('/api/protocols')) return jsonResponse({ data: [] })
  if (url.includes('level=formulation&')) return jsonResponse({ data: { formulation: FORMULATION, salt_form: SALT_FORM, ingredient: INGREDIENT } })
  if (url.includes('level=salt_forms')) return jsonResponse({ data: [SALT_FORM] })
  if (url.includes('level=formulations')) return jsonResponse({ data: [FORMULATION] })
  if (url.includes('level=ingredients')) return jsonResponse({ data: [INGREDIENT] })
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

async function openDoseStep() {
  renderBuilder()
  fireEvent.click(await screen.findByRole('button', { name: /^Favorites/ }))
  fireEvent.click(within(screen.getByTestId('favorite-fav-plain')).getByTestId('favorite-custom'))
  await screen.findByTestId('dose-step')
}

async function continueParams(): Promise<URLSearchParams> {
  const cont = await screen.findByRole('button', { name: 'Continue — Set Retail Price' })
  await waitFor(() => expect(cont).toBeEnabled())
  fireEvent.click(cont)
  const url = mockPush.mock.calls[mockPush.mock.calls.length - 1]![0] as string
  return new URLSearchParams(url.split('?')[1])
}

beforeAll(() => { global.fetch = mockFetch as unknown as typeof fetch })
beforeEach(() => {
  jest.clearAllMocks()
  sessionStorage.clear()
})

describe('a cycling line on the dose step', () => {
  async function tenUnitsCycling() {
    await openDoseStep()
    fireEvent.change(screen.getByLabelText('Dose amount'), { target: { value: '10' } })
    fireEvent.change(screen.getByLabelText('Dose unit'), { target: { value: 'units' } })
    fireEvent.change(screen.getByLabelText('Frequency'), { target: { value: 'QD' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cycling' }))
    await screen.findByTestId('cycling-builder')
  }

  it('5 on / 2 off for 30 days: 22 dosing days, shown and sent as structured values', async () => {
    await tenUnitsCycling()
    fireEvent.change(screen.getByLabelText('Cycle length unit'), { target: { value: 'days' } })
    fireEvent.change(screen.getByLabelText('Cycle length'), { target: { value: '30' } })

    await waitFor(() => expect(screen.getByTestId('cycling-dosing-days')).toHaveTextContent(
      '22 dosing days in 30 days (5 days on / 2 days off, starting on an on-day)',
    ))
    // One length on a cycling line: the Standard Duration dropdown is not
    // shown beside it (it never applied to cycling).
    expect(screen.queryByLabelText('Duration')).not.toBeInTheDocument()

    const params = await continueParams()
    expect(params.get('sigMode')).toBe('cycling')
    expect(params.get('cycleOnDays')).toBe('5')
    expect(params.get('cycleOffDays')).toBe('2')
    expect(params.get('durationDays')).toBe('30')
    expect(params.get('sigText')).toBe('Inject 10 units (0.10mL / 0.50mg) subcutaneous once daily, 5 days on / 2 days off, for 30 days then reassess')
  })

  it('the length defaults to the cycle length already on screen — 6 weeks — so nothing new is required', async () => {
    await tenUnitsCycling()
    await waitFor(() => expect(screen.getByTestId('cycling-dosing-days')).toHaveTextContent('30 dosing days in 42 days'))
    const params = await continueParams()
    expect(params.get('durationDays')).toBe('42')
  })

  it('ongoing: no length, like Standard Ongoing — sized from the package', async () => {
    await tenUnitsCycling()
    fireEvent.change(screen.getByLabelText('Cycle length unit'), { target: { value: 'ongoing' } })
    const params = await continueParams()
    expect(params.get('durationDays')).toBe('')
    expect(params.get('cycleOnDays')).toBe('5')
    expect(params.get('sigText')).toBe('Inject 10 units (0.10mL / 0.50mg) subcutaneous once daily, 5 days on / 2 days off, ongoing')
  })
})

describe('a cycling favorite opens in cycling mode', () => {
  it('from its chip in the Favorites panel, with its pattern and length', async () => {
    renderBuilder()
    fireEvent.click(await screen.findByRole('button', { name: /^Favorites/ }))
    fireEvent.click(within(screen.getByTestId('favorite-fav-cycling')).getByTestId('favorite-preset'))

    const cyc = await screen.findByTestId('cycling-builder')
    await waitFor(() => expect(within(cyc).getByLabelText('Days on')).toHaveValue(5))
    expect(within(cyc).getByLabelText('Days off')).toHaveValue(2)
    expect(within(cyc).getByLabelText('Cycle length')).toHaveValue(6)
    expect(within(cyc).getByLabelText('Cycle length unit')).toHaveValue('weeks')
    await waitFor(() => expect(
      screen.getByText('“Inject 20 units (0.20mL / 1.00mg) subcutaneous once daily, 5 days on / 2 days off, for 6 weeks then reassess”'),
    ).toBeInTheDocument())
  })

  it('from the Common doses chip on the dose step', async () => {
    await openDoseStep()
    const chips = await screen.findByTestId('dose-step-presets')
    fireEvent.click(within(chips).getByRole('button', { name: /20 units/ }))

    const cyc = await screen.findByTestId('cycling-builder')
    expect(within(cyc).getByLabelText('Days on')).toHaveValue(5)
    expect(within(cyc).getByLabelText('Days off')).toHaveValue(2)
    const params = await continueParams()
    expect(params.get('sigMode')).toBe('cycling')
    expect(params.get('durationDays')).toBe('42')
  })
})

describe('an old cycling order with no stored pattern', () => {
  const OLD_SIG = 'Inject 20 units (0.20mL / 1mg) subcutaneous once daily, 5 days on / 2 days off, for 6 weeks then reassess'

  it('opens in cycling mode, asks for the days on and off, and shows the old sig — no sig until they are entered', async () => {
    const onSigChange = jest.fn()
    render(
      <StructuredSigBuilder
        formulation={FORMULATION}
        doseAmount="20"
        doseUnit="units"
        frequency="QD"
        onDoseAmountChange={() => {}}
        onDoseUnitChange={() => {}}
        onFrequencyChange={() => {}}
        onSigChange={onSigChange}
        initialSigText={OLD_SIG}
        initialSigMode="cycling"
        initialCycle={null}
      />,
    )

    const ask = screen.getByTestId('cycling-pattern-required')
    expect(ask).toHaveTextContent('Enter the days on and days off')
    expect(ask).toHaveTextContent(OLD_SIG)
    const cyc = screen.getByTestId('cycling-builder')
    expect(within(cyc).getByLabelText('Days on')).toHaveValue(null)
    expect(within(cyc).getByLabelText('Days off')).toHaveValue(null)
    // Nothing is generated from a guessed pattern.
    await waitFor(() => expect(onSigChange).toHaveBeenLastCalledWith(''))

    fireEvent.change(within(cyc).getByLabelText('Days on'), { target: { value: '5' } })
    fireEvent.change(within(cyc).getByLabelText('Days off'), { target: { value: '2' } })
    await waitFor(() => expect(onSigChange).toHaveBeenLastCalledWith(expect.stringContaining('5 days on / 2 days off')))
    expect(screen.queryByTestId('cycling-pattern-required')).not.toBeInTheDocument()
  })
})
