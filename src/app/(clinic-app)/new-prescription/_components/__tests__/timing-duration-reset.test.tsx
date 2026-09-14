/**
 * Duration and timing never carry into a new prescription.
 *
 * Product owner, defect 3: after a prescription with "For 90 days" and
 * "In the morning", a new prescription opened a different medication's
 * dose step with both still selected while Frequency was empty. Duration
 * drives days supply, dispense quantity and the suggested vial count, so
 * a vial count could be computed from a duration nobody chose.
 *
 * The leak reproduced here: the sig builder's timing + duration were
 * seeded from `initialStructured`, and when that was null (every
 * medication picked by hand) it fell back to parsing the sig of the line
 * being reopened — for whichever medication was on the dose step. A line
 * reopened with "in the morning for 90 days" handed both to the next
 * medication chosen, with Frequency empty. The builder now sets an empty
 * timing + duration for every hand pick and passes the reopened line's
 * sig only for that line's own formulation.
 *
 * Pinned here (the real builder, APIs mocked):
 *   - new session: a favorite dose with no timing or duration opens with
 *     both empty after a 90-day / morning line, and the default quantity
 *     is not computed from a duration
 *   - same session, second line: the same
 *   - a reopened line's timing + duration never move to a medication
 *     picked by hand, and the price step gets no duration (fails before
 *     the fix)
 *   - the reopened line itself still keeps its own timing + duration
 *   - a favorite dose that carries a duration and timing still applies them
 */

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PrescriptionSessionProvider } from '../../_context/prescription-session'
import { CascadingPrescriptionBuilder } from '../cascading-prescription-builder'
import type { EditTarget } from '../../_lib/edit-target'

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), refresh: jest.fn() }),
}))

const STORAGE_KEY = 'compoundiq-rx-session'
const PROVIDER_ID = '22222222-2222-4222-8222-222222222222'

const SALT_FORM = { salt_form_id: 'sf-base', salt_name: 'Base', abbreviation: null }
const ingredient = (id: string, name: string) => ({
  ingredient_id: id, common_name: name, therapeutic_category: 'Peptides',
  dea_schedule: null, fda_alert_status: null, fda_alert_message: null, description: null,
})
const formulation = (id: string, name: string) => ({
  formulation_id: id, name, concentration: '5mg/mL',
  concentration_value: 5, concentration_unit: 'mg/mL', excipient_base: null, is_combination: false,
  total_ingredients: 1, description: null,
  dosage_forms: { name: 'Injectable Solution', is_sterile: true, requires_injection_supplies: true },
  routes_of_administration: { name: 'Subcutaneous', abbreviation: 'SC', sig_prefix: 'Inject' },
  formulation_ingredients: [],
})

const SEMA = { ingredient: ingredient('ing-sema', 'Semaglutide'), formulation: formulation('formulation-sema', 'Semaglutide 5mg/mL Injectable') }
const BPC = { ingredient: ingredient('ing-bpc', 'BPC-157'), formulation: formulation('formulation-bpc', 'BPC-157 5mg/mL Injectable') }
const CONTEXT: Record<string, typeof SEMA> = { 'formulation-sema': SEMA, 'formulation-bpc': BPC }

const favorite = (id: string, label: string, med: typeof SEMA, presets: unknown[]) => ({
  favorite_id: id, provider_id: PROVIDER_ID, formulation_id: med.formulation.formulation_id, pharmacy_id: 'pharmacy-strive',
  patient_id: null, label, category: 'Peptides', dose_presets: presets,
  sig_mode: 'standard', default_refills: 0, use_count: 0, last_used_at: null,
  formulation_active: true, pharmacy_licensed: true,
  pharmacies: { pharmacy_id: 'pharmacy-strive', name: 'Strive Pharmacy' },
  formulations: { ...med.formulation, dosage_forms: { name: 'Injectable Solution' } },
})

// Semaglutide: 90 days in the morning, and 45 days at bedtime (Custom).
const SEMA_FAVORITE = favorite('fav-sema', 'Semaglutide', SEMA, [
  { dose: '20', unit: 'units', frequency: 'QW', timing: 'MORNING', duration: '90', label: null },
  { dose: '40', unit: 'units', frequency: 'QW', timing: 'BEDTIME', duration: '45', label: null },
])
// BPC-157: a dose with neither a timing nor a duration (nor a frequency).
const BPC_FAVORITE = favorite('fav-bpc', 'BPC-157', BPC, [
  { dose: '10', unit: 'units', frequency: '', timing: '', duration: '', label: null },
])

function jsonResponse(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
}

const mockFetch = jest.fn((input: unknown, init?: { method?: string }) => {
  const url = String(input)
  const method = init?.method ?? 'GET'
  if (url.startsWith('/api/favorites/recent')) return jsonResponse({ data: [] })
  if (url.startsWith('/api/favorites') && method === 'PATCH') return jsonResponse({ ok: true })
  if (url.startsWith('/api/favorites')) return jsonResponse({ data: [SEMA_FAVORITE, BPC_FAVORITE] })
  if (url.startsWith('/api/protocols')) return jsonResponse({ data: [] })
  const params = new URL(url, 'http://localhost').searchParams
  const level = params.get('level')
  if (level === 'formulation') {
    const med = CONTEXT[params.get('formulation_id') ?? '']
    return jsonResponse({ data: med ? { formulation: med.formulation, salt_form: SALT_FORM, ingredient: med.ingredient } : null })
  }
  if (level === 'ingredients') return jsonResponse({ data: [BPC.ingredient] })
  if (level === 'salt_forms') return jsonResponse({ data: [SALT_FORM] })
  if (level === 'formulations') return jsonResponse({ data: [BPC.formulation] })
  if (level === 'pharmacy_options') {
    return jsonResponse({ data: [{
      pharmacy_formulation_id: `pf-${params.get('formulation_id')}`, wholesale_price: 95, estimated_turnaround_days: 5,
      pharmacies: { pharmacy_id: 'pharmacy-strive', name: 'Strive Pharmacy', slug: 'strive', integration_tier: 'TIER_4_FAX', fax_number: null, supports_real_time_status: false },
    }] })
  }
  if (level) return jsonResponse({ data: [] })
  throw new Error(`Unexpected fetch: ${method} ${url}`)
})

const PATIENT_ALEX = { patient_id: 'patient-1', first_name: 'Alex', last_name: 'Demo', date_of_birth: '1985-06-15', phone: '+15125550000', state: 'TX', sms_opt_in: true }
const PATIENT_JORDAN = { patient_id: 'patient-2', first_name: 'Jordan', last_name: 'Demo', date_of_birth: '1990-01-01', phone: '+15125550001', state: 'TX', sms_opt_in: true }
const PROVIDER = { provider_id: PROVIDER_ID, first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', signature_hash: null }

// The Semaglutide line as it sits in the session after the 90-day / morning Rx.
const SEMA_LINE = {
  id: 'line-sema', pharmacyId: 'pharmacy-strive', pharmacyName: 'Strive Pharmacy',
  itemId: null, formulationId: 'formulation-sema', medicationName: 'Semaglutide 5mg/mL Injectable',
  form: 'Injectable Solution', dose: '20 units', wholesaleCents: 9500, deaSchedule: null, retailCents: 15000,
  sigText: 'Inject 20 units (0.20mL / 1.00mg) subcutaneous once weekly in the morning for 90 days',
  integrationTier: 'TIER_4_FAX', frequencyCode: 'QW', quantityLabel: null,
}

function seedSession(patient: typeof PATIENT_ALEX, prescriptions: unknown[] = []) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ patient, provider: PROVIDER, prescriptions, notices: [] }))
}

// One QueryClient for the whole test, as the clinic app keeps one across
// routes; the builder itself mounts per page.
function renderBuilder(queryClient: QueryClient, editTarget: EditTarget | null = null) {
  return render(
    <QueryClientProvider client={queryClient}>
      <PrescriptionSessionProvider>
        <CascadingPrescriptionBuilder editTarget={editTarget} />
      </PrescriptionSessionProvider>
    </QueryClientProvider>,
  )
}

function newQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
}

async function loadFavoriteDose(favoriteId: string, chip: RegExp) {
  fireEvent.click(await screen.findByRole('button', { name: /^Favorites \(\d+\)$/ }))
  const card = await screen.findByTestId(`favorite-${favoriteId}`)
  fireEvent.click(within(card).getByRole('button', { name: chip }))
}

function doseStep() {
  return {
    amount:    screen.getByLabelText('Dose amount'),
    frequency: screen.getByLabelText('Frequency'),
    timing:    screen.getByLabelText('Timing'),
    duration:  screen.getByLabelText('Duration'),
  }
}

async function loadSema90Morning() {
  await loadFavoriteDose('fav-sema', /^20 units/)
  await waitFor(() => expect(screen.getByLabelText('Dose amount')).toHaveValue('20'))
  expect(doseStep().timing).toHaveValue('MORNING')
  expect(doseStep().duration).toHaveValue('90')
}

beforeAll(() => {
  global.fetch = mockFetch as unknown as typeof fetch
})

beforeEach(() => {
  jest.clearAllMocks()
  sessionStorage.clear()
})

describe('timing + duration never carry into a new prescription', () => {
  it('new session: a favorite dose with no timing or duration opens with both empty after a 90-day, in-the-morning line', async () => {
    const queryClient = newQueryClient()
    seedSession(PATIENT_ALEX)
    const first = renderBuilder(queryClient)
    await loadSema90Morning()
    first.unmount()

    // Sent; a new session for another patient.
    sessionStorage.clear()
    seedSession(PATIENT_JORDAN)
    renderBuilder(queryClient)
    await loadFavoriteDose('fav-bpc', /^10 units/)

    await waitFor(() => expect(screen.getByLabelText('Search medications')).toHaveValue('BPC-157'))
    const step = doseStep()
    expect(step.amount).toHaveValue('10')
    expect(step.frequency).toHaveValue('')
    expect(step.timing).toHaveValue('')
    expect(step.duration).toHaveValue('')
    // The quantity default is not computed from a duration.
    expect(await screen.findByTestId('quantity-default-hint')).toHaveTextContent('Smallest package listed — change if needed.')
  })

  it('same session, second line: the no-duration favorite resets both after the 90-day one', async () => {
    seedSession(PATIENT_ALEX)
    renderBuilder(newQueryClient())
    await loadSema90Morning()

    await loadFavoriteDose('fav-bpc', /^10 units/)
    await waitFor(() => expect(screen.getByLabelText('Search medications')).toHaveValue('BPC-157'))
    const step = doseStep()
    expect(step.frequency).toHaveValue('')
    expect(step.timing).toHaveValue('')
    expect(step.duration).toHaveValue('')
  })

  it('a reopened line with "in the morning for 90 days" never hands them to a medication picked by hand', async () => {
    seedSession(PATIENT_ALEX, [SEMA_LINE])
    renderBuilder(newQueryClient(), { kind: 'session', lineId: 'line-sema' })
    await waitFor(() => expect(screen.getByLabelText('Duration')).toHaveValue('90'))

    fireEvent.change(screen.getByLabelText('Search medications'), { target: { value: 'BP' } })
    fireEvent.click(await screen.findByRole('button', { name: /BPC-157/ }))
    fireEvent.click(await screen.findByRole('button', { name: /BPC-157 5mg\/mL Injectable/ }))

    await waitFor(() => expect(screen.getByTestId('dose-step')).toBeInTheDocument())
    const step = doseStep()
    expect(step.frequency).toHaveValue('')
    expect(step.timing).toHaveValue('')
    expect(step.duration).toHaveValue('')

    // Priced with no duration: the price step gets neither.
    fireEvent.change(step.amount, { target: { value: '10' } })
    fireEvent.change(step.frequency, { target: { value: 'QD' } })
    fireEvent.click(await screen.findByRole('button', { name: /Strive Pharmacy/ }))
    expect(screen.getByTestId('quantity-default-hint')).toHaveTextContent('Smallest package listed — change if needed.')
    const cont = screen.getByRole('button', { name: 'Continue — Set Retail Price' })
    await waitFor(() => expect(cont).toBeEnabled())
    fireEvent.click(cont)
    const url = new URL(mockPush.mock.calls[0]![0] as string, 'http://localhost')
    expect(url.searchParams.get('formulation_id')).toBe('formulation-bpc')
    expect(url.searchParams.get('durationDays')).toBe('')
    expect(url.searchParams.get('timing')).toBe('')
    expect(url.searchParams.get('sigText')).not.toMatch(/morning|90 days/)
  })

  it('a reopened line keeps its own timing and duration (WO-98)', async () => {
    seedSession(PATIENT_ALEX, [SEMA_LINE])
    renderBuilder(newQueryClient(), { kind: 'session', lineId: 'line-sema' })
    await waitFor(() => expect(screen.getByLabelText('Dose amount')).toHaveValue('20'))
    const step = doseStep()
    expect(step.frequency).toHaveValue('QW')
    expect(step.timing).toHaveValue('MORNING')
    expect(step.duration).toHaveValue('90')
  })

  it('a favorite dose that carries a duration and timing still applies them, after a dose without', async () => {
    seedSession(PATIENT_ALEX)
    renderBuilder(newQueryClient())
    await loadFavoriteDose('fav-bpc', /^10 units/)
    await waitFor(() => expect(screen.getByLabelText('Dose amount')).toHaveValue('10'))
    expect(doseStep().duration).toHaveValue('')

    await loadSema90Morning()
    expect(doseStep().frequency).toHaveValue('QW')

    // A duration with no dropdown entry lands on Custom with its days.
    await loadFavoriteDose('fav-sema', /^40 units/)
    await waitFor(() => expect(screen.getByLabelText('Dose amount')).toHaveValue('40'))
    expect(doseStep().timing).toHaveValue('BEDTIME')
    expect(doseStep().duration).toHaveValue('CUSTOM')
    expect(screen.getByPlaceholderText('Days')).toHaveValue(45)
    expect(await screen.findByTestId('quantity-default-hint')).toHaveTextContent('Smallest package that covers 45 days — change if needed.')
  })
})
