/**
 * WO-105: the titration builder is a step table, and what it shows is
 * derived.
 *
 * Gina Rooks, 2026-09-11 (00:56:14): "with drugs that you titrate, it
 * would be nice to have like do this for the first four weeks, do this
 * for the next four weeks." (00:57:56): "I would see the titration as
 * like at least a different box for like each next step."
 *
 * Pinned here (the real builder, APIs mocked):
 *   - steps are added and removed; per-step quantity and the total are
 *     shown and are not typeable (phase rule 3)
 *   - the sig reads as steps + total, never "titrate up by ... as tolerated"
 *   - Continue carries the steps to the price step as structured values
 *   - a titration favorite reopens AS a titration with its steps
 *   - steps that cross capsule strengths are refused and block Continue
 *   - switching to Cycling leaves the cycling sig exactly as it was
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
const KETO_FORMULATION = {
  ...FORMULATION,
  formulation_id: 'formulation-keto', name: 'Ketotifen 0.1mg Capsule', concentration: '0.1mg',
  concentration_value: 0.1, concentration_unit: 'mg/capsule',
  dosage_forms: { name: 'Capsule', is_sterile: false, requires_injection_supplies: false },
  routes_of_administration: { name: 'Oral', abbreviation: 'PO', sig_prefix: 'Take' },
}

const LDN_TITRATION_FAVORITE = {
  favorite_id: 'fav-ldn', provider_id: PROVIDER_ID, formulation_id: 'formulation-sema', pharmacy_id: 'pharmacy-strive',
  patient_id: null, label: 'LDN Starter — Titration', category: 'Peptides',
  dose_presets: [],
  sig_mode: 'titration',
  titration_steps: [
    { dose: '10', unit: 'units', frequency: 'QW', weeks: 4 },
    { dose: '20', unit: 'units', frequency: 'QW', weeks: 4 },
  ],
  default_refills: 2, use_count: 5, last_used_at: null,
  formulation_active: true, pharmacy_licensed: true,
  pharmacies: { pharmacy_id: 'pharmacy-strive', name: 'Strive Pharmacy' },
  formulations: { ...FORMULATION, dosage_forms: { name: 'Injectable Solution' } },
}

// A plain favorite, used only as the way in to the dose step: its
// Custom chip pre-selects the formulation and pharmacy and leaves the
// dose fields empty, which is the same state a search lands in.
const STANDARD_FAVORITE = {
  ...LDN_TITRATION_FAVORITE,
  favorite_id: 'fav-plain', label: 'Semaglutide', sig_mode: 'standard', titration_steps: [],
}

function jsonResponse(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
}

let formulation: typeof FORMULATION = FORMULATION

const mockFetch = jest.fn((input: unknown, init?: { method?: string }) => {
  const url = String(input)
  const method = init?.method ?? 'GET'
  if (url.startsWith('/api/favorites/recent')) return jsonResponse({ data: [] })
  if (url.startsWith('/api/favorites') && method === 'PATCH') return jsonResponse({ ok: true })
  if (url.startsWith('/api/favorites')) return jsonResponse({ data: [STANDARD_FAVORITE, LDN_TITRATION_FAVORITE] })
  if (url.startsWith('/api/protocols')) return jsonResponse({ data: [] })
  if (url.includes('level=formulation&')) return jsonResponse({ data: { formulation, salt_form: SALT_FORM, ingredient: INGREDIENT } })
  if (url.includes('level=salt_forms')) return jsonResponse({ data: [SALT_FORM] })
  if (url.includes('level=formulations')) return jsonResponse({ data: [formulation] })
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

/** Into the dose step with a formulation and pharmacy selected, dose empty. */
async function openDoseStep() {
  renderBuilder()
  fireEvent.click(await screen.findByRole('button', { name: /^Favorites/ }))
  const card = screen.getByTestId('favorite-fav-plain')
  fireEvent.click(within(card).getByTestId('favorite-custom'))
  await screen.findByTestId('dose-step')
}

async function switchTo(mode: 'Titration' | 'Cycling') {
  fireEvent.click(screen.getByRole('button', { name: mode }))
}

beforeAll(() => { global.fetch = mockFetch as unknown as typeof fetch })
beforeEach(() => {
  jest.clearAllMocks()
  sessionStorage.clear()
  formulation = FORMULATION
})

describe('the titration step table', () => {
  it('sums the steps, shows the total, and never says "titrate up ... as tolerated"', async () => {
    await openDoseStep()
    await switchTo('Titration')

    const table = await screen.findByTestId('titration-builder')
    fireEvent.change(within(table).getByLabelText('Step 1 dose'), { target: { value: '10' } })
    fireEvent.change(within(table).getByLabelText('Step 1 unit'), { target: { value: 'units' } })
    fireEvent.change(within(table).getByLabelText('Step 1 frequency'), { target: { value: 'QW' } })
    fireEvent.change(within(table).getByLabelText('Step 1 weeks'), { target: { value: '4' } })

    fireEvent.click(screen.getByTestId('titration-add-step'))
    fireEvent.change(within(table).getByLabelText('Step 2 dose'), { target: { value: '20' } })
    fireEvent.change(within(table).getByLabelText('Step 2 weeks'), { target: { value: '4' } })

    fireEvent.click(screen.getByTestId('titration-add-step'))
    fireEvent.change(within(table).getByLabelText('Step 3 dose'), { target: { value: '40' } })
    fireEvent.change(within(table).getByLabelText('Step 3 weeks'), { target: { value: '4' } })

    // Per-step quantities, derived: 0.4 / 0.8 / 1.6 mL.
    await waitFor(() => expect(screen.getByTestId('titration-step-0-quantity')).toHaveTextContent('0.4 mL'))
    expect(screen.getByTestId('titration-step-1-quantity')).toHaveTextContent('0.8 mL')
    expect(screen.getByTestId('titration-step-2-quantity')).toHaveTextContent('1.6 mL')
    expect(screen.getByTestId('titration-total')).toHaveTextContent('Total 2.8 mL over 84 days')

    // The totals are read-only — nothing about them is an input.
    expect(screen.getByTestId('titration-total').querySelector('input')).toBeNull()

    const sig = screen.getByText(/Weeks 1–4: inject 10 units/)
    expect(sig).toHaveTextContent('Total dispense 2.8 mL over 84 days.')
    expect(screen.queryByText(/titrate up by|as tolerated/i)).not.toBeInTheDocument()
  })

  it('removes a step', async () => {
    await openDoseStep()
    await switchTo('Titration')
    const table = await screen.findByTestId('titration-builder')
    fireEvent.change(within(table).getByLabelText('Step 1 dose'), { target: { value: '10' } })
    fireEvent.click(screen.getByTestId('titration-add-step'))
    fireEvent.change(within(table).getByLabelText('Step 2 dose'), { target: { value: '20' } })
    await waitFor(() => expect(screen.getByTestId('titration-step-1')).toBeInTheDocument())

    fireEvent.click(within(table).getByRole('button', { name: 'Remove step 2' }))
    await waitFor(() => expect(screen.queryByTestId('titration-step-1')).not.toBeInTheDocument())
    expect(screen.getByTestId('titration-step-0')).toBeInTheDocument()
    // The last step cannot be removed — a titration is at least one step.
    expect(within(table).queryByRole('button', { name: 'Remove step 1' })).not.toBeInTheDocument()
  })

  it('carries the steps to the price step as structured values', async () => {
    await openDoseStep()
    await switchTo('Titration')
    const table = await screen.findByTestId('titration-builder')
    fireEvent.change(within(table).getByLabelText('Step 1 dose'), { target: { value: '10' } })
    fireEvent.change(within(table).getByLabelText('Step 1 weeks'), { target: { value: '4' } })
    await waitFor(() => expect(screen.getByTestId('titration-total')).toBeInTheDocument())

    const cont = await screen.findByRole('button', { name: 'Continue — Set Retail Price' })
    await waitFor(() => expect(cont).toBeEnabled())
    fireEvent.click(cont)

    const url = mockPush.mock.calls[0]![0] as string
    const params = new URLSearchParams(url.split('?')[1])
    expect(params.get('sigMode')).toBe('titration')
    expect(JSON.parse(params.get('titrationSteps')!)).toEqual([
      { dose: '10', unit: 'units', frequency: 'QW', weeks: 4 },
    ])
  })
})

describe('a titration favorite comes back as a titration', () => {
  it('loads the step table with its steps, not a standard sig', async () => {
    renderBuilder()
    fireEvent.click(await screen.findByRole('button', { name: /^Favorites/ }))
    const card = screen.getByTestId('favorite-fav-ldn')
    fireEvent.click(within(card).getByTestId('favorite-custom'))

    const table = await screen.findByTestId('titration-builder')
    await waitFor(() => expect(within(table).getByLabelText('Step 1 dose')).toHaveValue('10'))
    expect(within(table).getByLabelText('Step 2 dose')).toHaveValue('20')
    expect(screen.getByTestId('titration-total')).toHaveTextContent('Total 1.2 mL over 56 days')
  })
})

describe('multi-strength titrations fail loudly', () => {
  it('refuses capsule strengths that cross formulations and blocks Continue', async () => {
    formulation = KETO_FORMULATION
    await openDoseStep()
    await switchTo('Titration')

    const table = await screen.findByTestId('titration-builder')
    fireEvent.change(within(table).getByLabelText('Step 1 dose'), { target: { value: '0.1' } })
    fireEvent.change(within(table).getByLabelText('Step 1 unit'), { target: { value: 'mg' } })
    fireEvent.change(within(table).getByLabelText('Step 1 frequency'), { target: { value: 'QD' } })
    fireEvent.click(screen.getByTestId('titration-add-step'))
    fireEvent.change(within(table).getByLabelText('Step 2 dose'), { target: { value: '0.5' } })

    const problem = await screen.findByTestId('titration-problem')
    expect(problem).toHaveTextContent(/more than one capsule strength/i)
    expect(problem).toHaveTextContent(/one line per strength/i)
    // No total is offered, and the line cannot be priced.
    expect(screen.queryByTestId('titration-total')).not.toBeInTheDocument()
    const cont = screen.queryByRole('button', { name: 'Continue — Set Retail Price' })
    if (cont) expect(cont).toBeDisabled()
  })
})

describe('switching modes never leaves a half-titration behind', () => {
  it('titration → standard brings the Dose and Duration fields back and sends no steps', async () => {
    await openDoseStep()
    await switchTo('Titration')
    const table = await screen.findByTestId('titration-builder')
    fireEvent.change(within(table).getByLabelText('Step 1 dose'), { target: { value: '10' } })
    fireEvent.change(within(table).getByLabelText('Step 1 weeks'), { target: { value: '4' } })
    await waitFor(() => expect(screen.getByTestId('titration-total')).toBeInTheDocument())
    // In titration mode the single dose and duration are gone: the steps
    // are the dose and the duration.
    expect(screen.queryByLabelText('Dose amount')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Duration')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Standard' }))

    await waitFor(() => expect(screen.getByLabelText('Dose amount')).toBeInTheDocument())
    expect(screen.getByLabelText('Duration')).toBeInTheDocument()
    expect(screen.queryByTestId('titration-builder')).not.toBeInTheDocument()

    // And nothing titration-shaped travels with the line. The migration's
    // CHECK would reject orphan steps on a standard order; the UI must
    // never send them in the first place.
    fireEvent.change(screen.getByLabelText('Dose amount'), { target: { value: '20' } })
    fireEvent.change(screen.getByLabelText('Dose unit'), { target: { value: 'units' } })
    fireEvent.change(screen.getByLabelText('Frequency'), { target: { value: 'QW' } })
    const cont = await screen.findByRole('button', { name: 'Continue — Set Retail Price' })
    await waitFor(() => expect(cont).toBeEnabled())
    fireEvent.click(cont)

    const params = new URLSearchParams((mockPush.mock.calls[0]![0] as string).split('?')[1])
    expect(params.get('sigMode')).toBe('standard')
    expect(params.get('titrationSteps')).toBeNull()
  })

  it('standard → titration does not carry the single dose into step 1', async () => {
    await openDoseStep()
    fireEvent.change(screen.getByLabelText('Dose amount'), { target: { value: '40' } })
    fireEvent.change(screen.getByLabelText('Dose unit'), { target: { value: 'units' } })
    fireEvent.change(screen.getByLabelText('Frequency'), { target: { value: 'QW' } })

    await switchTo('Titration')

    const table = await screen.findByTestId('titration-builder')
    // The dose is the one thing a step must be typed: a silent 40 here
    // would be a prescription nobody wrote.
    expect(within(table).getByLabelText('Step 1 dose')).toHaveValue('')
    expect(screen.queryByTestId('titration-total')).not.toBeInTheDocument()
    expect(screen.queryByTestId('titration-problem')).not.toBeInTheDocument()
  })
})

describe('reopening a saved titration line (WO-98)', () => {
  it('comes back showing the step table with its steps, not the dose row', () => {
    render(
      <StructuredSigBuilder
        formulation={FORMULATION as never}
        doseAmount="" doseUnit="units" frequency="QW"
        onDoseAmountChange={() => {}} onDoseUnitChange={() => {}} onFrequencyChange={() => {}}
        onSigChange={() => {}}
        initialSigMode="titration"
        initialTitrationSteps={[
          { dose: '10', unit: 'units', frequency: 'QW', weeks: 4 },
          { dose: '20', unit: 'units', frequency: 'QW', weeks: 4 },
        ]}
      />,
    )

    const table = screen.getByTestId('titration-builder')
    expect(within(table).getByLabelText('Step 1 dose')).toHaveValue('10')
    expect(within(table).getByLabelText('Step 2 dose')).toHaveValue('20')
    expect(screen.getByTestId('titration-total')).toHaveTextContent('Total 1.2 mL over 56 days')
    // The dose row stays hidden: the steps are the dose and the duration.
    expect(screen.queryByLabelText('Dose amount')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Duration')).not.toBeInTheDocument()
  })
})

describe('WO-105 does not touch cycling', () => {
  it('the cycling sig is exactly what it was before', async () => {
    await openDoseStep()
    fireEvent.change(screen.getByLabelText('Dose amount'), { target: { value: '20' } })
    fireEvent.change(screen.getByLabelText('Dose unit'), { target: { value: 'units' } })
    fireEvent.change(screen.getByLabelText('Frequency'), { target: { value: 'QD' } })
    await switchTo('Cycling')

    await waitFor(() => expect(
      screen.getByText('“Inject 20 units (0.20mL / 1.00mg) subcutaneous once daily, 5 days on / 2 days off, for 6 weeks then reassess”'),
    ).toBeInTheDocument())
    expect(screen.queryByTestId('titration-builder')).not.toBeInTheDocument()
  })
})
