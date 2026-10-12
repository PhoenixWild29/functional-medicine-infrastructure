/**
 * Patient Intake PR 2: /intake/[token], the server page.
 *
 * The token is checked against its stored hash. An open link renders the
 * flow with the clinic's name and nothing else about the patient (a link
 * that is forwarded shows no PHI). Expired, used and unknown links say so
 * plainly; a database error is not shown as "expired". Every state has
 * one h1, a main landmark, and no axe violations.
 */

import { render, screen } from '@testing-library/react'
import { configureAxe } from 'jest-axe'

const resolveMock = jest.fn()
jest.mock('@/lib/intake/links', () => ({ resolveIntakeLink: (...a: unknown[]) => resolveMock(...a) }))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({}) }))
jest.mock('../_components/intake-flow', () => ({
  IntakeFlow: ({ clinicName }: { clinicName: string }) => <main><h1>Complete your details</h1><p>{clinicName}</p></main>,
}))

import IntakePage, { metadata } from '../page'

const axe = configureAxe({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }, rules: { region: { enabled: true } } })
const TOKEN = 'A'.repeat(43)

async function renderPage() {
  render(await IntakePage({ params: Promise.resolve({ token: TOKEN }) }))
}

it('has a page title and is not indexed', () => {
  expect(metadata.title).toBe('Complete your details')
  expect(metadata.robots).toEqual({ index: false, follow: false })
})

it('open: renders the flow with the clinic name', async () => {
  resolveMock.mockResolvedValue({ state: 'open', link: { linkId: 'l', clinicId: 'c', patientId: 'p', expiresAt: 'x' }, clinicName: 'Test Clinic' })
  await renderPage()
  expect(screen.getByText('Test Clinic')).toBeInTheDocument()
})

it.each([
  ['expired', /This link has expired/],
  ['used', /already been used/],
  ['invalid', /This link is not valid/],
  ['unavailable', /could not be opened right now/],
])('%s: says so, with one h1 and no axe violations', async (state, text) => {
  resolveMock.mockResolvedValue({ state })
  await renderPage()
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  expect(screen.getByRole('main')).toHaveTextContent(text)
  expect((await axe(document.body)).violations).toEqual([])
})
