/**
 * /protocols/new and the dashboard's "Protocol saved" notice: axe (WCAG
 * 2.0/2.1 A and AA, best practice), the form empty and with a medication
 * chosen.
 */

import { render, screen, fireEvent } from '@testing-library/react'
import { configureAxe } from 'jest-axe'
import { NewProtocolForm } from '../_components/new-protocol-form'
import { ProtocolSavedNotice } from '@/app/(clinic-app)/dashboard/_components/protocol-saved-notice'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams('protocolSaved=Starter'),
}))

const axe = configureAxe({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } })
const ids = async (el: Element) => (await axe(el)).violations.map(v => v.id)

beforeEach(() => {
  global.fetch = jest.fn(async (url: string) => {
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
    if (url.includes('level=ingredients')) return ok({ data: [{ ingredient_id: 'i', common_name: 'Semaglutide' }] })
    if (url.includes('level=formulations')) return ok({ data: [{ formulation_id: 'f', name: 'Semaglutide 5 mg/mL', formulation_ingredients: [{ ingredient_id: 'i' }] }] })
    return ok({ data: [{ pharmacy_formulation_id: 'pf', pharmacies: { pharmacy_id: 'ph', name: 'Strive' }, packages: [] }] })
  }) as unknown as typeof fetch
})

it('the empty form', async () => {
  const { container } = render(<NewProtocolForm createdBy={null} returnTo="/dashboard" />)
  expect(await ids(container)).toEqual([])
})

it('with a medication chosen and a second one added', async () => {
  const { container } = render(<NewProtocolForm createdBy={null} returnTo="/dashboard" />)
  fireEvent.change(screen.getByLabelText('Search medications'), { target: { value: 'sema' } })
  fireEvent.click(await screen.findByRole('button', { name: 'Semaglutide' }))
  fireEvent.change(await screen.findByLabelText('Formulation'), { target: { value: 'f' } })
  await screen.findByLabelText('Pharmacy')
  fireEvent.click(screen.getByRole('button', { name: 'Add another medication' }))
  expect(await ids(container)).toEqual([])
})

it('the Protocol saved notice', async () => {
  const { container } = render(<main><ProtocolSavedNotice /></main>)
  expect(await ids(container)).toEqual([])
})
