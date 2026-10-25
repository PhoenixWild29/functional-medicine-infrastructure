/**
 * Patient protocol choice, PR 2: a proposed order in the dashboard drawer.
 *
 * It says where the plan is ("Awaiting patient choice"), which option the
 * line is in and whether it is required. The provider or a clinic admin
 * can send a new link (the old one stops working) or cancel the plan (its
 * lines are cancelled and the link stops working). A medical assistant
 * sees the state only. axe clean.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { configureAxe } from 'jest-axe'
import { ProposalPanel } from '../_components/proposal-panel'
import type { DashboardProposal } from '@/lib/proposals/dashboard'

const PROPOSAL = 'b0000000-0000-4000-8000-000000000001'
const fetchMock = jest.fn()
const changed = jest.fn()

const proposal = (over: Partial<DashboardProposal> = {}): DashboardProposal => ({
  proposalId: PROPOSAL, status: 'sent', optionLabel: 'Foundation plan', required: true, linkActive: true,
  expiresAt: '2026-10-31T16:00:00.000Z', ...over,
})

beforeEach(() => {
  changed.mockReset()
  fetchMock.mockReset().mockImplementation(async (url: string) => {
    if (url.endsWith('/send')) return { ok: true, status: 200, json: async () => ({ proposalId: PROPOSAL, resent: true, link: { url: 'https://app.test/plan/new', expiresAt: '2026-10-31T17:00:00.000Z', texting: 'texting_off' } }) }
    if (url.endsWith('/cancel')) return { ok: true, status: 200, json: async () => ({ cancelledOrderIds: ['o1'] }) }
    return { ok: true, status: 200, json: async () => ({}) }
  })
  global.fetch = fetchMock as unknown as typeof fetch
})

it.each([
  [proposal(), 'Awaiting patient choice'],
  [proposal({ status: 'draft', linkActive: false }), 'Prepared for the patient to choose. Not sent yet.'],
  [proposal({ linkActive: false }), 'Awaiting patient choice. The link was turned off when a line was edited; send a new link.'],
  [proposal({ status: 'chosen' }), 'The patient has chosen. Signing comes next.'],
])('states: %#', (p, text) => {
  render(<ProposalPanel proposal={p} canSend onChanged={changed} />)
  expect(screen.getByRole('region', { name: 'Patient choice' })).toHaveTextContent(text)
})

it('names the option and whether the line is required', () => {
  const { rerender } = render(<ProposalPanel proposal={proposal()} canSend onChanged={changed} />)
  expect(screen.getByText('Foundation plan, required')).toBeInTheDocument()
  rerender(<ProposalPanel proposal={proposal({ required: false })} canSend onChanged={changed} />)
  expect(screen.getByText('Foundation plan, optional (the patient can untick it)')).toBeInTheDocument()
})

it('a medical assistant sees the state, without send or cancel', () => {
  render(<ProposalPanel proposal={proposal()} canSend={false} onChanged={changed} />)
  expect(screen.queryByRole('button')).toBeNull()
})

it('Send a new link: the new link with Copy and QR; the old one stops working', async () => {
  render(<ProposalPanel proposal={proposal()} canSend onChanged={changed} />)
  fireEvent.click(screen.getByRole('button', { name: 'Send a new link' }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/proposals/${PROPOSAL}/send`, expect.objectContaining({ method: 'POST' })))
  expect(await screen.findByLabelText('Plan link')).toHaveValue('https://app.test/plan/new')
  expect(screen.getByText('A new link was made. The previous link no longer works.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument()
  expect(changed).toHaveBeenCalled()
})

it('a prepared plan: Send the plan link', async () => {
  render(<ProposalPanel proposal={proposal({ status: 'draft', linkActive: false })} canSend onChanged={changed} />)
  fireEvent.click(screen.getByRole('button', { name: 'Send the plan link' }))
  expect(await screen.findByLabelText('Plan link')).toBeInTheDocument()
})

it('a refusal (a check failed) is shown, with each line', async () => {
  fetchMock.mockResolvedValueOnce({ ok: false, status: 422, json: async () => ({ error: '2 problems.', problems: [{ message: 'A is priced below cost.' }, { message: 'B needs a diagnosis.' }] }) })
  render(<ProposalPanel proposal={proposal()} canSend onChanged={changed} />)
  fireEvent.click(screen.getByRole('button', { name: 'Send a new link' }))
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('A is priced below cost.')
  expect(alert).toHaveTextContent('B needs a diagnosis.')
})

it('Cancel the plan asks first, then cancels', async () => {
  render(<ProposalPanel proposal={proposal()} canSend onChanged={changed} />)
  fireEvent.click(screen.getByRole('button', { name: 'Cancel the plan' }))
  expect(screen.getByText("Cancel this plan? Its prescriptions are cancelled and the patient's link stops working.")).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Keep the plan' }))
  expect(fetchMock).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel the plan' }))
  fireEvent.click(screen.getByRole('button', { name: 'Yes, cancel the plan' }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/proposals/${PROPOSAL}/cancel`, expect.objectContaining({ method: 'POST' })))
  await waitFor(() => expect(changed).toHaveBeenCalled())
})

it('no em dash, and axe clean', async () => {
  const { container } = render(<ProposalPanel proposal={proposal()} canSend onChanged={changed} />)
  expect(container.textContent).not.toContain('—')
  const axe = configureAxe({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } })
  expect((await axe(container)).violations.map(v => v.id)).toEqual([])
})
