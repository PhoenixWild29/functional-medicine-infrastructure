/**
 * /plan/[token] (server page), patient protocol choice PR 3. Every closed
 * state is a plain page; an open link renders PlanFlow with the logo only.
 * The page metadata names no clinic; no state shows a medication. axe on
 * every state.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import { configureAxe } from 'jest-axe'

const resolvePlan = jest.fn()
jest.mock('@/lib/proposals/plan', () => ({ resolvePlan: (...a: unknown[]) => resolvePlan(...a) }))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({}) }))
jest.mock('../_components/plan-flow', () => ({ PlanFlow: ({ logoUrl }: { logoUrl: string | null }) => <main><h1>Your provider has a plan ready</h1><p data-testid="flow-logo">{logoUrl}</p></main> }))

import PlanPage, { metadata } from '../page'

const axe = configureAxe({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } })
const TOKEN = 'A'.repeat(43)
const renderPage = async () => render(await PlanPage({ params: Promise.resolve({ token: TOKEN }) }))

it('open: the flow, with the logo only', async () => {
  resolvePlan.mockResolvedValue({ state: 'open', proposal: { proposal_id: 'p' }, logoUrl: 'https://cdn.example/logo.png' })
  await renderPage()
  expect(screen.getByTestId('flow-logo')).toHaveTextContent('https://cdn.example/logo.png')
})

it.each([
  ['not_found', 'This link is not valid'],
  ['expired', 'This link has expired'],
  ['locked', 'This link is locked'],
  ['signed', 'Your provider has approved your plan'],
  ['closed', 'This plan is no longer open'],
  ['unavailable', 'This page could not be opened right now'],
])('%s: "%s", no medication; axe clean', async (state, title) => {
  resolvePlan.mockResolvedValue({ state })
  const { container } = await renderPage()
  expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument()
  expect(container.textContent).not.toMatch(/mg|Injectable|Capsule/)
  expect((await axe(container)).violations.map(v => v.id)).toEqual([])
})

it('metadata: a generic title, not indexed, no clinic name', () => {
  expect(metadata).toEqual(expect.objectContaining({ title: 'Your treatment plan', robots: { index: false, follow: false } }))
  const src = readFileSync(join(process.cwd(), 'src', 'app', 'plan', '[token]', 'page.tsx'), 'utf8')
  expect(src).not.toMatch(/generateMetadata|clinic_name|clinicName/)
})
