/**
 * Patient Intake PR 3: /join/[token], the clinic's public sign-up page
 * (the standing link, or its QR code in the waiting room).
 *
 * An open link runs the self-intake flow in sign-up mode with the clinic's
 * name. A link that is turned off, revoked or unknown shows one plain
 * message, "This link is no longer active. Contact your clinic." (an
 * unknown token is not told apart). A database error is not shown as
 * inactive. Not indexed; one h1; no axe violations.
 */

import { render, screen } from '@testing-library/react'
import { configureAxe } from 'jest-axe'

const resolveMock = jest.fn()
jest.mock('@/lib/intake/signup-links', () => ({ resolveSignupLink: (...a: unknown[]) => resolveMock(...a) }))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({}) }))
const flowProps = jest.fn()
jest.mock('@/app/intake/[token]/_components/intake-flow', () => ({
  IntakeFlow: (props: { clinicName: string; variant?: string; token: string }) => {
    flowProps(props)
    return <main><h1>Sign up as a new patient</h1><p>{props.clinicName}</p></main>
  },
}))

// Self sign-up: the link's clinic must be approved (lib/onboarding/
// clinic-approval, the read behind the approval guard). Approved unless a
// test says otherwise. (Updated: the page never read the clinic before.)
const approvalMock = jest.fn()
jest.mock('@/lib/onboarding/clinic-approval', () => ({
  ...jest.requireActual('@/lib/onboarding/clinic-approval'),
  clinicApproval: (...a: unknown[]) => approvalMock(...a),
}))

import JoinPage, { metadata } from '../page'

const axe = configureAxe({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }, rules: { region: { enabled: true } } })
const TOKEN = 'A'.repeat(43)

async function renderPage() {
  render(await JoinPage({ params: Promise.resolve({ token: TOKEN }) }))
}

beforeEach(() => {
  resolveMock.mockReset(); flowProps.mockReset()
  approvalMock.mockReset().mockResolvedValue({ state: 'approved' })
})

it('has a page title and is not indexed', () => {
  expect(metadata.title).toBe('Sign up as a new patient')
  expect(metadata.robots).toEqual({ index: false, follow: false })
})

it('open: the sign-up flow with the clinic name and the token', async () => {
  resolveMock.mockResolvedValue({ state: 'open', linkId: 'l', clinicId: 'c', clinicName: 'Test Clinic' })
  await renderPage()
  expect(screen.getByText('Test Clinic')).toBeInTheDocument()
  expect(flowProps).toHaveBeenCalledWith(expect.objectContaining({ token: TOKEN, clinicName: 'Test Clinic', variant: 'signup' }))
})

it.each(['inactive', 'invalid'])('%s: "This link is no longer active. Contact your clinic.", one h1, no axe violations', async state => {
  resolveMock.mockResolvedValue({ state })
  await renderPage()
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  expect(screen.getByRole('main')).toHaveTextContent('This link is no longer active. Contact your clinic.')
  expect(flowProps).not.toHaveBeenCalled()
  expect((await axe(document.body)).violations).toEqual([])
})

// Self sign-up: a clinic that is not approved (or is switched off) gets
// the inactive-link message instead of the form, checked on the server
// before anything renders. The 410 on submit stays as the backstop.
it('an open link whose clinic is not approved: "This link is no longer active. Contact your clinic." instead of the form', async () => {
  resolveMock.mockResolvedValue({ state: 'open', linkId: 'l', clinicId: 'c-pending', clinicName: 'Test Clinic' })
  approvalMock.mockResolvedValue({ state: 'pending', onboardingStatus: 'submitted' })
  await renderPage()
  expect(approvalMock).toHaveBeenCalledWith(expect.anything(), 'c-pending')
  expect(flowProps).not.toHaveBeenCalled()
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  expect(screen.getByRole('main')).toHaveTextContent('This link is no longer active. Contact your clinic.')
  expect(screen.queryByText('Test Clinic')).toBeNull()
  expect((await axe(document.body)).violations).toEqual([])
})

it('an open link whose clinic cannot be checked: try again later, no form', async () => {
  resolveMock.mockResolvedValue({ state: 'open', linkId: 'l', clinicId: 'c', clinicName: 'Test Clinic' })
  approvalMock.mockResolvedValue({ state: 'unavailable' })
  await renderPage()
  expect(flowProps).not.toHaveBeenCalled()
  expect(screen.getByRole('main')).toHaveTextContent(/could not be opened right now/)
})

it('unavailable: try again later, not "no longer active"', async () => {
  resolveMock.mockResolvedValue({ state: 'unavailable' })
  await renderPage()
  expect(screen.getByRole('main')).toHaveTextContent(/could not be opened right now/)
  expect(screen.getByRole('main')).not.toHaveTextContent(/no longer active/)
  expect((await axe(document.body)).violations).toEqual([])
})
