/**
 * Patient protocol choice PR 3: the plan page in the browser (PlanFlow).
 *
 *   - Before the date of birth: "Your provider has a plan ready", the
 *     clinic logo and the date of birth form. No medication, no clinic name.
 *   - A wrong date says how many tries are left; the 5th locks the link.
 *   - Then one card per option: each item with its name, form and strength,
 *     the directions, quantity / days and price. Required items are locked
 *     on ("Included: your provider marked this as essential"); optional
 *     items are checkboxes, ticked by default. The total (subtotal +
 *     shipping, from the server) updates as items are unticked, and is an
 *     estimate until the provider approves.
 *   - Choose this plan -> confirm -> "Sent to your provider for final
 *     approval". The patient can change their choice until it is signed.
 *   - "None of these / I want to talk to my clinic" -> confirm -> declined.
 *   - jest-axe on every state; laid out for a phone (one column, full-width
 *     controls).
 */

import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { configureAxe } from 'jest-axe'
import { PlanFlow } from '../_components/plan-flow'

const axe = configureAxe({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } })
const violations = async (c: Element) => (await axe(c)).violations.map(v => v.id)

const TOKEN = 'A'.repeat(43)
const DOB = '1985-04-15'
const PLAN = {
  status: 'sent',
  chosen: null as null | { optionId: string; orderIds: string[] },
  options: [
    { optionId: 'o-a', label: 'Foundation plan', items: [
      { orderId: 'x1', medicationName: 'Semaglutide', form: 'Injectable', strength: '2.5 mg/mL', sig: 'Inject 0.25 mg once weekly', quantity: '1 mL vial', daysSupply: 28, priceCents: 20000, required: true },
      { orderId: 'x2', medicationName: 'Vitamin D3', form: 'Capsule', strength: '5000 IU', sig: 'Take 1 capsule daily', quantity: '30 capsules', daysSupply: 30, priceCents: 6000, required: false },
    ] },
    { optionId: 'o-b', label: 'Weight focus', items: [
      { orderId: 'x3', medicationName: 'Tirzepatide', form: 'Injectable', strength: '10 mg/mL', sig: 'Inject 10 units daily', quantity: '1 mL vial', daysSupply: 30, priceCents: 15000, required: true },
    ] },
  ],
  quote: { optionId: 'o-a', subtotalCents: 26000, shippingCents: 1500, totalCents: 27500 },
}

const fetchMock = jest.fn()
const reply = (status: number, body: unknown) => Promise.resolve({ ok: status < 300, status, json: async () => body })
const bodies = () => fetchMock.mock.calls.map(c => JSON.parse((c[1] as { body: string }).body) as Record<string, unknown>)

beforeEach(() => {
  fetchMock.mockReset().mockImplementation((_url: string, init: { body: string }) => {
    const b = JSON.parse(init.body) as { action: string; optionId?: string; orderIds?: string[] }
    if (b.action === 'verify') return reply(200, { plan: PLAN })
    if (b.action === 'quote') {
      const items = PLAN.options.find(o => o.optionId === b.optionId)!.items.filter(i => b.orderIds!.includes(i.orderId))
      const sub = items.reduce((s, i) => s + i.priceCents, 0)
      return reply(200, { quote: { optionId: b.optionId, subtotalCents: sub, shippingCents: 1500, totalCents: sub + 1500 } })
    }
    if (b.action === 'choose') return reply(200, { ok: true, rechosen: false, plan: { ...PLAN, status: 'chosen', chosen: { optionId: b.optionId, orderIds: b.orderIds } } })
    if (b.action === 'decline') return reply(200, { ok: true })
    return reply(400, { error: 'x' })
  })
  global.fetch = fetchMock as unknown as typeof fetch
})

const renderFlow = (logoUrl: string | null = 'https://cdn.example/logo.png') =>
  render(<PlanFlow token={TOKEN} logoUrl={logoUrl} />)

async function enterDob(dob = DOB) {
  fireEvent.change(screen.getByLabelText('Date of birth'), { target: { value: dob } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Continue' })) })
}

describe('before the date of birth', () => {
  it('only "Your provider has a plan ready", the logo and the form; axe clean', async () => {
    const { container } = renderFlow()
    expect(screen.getByRole('heading', { level: 1, name: 'Your provider has a plan ready' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: "Your clinic's logo" })).toHaveAttribute('src', 'https://cdn.example/logo.png')
    expect(screen.getByLabelText('Date of birth')).toHaveAttribute('type', 'date')
    expect(container.textContent).not.toMatch(/Semaglutide|Vitamin|Tirzepatide|Foundation/)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await violations(container)).toEqual([])
  })

  it('no logo: no image, still the heading', () => {
    renderFlow(null)
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Your provider has a plan ready')
  })

  it('a wrong date: an alert with the tries left; axe clean', async () => {
    fetchMock.mockImplementationOnce(() => reply(401, { error: "That date of birth doesn't match. 3 tries left.", remaining: 3 }))
    const { container } = renderFlow()
    await enterDob('1985-04-16')
    expect(screen.getByRole('alert')).toHaveTextContent("That date of birth doesn't match. 3 tries left.")
    expect(screen.getByLabelText('Date of birth')).toHaveAttribute('aria-invalid', 'true')
    expect(await violations(container)).toEqual([])
  })

  it('locked: the form goes, "This link is locked"', async () => {
    fetchMock.mockImplementationOnce(() => reply(423, { error: 'Too many incorrect dates of birth.', state: 'locked' }))
    renderFlow()
    await enterDob('1985-04-16')
    expect(screen.getByRole('heading', { level: 1, name: 'This link is locked' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Date of birth')).toBeNull()
  })
})

describe('the plan', () => {
  it('one card per option with its items; required locked on, optional ticked; the estimate; axe clean', async () => {
    const { container } = renderFlow()
    await enterDob()
    expect(bodies()[0]).toEqual({ action: 'verify', dob: DOB })
    expect(screen.getByRole('heading', { level: 1, name: 'Choose your plan' })).toBeInTheDocument()
    const a = screen.getByRole('region', { name: 'Foundation plan' })
    expect(within(a).getByText('Semaglutide')).toBeInTheDocument()
    expect(within(a).getByText(/Injectable, 2\.5 mg\/mL/)).toBeInTheDocument()
    expect(within(a).getByText('Inject 0.25 mg once weekly')).toBeInTheDocument()
    expect(within(a).getByText(/1 mL vial · 28 days/)).toBeInTheDocument()
    expect(within(a).getByText('$200.00')).toBeInTheDocument()
    const required = within(a).getByRole('checkbox', { name: /Semaglutide/ })
    expect(required).toBeChecked()
    expect(required).toBeDisabled()
    expect(within(a).getByText('Included: your provider marked this as essential')).toBeInTheDocument()
    const optional = within(a).getByRole('checkbox', { name: /Vitamin D3/ })
    expect(optional).toBeChecked()
    expect(optional).toBeEnabled()
    expect(within(a).getByTestId('plan-total-o-a')).toHaveTextContent('$275.00')
    expect(within(a).getByText('Estimate: final price confirmed when your provider approves.')).toBeInTheDocument()
    expect(await violations(container)).toEqual([])
  })

  it('unticking an optional item asks the server for the new total', async () => {
    renderFlow()
    await enterDob()
    const a = screen.getByRole('region', { name: 'Foundation plan' })
    await act(async () => { fireEvent.click(within(a).getByRole('checkbox', { name: /Vitamin D3/ })) })
    expect(bodies().at(-1)).toEqual({ action: 'quote', dob: DOB, optionId: 'o-a', orderIds: ['x1'] })
    expect(within(a).getByTestId('plan-total-o-a')).toHaveTextContent('$215.00')
  })

  it('laid out for a phone: one column, full-width actions', async () => {
    renderFlow()
    await enterDob()
    expect(screen.getByTestId('plan-page')).toHaveClass('max-w-md', 'w-full')
    for (const b of screen.getAllByRole('button', { name: 'Choose this plan' })) expect(b).toHaveClass('w-full')
  })
})

describe('choosing', () => {
  it('confirm step, then "Sent to your provider for final approval"; axe clean at each', async () => {
    const { container } = renderFlow()
    await enterDob()
    const a = screen.getByRole('region', { name: 'Foundation plan' })
    await act(async () => { fireEvent.click(within(a).getByRole('checkbox', { name: /Vitamin D3/ })) })
    fireEvent.click(within(a).getByRole('button', { name: 'Choose this plan' }))
    const confirm = screen.getByRole('region', { name: 'Confirm your choice' })
    expect(within(confirm).getByText('Foundation plan')).toBeInTheDocument()
    expect(within(confirm).getByText('Semaglutide')).toBeInTheDocument()
    expect(within(confirm).queryByText('Vitamin D3')).toBeNull()
    expect(within(confirm).getByText('$215.00')).toBeInTheDocument()
    expect(await violations(container)).toEqual([])
    await act(async () => { fireEvent.click(within(confirm).getByRole('button', { name: 'Confirm' })) })
    expect(bodies().at(-1)).toEqual({ action: 'choose', dob: DOB, optionId: 'o-a', orderIds: ['x1'] })
    expect(screen.getByRole('heading', { level: 1, name: 'Sent to your provider for final approval' })).toBeInTheDocument()
    expect(screen.getByText(/secure payment link/)).toBeInTheDocument()
    expect(await violations(container)).toEqual([])
  })

  it('Back from the confirm step changes nothing', async () => {
    renderFlow()
    await enterDob()
    fireEvent.click(within(screen.getByRole('region', { name: 'Weight focus' })).getByRole('button', { name: 'Choose this plan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Choose your plan' })).toBeInTheDocument()
    expect(bodies().some(b => b['action'] === 'choose')).toBe(false)
  })

  it('already chosen: says so, and the patient can change it until it is approved', async () => {
    fetchMock.mockImplementationOnce(() => reply(200, { plan: { ...PLAN, status: 'chosen', chosen: { optionId: 'o-a', orderIds: ['x1'] } } }))
    renderFlow()
    await enterDob()
    expect(screen.getByText('You chose Foundation plan. You can change your choice until your provider approves it.')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Foundation plan' })).getByRole('checkbox', { name: /Vitamin D3/ })).not.toBeChecked()
  })

  it('a refusal from the server is shown', async () => {
    renderFlow()
    await enterDob()
    fetchMock.mockImplementationOnce(() => reply(400, { error: 'Items your provider marked as essential must stay in the plan.', code: 'required' }))
    fireEvent.click(within(screen.getByRole('region', { name: 'Foundation plan' })).getByRole('button', { name: 'Choose this plan' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Confirm' })) })
    expect(screen.getByRole('alert')).toHaveTextContent('Items your provider marked as essential must stay in the plan.')
  })
})

describe('declining', () => {
  it('"None of these / I want to talk to my clinic" -> confirm -> the clinic is told; axe clean', async () => {
    const { container } = renderFlow()
    await enterDob()
    fireEvent.click(screen.getByRole('button', { name: 'None of these / I want to talk to my clinic' }))
    expect(screen.getByRole('region', { name: 'Talk to your clinic' })).toBeInTheDocument()
    expect(await violations(container)).toEqual([])
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Yes, tell my clinic' })) })
    expect(bodies().at(-1)).toEqual({ action: 'decline', dob: DOB })
    expect(screen.getByRole('heading', { level: 1, name: 'Your clinic has been told' })).toBeInTheDocument()
    expect(await violations(container)).toEqual([])
  })
})
