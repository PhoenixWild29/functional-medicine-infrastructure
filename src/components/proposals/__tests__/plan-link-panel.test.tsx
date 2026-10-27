/**
 * Patient protocol choice, PR 2: the plan link, after sending.
 *
 * The link never depends on texting: the provider can always copy it or
 * show a QR code, and each is recorded (link_copied, qr_shown). When
 * texting is off the panel says so in plain words. axe clean.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { configureAxe } from 'jest-axe'
import { PlanLinkPanel } from '../plan-link-panel'

const PROPOSAL = 'b0000000-0000-4000-8000-000000000001'
const URL_ = 'https://app.test/plan/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCd'
const fetchMock = jest.fn()
const writeText = jest.fn()

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
  global.fetch = fetchMock as unknown as typeof fetch
  writeText.mockReset().mockResolvedValue(undefined)
  Object.assign(navigator, { clipboard: { writeText } })
})

function panel(texting: 'sent' | 'texting_off' | 'not_opted_in' | 'no_phone' | 'failed' = 'texting_off') {
  return render(<PlanLinkPanel proposalId={PROPOSAL} url={URL_} expiresAt="2026-10-31T16:00:00.000Z" texting={texting} />)
}

const deliveries = () => fetchMock.mock.calls
  .filter(([u]) => String(u) === `/api/proposals/${PROPOSAL}/events`)
  .map(([, init]) => JSON.parse(String((init as RequestInit).body)).delivery)

it('shows the link, read only', () => {
  panel()
  expect(screen.getByLabelText('Plan link')).toHaveValue(URL_)
  expect(screen.getByLabelText('Plan link')).toHaveAttribute('readonly')
})

it('Copy link copies it and records link_copied', async () => {
  panel()
  fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(URL_))
  expect(await screen.findByText('Link copied.')).toBeInTheDocument()
  await waitFor(() => expect(deliveries()).toEqual(['copied']))
})

it('Show QR code draws it as one path and records qr_shown once', async () => {
  panel()
  fireEvent.click(screen.getByRole('button', { name: 'Show QR code' }))
  // The QR code loads on first show (next/dynamic), so wait for it.
  const qr = await screen.findByRole('img', { name: 'QR code for the plan link' })
  expect(qr.querySelectorAll('path')).toHaveLength(1)
  await waitFor(() => expect(deliveries()).toEqual(['qr']))
  fireEvent.click(screen.getByRole('button', { name: 'Hide QR code' }))
  fireEvent.click(screen.getByRole('button', { name: 'Show QR code' }))
  await waitFor(() => expect(deliveries()).toEqual(['qr']))
})

it.each([
  ['texting_off', 'Texting is not set up, copy the link or show the QR code'],
  ['not_opted_in', 'The patient has not agreed to texts, copy the link or show the QR code'],
  ['no_phone', 'The patient has no mobile number on file, copy the link or show the QR code'],
  ['failed', 'The text could not be sent, copy the link or show the QR code'],
  ['sent', 'The link was also texted to the patient.'],
] as const)('texting %s: %s', (texting, text) => {
  panel(texting)
  expect(screen.getByText(text)).toBeInTheDocument()
})

it('no em dash anywhere', () => {
  const { container } = panel()
  expect(container.textContent).not.toContain('—')
})

it('axe clean, with the QR code shown', async () => {
  const { container } = panel()
  fireEvent.click(screen.getByRole('button', { name: 'Show QR code' }))
  await screen.findByRole('img', { name: 'QR code for the plan link' })
  const axe = configureAxe({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } })
  expect((await axe(container)).violations.map(v => v.id)).toEqual([])
})
