/**
 * Pharmacy search: the dosage form filter keeps every form from the
 * unfiltered results after one is chosen (BLK-02/08), and a saved Step 1
 * offers a restore banner on mount. Pinned before the forms snapshot moved
 * out of an effect (eslint-plugin-react-hooks 7.1: set-state-in-effect);
 * behaviour unchanged.
 */

import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PharmacySearchForm } from '../pharmacy-search-form'

jest.mock('../../_context/prescription-session', () => ({
  usePrescriptionSession: () => ({ patient: { state: 'TX' } }),
}))
jest.mock('../pharmacy-result-card', () => ({
  PharmacyResultCard: ({ result }: { result: { pharmacy_name: string; form: string } }) => <div data-testid="result">{result.pharmacy_name} {result.form}</div>,
}))

const SUGGESTION = { item_id: 'item-1', medication_name: 'Semaglutide', form: 'Injectable', dose: '5 mg/mL', dea_schedule: 0 }
const ALL = [
  { pharmacy_name: 'Strive', form: 'Injectable' },
  { pharmacy_name: 'Quick Rx', form: 'Tablet' },
]

const fetchMock = jest.fn(async (url: string) => {
  if (url.startsWith('/api/pharmacy-search/medications')) return { ok: true, json: async () => ({ suggestions: [SUGGESTION] }) }
  const form = new URL(url, 'https://x.test').searchParams.get('form')
  return { ok: true, json: async () => ({ results: form ? ALL.filter(r => r.form === form) : ALL }) }
})

beforeEach(() => {
  sessionStorage.clear()
  fetchMock.mockClear()
  global.fetch = fetchMock as unknown as typeof fetch
})

function renderForm() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(<QueryClientProvider client={client}><PharmacySearchForm /></QueryClientProvider>)
}

it('the form filter keeps both forms after one is chosen', async () => {
  renderForm()
  fireEvent.change(screen.getByLabelText(/Medication/), { target: { value: 'Sema' } })
  fireEvent.click(await screen.findByRole('option', { name: /Semaglutide/ }))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Search Pharmacies' })) })
  const select = await screen.findByLabelText(/Dosage form/i)
  expect(within(select).getAllByRole('option').map(o => o.textContent)).toEqual(expect.arrayContaining(['Injectable', 'Tablet']))

  await act(async () => { fireEvent.change(select, { target: { value: 'Tablet' } }) })
  expect(await screen.findAllByTestId('result')).toHaveLength(1)
  const after = screen.getByLabelText(/Dosage form/i)
  expect(within(after).getAllByRole('option').map(o => o.textContent)).toEqual(expect.arrayContaining(['Injectable', 'Tablet']))
})

it('a saved Step 1 with a selection offers to restore it', async () => {
  sessionStorage.setItem('wizard-step1', JSON.stringify({ medicationQuery: 'Semaglutide', selectedItem: SUGGESTION, patientState: 'TX', formFilter: '' }))
  renderForm()
  expect(await screen.findByRole('button', { name: 'Dismiss restore banner' })).toBeInTheDocument()
})

it('nothing saved: no banner', async () => {
  renderForm()
  await act(async () => {})
  expect(screen.queryByRole('button', { name: 'Dismiss restore banner' })).not.toBeInTheDocument()
})
