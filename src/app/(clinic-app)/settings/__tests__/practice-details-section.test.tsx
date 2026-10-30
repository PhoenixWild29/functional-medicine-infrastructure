/**
 * Settings > Clinic Profile shows the practice details the onboarding
 * wizard collects: legal name, DBA, address lines 1 and 2, city, state,
 * ZIP, phone, practice NPI (Type 2, optional) and tax ID last 4. Same
 * labels as the wizard step, saved with the same API
 * (PUT /api/onboarding/practice) and validation. The clinic admin edits;
 * providers and medical assistants see them read-only. axe clean.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { configureAxe } from 'jest-axe'
import { PracticeDetailsForm, type PracticeDetails } from '../_components/practice-details-form'

const refresh = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: jest.fn() }) }))

const DETAILS: PracticeDetails = {
  legalName: 'Sunrise Functional Medicine PLLC', dbaName: 'Sunrise Clinic', addressLine1: '100 Main St', addressLine2: 'Suite 2',
  city: 'Austin', state: 'TX', postalCode: '78701', phone: '5125550100', practiceNpi: '', taxIdLast4: '1234',
}

const fetchMock = jest.fn()
beforeEach(() => {
  refresh.mockClear()
  fetchMock.mockReset().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) })
  global.fetch = fetchMock as unknown as typeof fetch
})

const LABELS = ['Legal name', 'DBA (optional)', 'Address line 1', 'Address line 2 (optional)', 'City', 'State', 'ZIP code', 'Phone', 'Practice NPI (Type 2, optional)', 'Tax ID, last 4 digits (optional)']

it('shows every wizard field with its value', () => {
  render(<PracticeDetailsForm details={DETAILS} canEdit />)
  for (const label of LABELS) expect(screen.getByLabelText(new RegExp(`^${label.replace(/[()]/g, '\\$&')}`))).toBeInTheDocument()
  expect(screen.getByLabelText(/^Legal name/)).toHaveValue('Sunrise Functional Medicine PLLC')
  expect(screen.getByLabelText(/^Address line 2/)).toHaveValue('Suite 2')
  expect(screen.getByLabelText(/^State/)).toHaveValue('TX')
})

it('the clinic admin saves with the wizard\'s API and body (no shipping choice)', async () => {
  render(<PracticeDetailsForm details={DETAILS} canEdit />)
  fireEvent.change(screen.getByLabelText(/^City/), { target: { value: 'Round Rock' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save practice details' }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalled())
  const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; body: string }]
  expect(url).toBe('/api/onboarding/practice')
  expect(init.method).toBe('PUT')
  expect(JSON.parse(init.body)).toEqual({ ...DETAILS, city: 'Round Rock' })
  expect(await screen.findByRole('status')).toHaveTextContent('Practice details saved.')
  expect(refresh).toHaveBeenCalled()
})

it('field errors from the API show against their fields', async () => {
  fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'Check the highlighted fields.', errors: { postalCode: 'Enter a 5-digit ZIP code (or ZIP+4).' } }) })
  render(<PracticeDetailsForm details={DETAILS} canEdit />)
  fireEvent.click(screen.getByRole('button', { name: 'Save practice details' }))
  expect(await screen.findByText('Enter a 5-digit ZIP code (or ZIP+4).')).toBeInTheDocument()
  expect(screen.getByLabelText(/^ZIP code/)).toHaveAttribute('aria-invalid', 'true')
})

it('providers and medical assistants see them read-only, with no save', () => {
  render(<PracticeDetailsForm details={DETAILS} canEdit={false} />)
  expect(screen.getByLabelText(/^Legal name/)).toBeDisabled()
  expect(screen.queryByRole('button', { name: 'Save practice details' })).toBeNull()
  expect(screen.getByText('Only the clinic admin can change these.')).toBeInTheDocument()
})

it.each([true, false])('axe clean (canEdit %s)', async canEdit => {
  const { container } = render(<main><PracticeDetailsForm details={DETAILS} canEdit={canEdit} /></main>)
  const axe = configureAxe({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } })
  expect((await axe(container)).violations.map(v => v.id)).toEqual([])
})

it('Settings puts it in the Clinic Profile section, with the clinic\'s practice columns', () => {
  const page = readFileSync(join(process.cwd(), 'src', 'app', '(clinic-app)', 'settings', 'page.tsx'), 'utf8')
  const profile = page.slice(page.indexOf('id="clinic-profile"'), page.indexOf('id="sign-in-security"'))
  expect(profile).toMatch(/<PracticeDetailsForm/)
  expect(page).toMatch(/legal_name, dba_name, address_line1, address_line2, city, state, postal_code, contact_phone, practice_npi, tax_id_last4/)
})
