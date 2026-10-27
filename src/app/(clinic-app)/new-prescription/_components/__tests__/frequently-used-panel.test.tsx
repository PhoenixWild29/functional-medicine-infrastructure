/**
 * Requirement 19 (coverage audit, D-2026-10-25-05), the Favorites panel:
 *
 *   - "Frequently used" replaces "Recent": the provider's most-ordered
 *     formulation + dose combinations over 90 days (GET
 *     /api/favorites/frequent), each with the drug, the dose with its mg
 *     ("25 units (2.5 mg) weekly") and how many times it was used. With
 *     nothing in the window the section is "Recent", same shape.
 *   - Clicking an entry opens it on the builder's dose step (unchanged).
 *   - "Make favorite" opens a dialog: save for the practice or for this
 *     patient, and which doses (the used dose ticked; the drug's other
 *     common doses offered so they group under the drug, requirement 17;
 *     a dose can be added). Saving uses POST /api/favorites, which merges
 *     into an existing card for the same drug, pharmacy and scope.
 *
 * Harness from wo104-favorites-panel.test.tsx.
 */

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PrescriptionSessionProvider } from '../../_context/prescription-session'
import { QuickActionsPanel } from '../quick-actions-panel'
import { MakeFavoriteDialog } from '../make-favorite-dialog'

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

const preset = (dose: string, extra: Record<string, unknown> = {}) =>
  ({ dose, unit: 'units', frequency: 'QW', timing: '', duration: '', label: null, ...extra })

const TIRZ_CONC = { concentration_value: 10, concentration_unit: 'mg/mL', dosage_forms: { name: 'Injectable Solution' } }
const SEMA_CONC = { concentration_value: 5, concentration_unit: 'mg/mL', dosage_forms: { name: 'Injectable Solution' } }

function item(formulation: string, name: string, dose: string, useCount: number, conc: unknown, extra: Record<string, unknown> = {}) {
  return {
    formulation_id: formulation, pharmacy_id: 'pharmacy-strive', medication_name: name.split(' ')[0], formulation_name: name,
    pharmacy_name: 'Strive Pharmacy', last_prescribed_at: '2026-10-20T00:00:00Z', formulation_active: true,
    preset: preset(dose), use_count: useCount, formulations: conc, ...extra,
  }
}

const TIRZ_25 = item('f-tirz', 'Tirzepatide 10mg/mL Injectable', '25', 4, TIRZ_CONC)
const SEMA_20 = item('formulation-sema', 'Semaglutide 5mg/mL Injectable', '20', 2, SEMA_CONC)
const TIRZ_50 = item('f-tirz', 'Tirzepatide 10mg/mL Injectable', '50', 1, TIRZ_CONC)

function favorite(overrides: Record<string, unknown>) {
  return {
    favorite_id: 'fav', provider_id: PROVIDER_ID, formulation_id: 'formulation-sema', pharmacy_id: 'pharmacy-strive',
    patient_id: null, label: 'Favorite', category: 'Weight Management', dose_presets: [preset('10')],
    sig_mode: 'standard', default_refills: 0, use_count: 0, last_used_at: null,
    formulation_active: true, pharmacy_licensed: true,
    pharmacies: { pharmacy_id: 'pharmacy-strive', name: 'Strive Pharmacy' },
    formulations: { formulation_id: 'formulation-sema', name: 'Semaglutide 5mg/mL Injectable', concentration: '5mg/mL', ...SEMA_CONC, routes_of_administration: null },
    ...overrides,
  }
}

const SEMA_CARD = favorite({ favorite_id: 'fav-sema', label: 'Semaglutide', dose_presets: [preset('10'), preset('20')] })
// The clinic's other Tirzepatide dose, on a card at another pharmacy.
const TIRZ_QUICK_CARD = favorite({
  favorite_id: 'fav-tirz-quick', label: 'Tirzepatide (Quick Rx)', formulation_id: 'f-tirz', pharmacy_id: 'pharmacy-quick',
  dose_presets: [preset('15')], pharmacies: { pharmacy_id: 'pharmacy-quick', name: 'Quick Rx' },
})

let favorites: unknown[] = []
let frequent: { mode: string; window_days: number; data: unknown[] } = { mode: 'frequent', window_days: 90, data: [] }
let postStatus = 201
let calls: Array<{ url: string; method: string; body: unknown }> = []

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) })
}

const mockFetch = jest.fn((input: unknown, init?: { method?: string; body?: string }) => {
  const url = String(input)
  const method = init?.method ?? 'GET'
  calls.push({ url, method, body: init?.body ? JSON.parse(init.body) : null })
  if (url.startsWith('/api/favorites/frequent')) return jsonResponse(frequent)
  if (url.startsWith('/api/favorites') && method === 'GET') return jsonResponse({ data: favorites })
  if (url.startsWith('/api/favorites') && method === 'PATCH') return jsonResponse({ ok: true })
  if (url.startsWith('/api/favorites') && method === 'POST') {
    if (postStatus >= 400) return jsonResponse({ error: 'Favorites could not be loaded or saved. Nothing was changed. Try again.' }, postStatus)
    const body = JSON.parse(init!.body!) as { patient_id: string | null; dose_presets: unknown[] }
    favorites = [...favorites, favorite({
      favorite_id: 'fav-tirz', label: 'Tirzepatide 10mg/mL Injectable', formulation_id: 'f-tirz',
      patient_id: body.patient_id, dose_presets: body.dose_presets,
    })]
    return jsonResponse({ data: { favorite_id: 'fav-tirz' }, merged: false }, 201)
  }
  if (url.startsWith('/api/protocols')) return jsonResponse({ data: [] })
  throw new Error(`Unexpected fetch: ${method} ${url}`)
})

function renderPanel(session: { patient: unknown } = { patient: PATIENT }) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ patient: session.patient, provider: PROVIDER, prescriptions: [], notices: [] }))
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  const onLoadFavorite = jest.fn()
  const onLoadFrequent = jest.fn()
  render(
    <QueryClientProvider client={queryClient}>
      <PrescriptionSessionProvider>
        <QuickActionsPanel onLoadFavorite={onLoadFavorite} onLoadFrequent={onLoadFrequent}>
          <input id="medication-search" aria-label="Search medications" />
        </QuickActionsPanel>
      </PrescriptionSessionProvider>
    </QueryClientProvider>,
  )
  return { onLoadFavorite, onLoadFrequent }
}

async function openFavorites() {
  fireEvent.click(await screen.findByRole('button', { name: /^Favorites \(\d+\)$/ }))
  return screen.getByTestId('favorites-panel')
}

const entries = () => within(screen.getByTestId('favorites-frequent')).getAllByTestId('frequent-item')
const entry = (text: string) => entries().find(e => e.textContent?.includes(text))!

beforeAll(() => { global.fetch = mockFetch as unknown as typeof fetch })

beforeEach(() => {
  jest.clearAllMocks()
  sessionStorage.clear()
  favorites = [SEMA_CARD, TIRZ_QUICK_CARD]
  frequent = { mode: 'frequent', window_days: 90, data: [TIRZ_25, SEMA_20, TIRZ_50] }
  postStatus = 201
  calls = []
})

describe('Frequently used section', () => {
  it('lists the most-used combinations with the drug, the dose with mg and the use count', async () => {
    renderPanel()
    await openFavorites()
    const section = await screen.findByTestId('favorites-frequent')
    expect(calls.some(c => c.url === `/api/favorites/frequent?provider_id=${PROVIDER_ID}`)).toBe(true)
    expect(within(section).getByText('Frequently used (last 90 days)')).toBeInTheDocument()
    expect(screen.queryByText('Recent')).not.toBeInTheDocument()
    expect(entries()).toHaveLength(3)
    expect(entries()[0]).toHaveTextContent('Tirzepatide 10mg/mL Injectable')
    expect(entries()[0]).toHaveTextContent('25 units (2.5 mg) weekly · Strive Pharmacy · used 4 times')
    expect(entries()[2]).toHaveTextContent('50 units (5.0 mg) weekly · Strive Pharmacy · used once')
    // Semaglutide 20 units at Strive is already on the Semaglutide card.
    expect(entry('Semaglutide')).toHaveTextContent('★ Favorite')
  })

  it('nothing in the window: the same section, titled Recent', async () => {
    frequent = { mode: 'recent', window_days: 90, data: [{ ...TIRZ_25, use_count: 1 }] }
    renderPanel()
    await openFavorites()
    const section = await screen.findByTestId('favorites-frequent')
    expect(within(section).getByText('Recent')).toBeInTheDocument()
    expect(entries()[0]).toHaveTextContent('25 units (2.5 mg) weekly · Strive Pharmacy · used once')
  })

  it('no orders: no section', async () => {
    frequent = { mode: 'frequent', window_days: 90, data: [] }
    renderPanel()
    await openFavorites()
    await waitFor(() => expect(calls.some(c => c.url.startsWith('/api/favorites/frequent'))).toBe(true))
    expect(screen.queryByTestId('favorites-frequent')).not.toBeInTheDocument()
  })

  it('clicking an entry opens that dose on the builder dose step', async () => {
    const { onLoadFrequent } = renderPanel()
    await openFavorites()
    await screen.findByTestId('favorites-frequent')
    fireEvent.click(within(entries()[0]!).getByText('Tirzepatide 10mg/mL Injectable'))
    expect(onLoadFrequent).toHaveBeenCalledWith(TIRZ_25)
  })
})

describe('Make favorite dialog', () => {
  async function openDialog(patient: unknown = PATIENT) {
    renderPanel({ patient })
    await openFavorites()
    await screen.findByTestId('favorites-frequent')
    fireEvent.click(within(entries()[0]!).getByRole('button', { name: 'Make Tirzepatide 10mg/mL Injectable a favorite' }))
    return screen.getByRole('dialog', { name: 'Make Tirzepatide 10mg/mL Injectable a favorite' })
  }

  it('keyboard: after a save, focus goes to the entry itself (its Make favorite button is replaced by "★ Favorite"), never to the page', async () => {
    renderPanel({ patient: PATIENT })
    await openFavorites()
    await screen.findByTestId('favorites-frequent')
    const entry = entries()[0]!
    const main = within(entry).getAllByRole('button')[0]!
    const opener = within(entry).getByRole('button', { name: 'Make Tirzepatide 10mg/mL Injectable a favorite' })
    opener.focus()
    fireEvent.click(opener)
    const dialog = screen.getByRole('dialog', { name: 'Make Tirzepatide 10mg/mL Injectable a favorite' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save favorite' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(main).toHaveFocus()
    expect(document.activeElement).not.toBe(document.body)
  })

  it('keyboard: focus moves into the dialog, Tab and Shift+Tab stay inside it, Escape closes it and focus returns to Make favorite', async () => {
    renderPanel({ patient: PATIENT })
    await openFavorites()
    await screen.findByTestId('favorites-frequent')
    const opener = within(entries()[0]!).getByRole('button', { name: 'Make Tirzepatide 10mg/mL Injectable a favorite' })
    opener.focus()
    fireEvent.click(opener)
    const dialog = screen.getByRole('dialog', { name: 'Make Tirzepatide 10mg/mL Injectable a favorite' })
    expect(dialog).toHaveFocus()

    // The first and last tabbable controls: the practice radio, Save favorite.
    const practice = within(dialog).getByRole('radio', { name: 'The practice' })
    const save = within(dialog).getByRole('button', { name: 'Save favorite' })
    save.focus()
    fireEvent.keyDown(save, { key: 'Tab' })
    expect(practice).toHaveFocus()
    fireEvent.keyDown(practice, { key: 'Tab', shiftKey: true })
    expect(save).toHaveFocus()

    // Escape closes it; focus is back on the button that opened it.
    fireEvent.keyDown(save, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(opener).toHaveFocus()
  })

  it('opens with the practice chosen, the used dose ticked and the drug\'s other doses offered', async () => {
    const dialog = await openDialog()
    expect(within(dialog).getByRole('radio', { name: 'The practice' })).toBeChecked()
    expect(within(dialog).getByRole('radio', { name: 'Only for Alex Demo' })).not.toBeChecked()
    const doses = within(dialog).getAllByRole('checkbox')
    expect(doses.map(d => (d as HTMLInputElement).labels?.[0]?.textContent)).toEqual([
      '15 units (1.5 mg) weekly', '25 units (2.5 mg) weekly', '50 units (5.0 mg) weekly',
    ])
    expect(within(dialog).getByRole('checkbox', { name: '25 units (2.5 mg) weekly' })).toBeChecked()
    expect(within(dialog).getByRole('checkbox', { name: '15 units (1.5 mg) weekly' })).not.toBeChecked()
    expect(within(dialog).getByRole('checkbox', { name: '50 units (5.0 mg) weekly' })).not.toBeChecked()
    // Nothing is saved until Save favorite.
    expect(calls.some(c => c.method === 'POST')).toBe(false)
  })

  it('saves the ticked doses for the practice; the entry then reads ★ Favorite', async () => {
    const dialog = await openDialog()
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '50 units (5.0 mg) weekly' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save favorite' }))
    await waitFor(() => expect(calls.some(c => c.method === 'POST')).toBe(true))
    expect(calls.find(c => c.method === 'POST')!.body).toEqual({
      provider_id: PROVIDER_ID, formulation_id: 'f-tirz', pharmacy_id: 'pharmacy-strive', patient_id: null,
      label: 'Tirzepatide 10mg/mL Injectable', dose_presets: [preset('25'), preset('50')],
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(entry('25 units')).toHaveTextContent('★ Favorite'))
  })

  it('saves for this patient only when chosen', async () => {
    const dialog = await openDialog()
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Only for Alex Demo' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save favorite' }))
    await waitFor(() => expect(calls.some(c => c.method === 'POST')).toBe(true))
    expect(calls.find(c => c.method === 'POST')!.body).toEqual(expect.objectContaining({ patient_id: PATIENT_ID, dose_presets: [preset('25')] }))
  })

  it('a dose can be added; it is ticked and saved with the others', async () => {
    const dialog = await openDialog()
    fireEvent.change(within(dialog).getByLabelText('New dose amount'), { target: { value: '7.5' } })
    fireEvent.change(within(dialog).getByLabelText('New dose unit'), { target: { value: 'units' } })
    fireEvent.change(within(dialog).getByLabelText('New dose frequency'), { target: { value: 'QW' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add dose' }))
    expect(within(dialog).getByRole('checkbox', { name: '7.5 units (0.75 mg) weekly' })).toBeChecked()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save favorite' }))
    await waitFor(() => expect(calls.some(c => c.method === 'POST')).toBe(true))
    expect((calls.find(c => c.method === 'POST')!.body as { dose_presets: unknown[] }).dose_presets).toEqual([preset('7.5'), preset('25')])
  })

  it('with no dose ticked, Save is disabled', async () => {
    const dialog = await openDialog()
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '25 units (2.5 mg) weekly' }))
    expect(within(dialog).getByRole('button', { name: 'Save favorite' })).toBeDisabled()
  })

  it('no patient in context: no patient choice, saved for the practice', async () => {
    // The search step always has a patient; the dialog still handles none.
    render(
      <MakeFavoriteDialog
        target={TIRZ_25 as unknown as React.ComponentProps<typeof MakeFavoriteDialog>['target']}
        otherDoses={[]} patient={null} providerId={PROVIDER_ID} onClose={jest.fn()} onSaved={jest.fn()}
      />,
    )
    const dialog = screen.getByRole('dialog', { name: 'Make Tirzepatide 10mg/mL Injectable a favorite' })
    expect(within(dialog).queryByRole('radio')).not.toBeInTheDocument()
    expect(within(dialog).getByText('Saved for the practice.')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save favorite' }))
    await waitFor(() => expect(calls.some(c => c.method === 'POST')).toBe(true))
    expect(calls.find(c => c.method === 'POST')!.body).toEqual(expect.objectContaining({ patient_id: null }))
  })

  it('Cancel or Escape closes it without saving', async () => {
    let dialog = await openDialog()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(within(entries()[0]!).getByRole('button', { name: 'Make Tirzepatide 10mg/mL Injectable a favorite' }))
    dialog = screen.getByRole('dialog')
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(calls.some(c => c.method === 'POST')).toBe(false)
  })

  it('a failed save keeps the dialog open and says why', async () => {
    postStatus = 500
    const dialog = await openDialog()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save favorite' }))
    // The error is a live region (always in the DOM, announced when it fills).
    await waitFor(() => expect(within(dialog).getByTestId('make-favorite-error')).toHaveTextContent('Favorites could not be loaded or saved. Nothing was changed. Try again.'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})

// C-2026-10-25-10 (review of favorites-frequent): a dose pinned only to
// the session patient is offered only when the favorite is for that
// patient, never for the practice card; and the dialog starts over when
// the session patient changes.
describe('Make favorite dialog: patient-only doses and a patient change', () => {
  const TIRZ_PINNED = favorite({
    favorite_id: 'fav-tirz-pinned', label: 'Tirzepatide (Alex)', formulation_id: 'f-tirz', patient_id: PATIENT_ID,
    dose_presets: [preset('30')],
  })
  const PINNED = '30 units (3.0 mg) weekly'

  it('practice: the patient-only dose is not offered; for this patient it is', async () => {
    favorites = [SEMA_CARD, TIRZ_QUICK_CARD, TIRZ_PINNED]
    renderPanel()
    await openFavorites()
    await screen.findByTestId('favorites-frequent')
    fireEvent.click(within(entries()[0]!).getByRole('button', { name: 'Make Tirzepatide 10mg/mL Injectable a favorite' }))
    const dialog = screen.getByRole('dialog', { name: 'Make Tirzepatide 10mg/mL Injectable a favorite' })
    expect(within(dialog).getByRole('radio', { name: 'The practice' })).toBeChecked()
    expect(within(dialog).queryByRole('checkbox', { name: PINNED })).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Only for Alex Demo' }))
    expect(within(dialog).getByRole('checkbox', { name: PINNED })).not.toBeChecked()
    // Ticked for the patient, then back to the practice: it is not saved there.
    fireEvent.click(within(dialog).getByRole('checkbox', { name: PINNED }))
    fireEvent.click(within(dialog).getByRole('radio', { name: 'The practice' }))
    expect(within(dialog).queryByRole('checkbox', { name: PINNED })).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save favorite' }))
    await waitFor(() => expect(calls.some(c => c.method === 'POST')).toBe(true))
    expect(calls.find(c => c.method === 'POST')!.body).toEqual(expect.objectContaining({ patient_id: null, dose_presets: [preset('25')] }))
  })

  it('a patient change starts the dialog over: scope, doses and ticks', () => {
    const target = TIRZ_25 as unknown as React.ComponentProps<typeof MakeFavoriteDialog>['target']
    const props = { target, otherDoses: [], providerId: PROVIDER_ID, onClose: jest.fn(), onSaved: jest.fn() }
    const { rerender } = render(
      <MakeFavoriteDialog {...props} patient={{ patientId: PATIENT_ID, name: 'Alex Demo' }} patientDoses={[preset('30')]} />,
    )
    const dialog = () => screen.getByRole('dialog', { name: 'Make Tirzepatide 10mg/mL Injectable a favorite' })
    fireEvent.click(within(dialog()).getByRole('radio', { name: 'Only for Alex Demo' }))
    fireEvent.click(within(dialog()).getByRole('checkbox', { name: PINNED }))
    fireEvent.change(within(dialog()).getByLabelText('New dose amount'), { target: { value: '7.5' } })
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Add dose' }))

    rerender(<MakeFavoriteDialog {...props} patient={{ patientId: '33333333-3333-4333-8333-333333333333', name: 'Bo Other' }} patientDoses={[]} />)
    expect(within(dialog()).getByRole('radio', { name: 'The practice' })).toBeChecked()
    expect(within(dialog()).queryByRole('checkbox', { name: PINNED })).not.toBeInTheDocument()
    expect(within(dialog()).queryByRole('checkbox', { name: '7.5 units (0.75 mg) weekly' })).not.toBeInTheDocument()
    expect(within(dialog()).getAllByRole('checkbox').filter(c => (c as HTMLInputElement).checked).map(c => (c as HTMLInputElement).labels?.[0]?.textContent))
      .toEqual(['25 units (2.5 mg) weekly'])
  })
})
