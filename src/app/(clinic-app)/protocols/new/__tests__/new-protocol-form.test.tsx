/**
 * Lauren, 18 Oct: "+ New Protocol" only opened New Prescription. A
 * protocol is a template: it must not need a patient. /protocols/new
 * creates one directly, with the same fields and the same
 * POST /api/protocols as the Protocols panel's "+ New":
 *   name, and per medication: formulation, pharmacy, dose amount and
 *   unit, frequency, sig, default quantity and refills.
 * No patient or provider step. On save: "Protocol saved", back to where
 * the user came from (?from=, the dashboard by default).
 */

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { NewProtocolForm } from '../_components/new-protocol-form'

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush, replace: jest.fn(), refresh: jest.fn() }) }))

const fetchMock = jest.fn()
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })

beforeEach(() => {
  mockPush.mockReset()
  fetchMock.mockReset().mockImplementation(async (url: string, init?: { method?: string }) => {
    if (url === '/api/protocols' && init?.method === 'POST') return { ok: true, status: 201, json: async () => ({ protocol_id: 'proto-1' }) }
    if (url.startsWith('/api/formulations?level=ingredients')) {
      return ok({ level: 'ingredients', data: [{ ingredient_id: 'ing-sema', common_name: 'Semaglutide' }] })
    }
    if (url === '/api/formulations?level=formulations') {
      return ok({ level: 'formulations', data: [
        { formulation_id: 'f-sema', name: 'Semaglutide 5 mg/mL Injectable', concentration_unit: 'mg/mL',
          routes_of_administration: { name: 'Subcutaneous', sig_prefix: 'Inject' },
          formulation_ingredients: [{ ingredient_id: 'ing-sema' }] },
        { formulation_id: 'f-other', name: 'Other Cream', routes_of_administration: null, formulation_ingredients: [{ ingredient_id: 'ing-other' }] },
      ] })
    }
    if (url.startsWith('/api/formulations?level=pharmacy_options&formulation_id=f-sema')) {
      return ok({ level: 'pharmacy_options', data: [
        { pharmacy_formulation_id: 'pf-1', wholesale_price: 95, pharmacies: { pharmacy_id: 'ph-strive', name: 'Strive Pharmacy' },
          packages: [{ id: 'pk-1', label: '2.5 mL vial', qty: 2.5, unit: 'mL', wholesalePrice: 95, isDefault: true }] },
      ] })
    }
    return { ok: false, status: 404, json: async () => ({}) }
  })
  global.fetch = fetchMock as unknown as typeof fetch
})

async function fillOneMedication() {
  fireEvent.change(screen.getByLabelText('Protocol name'), { target: { value: 'Weight loss starter' } })
  fireEvent.change(screen.getByLabelText('Search medications'), { target: { value: 'sema' } })
  fireEvent.click(await screen.findByRole('button', { name: 'Semaglutide' }))
  fireEvent.change(await screen.findByLabelText('Formulation'), { target: { value: 'f-sema' } })
  // Only the chosen ingredient's formulations are offered.
  expect(within(screen.getByLabelText('Formulation')).queryByText('Other Cream')).toBeNull()
  fireEvent.change(await screen.findByLabelText('Pharmacy'), { target: { value: 'ph-strive' } })
  fireEvent.change(screen.getByLabelText('Dose'), { target: { value: '0.25' } })
  fireEvent.change(screen.getByLabelText('Dose unit'), { target: { value: 'mg' } })
  fireEvent.change(screen.getByLabelText('Frequency'), { target: { value: 'QW' } })
  fireEvent.change(screen.getByLabelText('Default quantity'), { target: { value: '2.5 mL vial' } })
  fireEvent.change(screen.getByLabelText('Refills'), { target: { value: '2' } })
}

it('asks for no patient or provider', () => {
  render(<NewProtocolForm createdBy={null} returnTo="/dashboard" />)
  expect(screen.queryByText(/select (a )?patient/i)).toBeNull()
  expect(screen.queryByText(/provider/i)).toBeNull()
  expect(screen.getByRole('heading', { level: 1, name: 'New protocol' })).toBeInTheDocument()
})

it('builds the sig from the route, dose and frequency until the user edits it', async () => {
  render(<NewProtocolForm createdBy={null} returnTo="/dashboard" />)
  await fillOneMedication()
  expect(screen.getByLabelText('Directions (sig)')).toHaveValue('Inject 0.25 mg once weekly')
})

it('saves with the same POST /api/protocols body as the Protocols panel, then says so and goes back', async () => {
  render(<NewProtocolForm createdBy="prov-chen" returnTo="/dashboard" />)
  await fillOneMedication()
  fireEvent.click(screen.getByRole('button', { name: 'Save protocol' }))
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/dashboard?protocolSaved=Weight%20loss%20starter'))
  const post = fetchMock.mock.calls.find(c => c[0] === '/api/protocols')!
  expect(JSON.parse((post[1] as { body: string }).body)).toEqual({
    name: 'Weight loss starter',
    created_by: 'prov-chen',
    items: [{
      formulation_id: 'f-sema', pharmacy_id: 'ph-strive', dose_amount: '0.25', dose_unit: 'mg',
      frequency_code: 'QW', sig_text: 'Inject 0.25 mg once weekly', default_quantity: '2.5 mL vial', default_refills: 2,
    }],
  })
  expect(screen.getByRole('status')).toHaveTextContent('Protocol saved')
})

it('needs a name and at least one complete medication', async () => {
  render(<NewProtocolForm createdBy={null} returnTo="/dashboard" />)
  fireEvent.click(screen.getByRole('button', { name: 'Save protocol' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Give the protocol a name and add at least one medication with its pharmacy.')
  expect(fetchMock.mock.calls.some(c => c[0] === '/api/protocols')).toBe(false)
})

it('a server error is shown and nothing navigates', async () => {
  render(<NewProtocolForm createdBy={null} returnTo="/dashboard" />)
  await fillOneMedication()
  fetchMock.mockImplementationOnce(async () => ({ ok: false, status: 400, json: async () => ({ error: 'name must be at most 120 characters' }) }))
  fireEvent.click(screen.getByRole('button', { name: 'Save protocol' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('name must be at most 120 characters')
  expect(mockPush).not.toHaveBeenCalled()
})

it('Cancel goes back to where the user came from', () => {
  render(<NewProtocolForm createdBy={null} returnTo="/dashboard" />)
  expect(screen.getByRole('link', { name: 'Cancel' })).toHaveAttribute('href', '/dashboard')
})

// E2E #242: the catalog links a single-ingredient formulation to its
// ingredient through its salt form (formulations.salt_form_id), with no
// formulation_ingredients row. Such a formulation must be offered, as the
// prescription builder offers it (ingredient → salt forms → formulations).
// A combination product found through formulation_ingredients still is.
it('offers formulations linked through the ingredient\'s salt form, and combinations', async () => {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/formulations?level=ingredients')) return ok({ data: [{ ingredient_id: 'ing-test', common_name: 'Test Compound E2E' }] })
    if (url === '/api/formulations?level=salt_forms&ingredient_id=ing-test') return ok({ data: [{ salt_form_id: 'salt-1', salt_name: 'HCl' }] })
    if (url === '/api/formulations?level=formulations&salt_form_id=salt-1') {
      return ok({ data: [{ formulation_id: 'f-single', name: 'Test Compound E2E Injectable 10 mg/mL', formulation_ingredients: [] }] })
    }
    if (url === '/api/formulations?level=formulations') {
      return ok({ data: [
        { formulation_id: 'f-single', name: 'Test Compound E2E Injectable 10 mg/mL', formulation_ingredients: [] },
        { formulation_id: 'f-combo', name: 'Combo with Test Compound', formulation_ingredients: [{ ingredient_id: 'ing-test' }, { ingredient_id: 'ing-b' }] },
        { formulation_id: 'f-other', name: 'Unrelated', formulation_ingredients: [{ ingredient_id: 'ing-x' }] },
      ] })
    }
    return { ok: false, status: 404, json: async () => ({}) }
  })
  render(<NewProtocolForm createdBy={null} returnTo="/dashboard" />)
  fireEvent.change(screen.getByLabelText('Search medications'), { target: { value: 'test' } })
  fireEvent.click(await screen.findByRole('button', { name: 'Test Compound E2E' }))
  const select = await screen.findByLabelText('Formulation')
  const options = within(select).getAllByRole('option').map(o => o.textContent)
  expect(options).toEqual(['Choose a formulation', 'Test Compound E2E Injectable 10 mg/mL', 'Combo with Test Compound'])
})
