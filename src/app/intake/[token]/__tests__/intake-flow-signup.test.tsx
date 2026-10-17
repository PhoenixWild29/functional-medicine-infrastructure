/**
 * Patient Intake PR 3: the self-intake flow in sign-up mode, opened from a
 * clinic's standing sign-up link (/join/<token>).
 *
 *   - The same steps as self-intake (privacy notice, optional texts,
 *     license scan or typed details, address, allergies or NKDA,
 *     medications, review), with the clinic's name.
 *   - The first step also asks for the mobile number (required, checked).
 *   - A honeypot field a person never sees or reaches: hidden from view,
 *     from assistive tech and from the tab order.
 *   - Submits to /api/join/<token>; afterwards says the clinic has the
 *     details, never whether the person was already a patient.
 *   - No axe violations at each step.
 */

import { render, screen, fireEvent, act } from '@testing-library/react'
import { configureAxe } from 'jest-axe'

jest.mock('../_components/license-scanner', () => ({ LicenseScanner: () => <div /> }))
jest.mock('@/lib/browser/navigate', () => ({ navigateTo: jest.fn() }))

import { IntakeFlow } from '../_components/intake-flow'

const axe = configureAxe({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })
async function violations(): Promise<string[]> {
  const r = await axe(document.body)
  return r.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)
}

const TOKEN = 'B'.repeat(43)
const fetchMock = jest.fn()
beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) })
  global.fetch = fetchMock as unknown as typeof fetch
})

const click = async (name: string | RegExp) => { await act(async () => { fireEvent.click(screen.getByRole('button', { name })) }) }
const type = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
const renderFlow = () => render(<IntakeFlow token={TOKEN} clinicName="Test Clinic" variant="signup" />)

async function toReview() {
  fireEvent.click(screen.getByRole('checkbox', { name: /I have read the privacy notice/ }))
  type('Mobile number', '(737) 555-0142')
  await click('Continue')
  await click('Type my details')
  type('First name', 'Jane')
  type('Last name', 'Smith')
  type('Date of birth', '1985-04-15')
  fireEvent.click(screen.getByRole('radio', { name: 'Female' }))
  await click('Continue')
  type('Street address', '123 Main St')
  type('City', 'Austin')
  fireEvent.change(screen.getByLabelText('State'), { target: { value: 'TX' } })
  type('ZIP code', '78701')
  await click('Continue')
  fireEvent.click(screen.getByRole('radio', { name: 'No known drug allergies' }))
  await click('Continue')
}

it('names the clinic and asks for the mobile number on the first step', async () => {
  renderFlow()
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Sign up as a new patient')
  expect(screen.getByText(/Test Clinic/)).toBeInTheDocument()
  expect(screen.getByLabelText('Mobile number')).toHaveAttribute('type', 'tel')
  expect(await violations()).toEqual([])
})

it('the mobile number is required and must be a real number: tied to the field and announced', async () => {
  renderFlow()
  fireEvent.click(screen.getByRole('checkbox', { name: /I have read the privacy notice/ }))
  await click('Continue')
  const mobile = screen.getByLabelText('Mobile number')
  expect(mobile).toHaveAttribute('aria-invalid', 'true')
  expect(mobile).toHaveAccessibleDescription(/Enter your mobile number/)
  expect(screen.getByRole('alert')).toBeInTheDocument()
  type('Mobile number', '555-0142')
  await click('Continue')
  expect(screen.getByLabelText('Mobile number')).toHaveAttribute('aria-invalid', 'true')
  expect(await violations()).toEqual([])
})

it('the honeypot is hidden from people and assistive tech, and out of the tab order', () => {
  const { container } = renderFlow()
  const trap = container.querySelector('input[name="website"]') as HTMLInputElement
  expect(trap).not.toBeNull()
  expect(trap.tabIndex).toBe(-1)
  expect(trap.getAttribute('autocomplete')).toBe('off')
  expect(trap.closest('[aria-hidden="true"]')).not.toBeNull()
  expect(screen.queryByRole('textbox', { name: /website/i })).toBeNull()
})

it('runs the same steps, shows the mobile on review, and submits to /api/join/<token>', async () => {
  renderFlow()
  await toReview()
  expect(screen.getByRole('heading', { level: 2, name: 'Check and submit' })).toBeInTheDocument()
  expect(screen.getByText('(737) 555-0142')).toBeInTheDocument()
  expect(await violations()).toEqual([])
  await click('Submit')
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
  expect(url).toBe(`/api/join/${TOKEN}`)
  const body = JSON.parse(String(init.body))
  expect(body.contact).toEqual({ mobile: '(737) 555-0142' })
  expect(body.website).toBe('')
  expect(body.consent).toEqual({ privacyNotice: true, sms: false })
  expect(screen.getByRole('heading', { level: 2, name: 'Thank you' })).toBeInTheDocument()
  expect(screen.getByText(/Your details were sent to Test Clinic/)).toBeInTheDocument()
  expect(screen.queryByText(/already a patient/i)).toBeNull()
  expect(await violations()).toEqual([])
})

it('a link turned off meanwhile: the plain message', async () => {
  fetchMock.mockResolvedValue({ ok: false, status: 410, json: async () => ({ error: 'This link is no longer active. Contact your clinic.' }) })
  renderFlow()
  await toReview()
  await click('Submit')
  expect(screen.getByRole('alert')).toHaveTextContent('This link is no longer active. Contact your clinic.')
})

it('too many sign-ups (429): the server’s message', async () => {
  fetchMock.mockResolvedValue({ ok: false, status: 429, json: async () => ({ error: 'Too many sign-ups from this network. Please wait a few minutes and try again.' }) })
  renderFlow()
  await toReview()
  await click('Submit')
  expect(screen.getByRole('alert')).toHaveTextContent(/Too many sign-ups/)
})
