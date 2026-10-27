/**
 * Error boundaries and not-found pages, per audience (B-2026-10-25-05).
 *
 * Each boundary shows plain copy with a way out, reports the error to
 * Sentry, logs it by name only, and never renders the error's message:
 * the test error carries a raw database message that must not appear.
 * Patient pages show no reference, no ids and no dashboard link. Staff
 * pages show the opaque digest so a report can be matched to the log.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import { configureAxe } from 'jest-axe'

const captureException = jest.fn()
jest.mock('@sentry/nextjs', () => ({ captureException: (...a: unknown[]) => captureException(...a) }))

let user: { app_metadata: Record<string, unknown> } | null = null
let authFails = false
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => {
    if (authFails) throw new Error('cookies unavailable')
    return { auth: { getUser: async () => ({ data: { user } }) } }
  },
}))

import ClinicAppError from '@/app/(clinic-app)/error'
import OpsDashboardError from '@/app/(ops-dashboard)/error'
import PharmacyPortalError from '@/app/pharmacy/error'
import AppError from '@/app/error'
import PatientCheckoutGroupError from '@/app/(patient-checkout)/error'
import CheckoutError from '@/app/checkout/error'
import IntakeError from '@/app/intake/error'
import PlanError from '@/app/plan/error'
import JoinError from '@/app/join/error'
import GlobalError from '@/app/global-error'
import ClinicAppNotFound from '@/app/(clinic-app)/not-found'
import OpsDashboardNotFound from '@/app/(ops-dashboard)/not-found'
import PharmacyPortalNotFound from '@/app/pharmacy/not-found'
import NotFound from '@/app/not-found'

const RAW = 'relation "orders" does not exist (PGRST205) for patient 4a5b'
const boom = () => Object.assign(new Error(RAW), { digest: 'd1g3st42' })
const axe = configureAxe({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } })

let consoleError: jest.SpyInstance
beforeEach(() => {
  captureException.mockClear()
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => consoleError.mockRestore())

const STAFF = [
  ['clinic app', ClinicAppError, 'error-screen-clinic', 'Back to dashboard', '/dashboard'],
  ['ops dashboard', OpsDashboardError, 'error-screen-ops', 'Back to ops dashboard', '/ops'],
  ['pharmacy portal', PharmacyPortalError, 'error-screen-pharmacy', 'Back to pharmacy portal', '/pharmacy'],
  ['sign-in and other public pages', AppError, 'error-screen-public', 'Go to sign in', '/login'],
] as const

describe.each(STAFF)('%s error boundary', (_name, Boundary, testId, homeLabel, homeHref) => {
  it('friendly copy, Try again, the way home and the reference; never the raw message', async () => {
    const reset = jest.fn()
    const { container } = render(<Boundary error={boom()} reset={reset} />)
    expect(screen.getByTestId(testId)).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Something went wrong' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(reset).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('link', { name: homeLabel })).toHaveAttribute('href', homeHref)
    expect(screen.getByText('Reference: d1g3st42')).toBeInTheDocument()
    expect(container.textContent).not.toContain('relation')
    expect(container.textContent).not.toContain('PGRST')
    expect(container.textContent).not.toMatch(/—/)
    expect((await axe(container)).violations.map(v => v.id)).toEqual([])
  })

  it('reports to Sentry and logs by name only', () => {
    const error = boom()
    render(<Boundary error={error} reset={() => {}} />)
    expect(captureException).toHaveBeenCalledWith(error, expect.objectContaining({ tags: expect.any(Object) }))
    const logged = consoleError.mock.calls.flat().join(' ')
    expect(logged).toContain('error=Error')
    expect(logged).toContain('digest=d1g3st42')
    expect(logged).not.toContain('relation')
  })
})

const PATIENT = [
  ['(patient-checkout)', PatientCheckoutGroupError],
  ['checkout', CheckoutError],
  ['intake', IntakeError],
  ['plan', PlanError],
  ['join', JoinError],
] as const

describe.each(PATIENT)('patient error boundary: %s', (_name, Boundary) => {
  it('tells the patient to try again or contact the clinic; no reference, ids, links or raw text', async () => {
    const reset = jest.fn()
    const { container } = render(<Boundary error={boom()} reset={reset} />)
    expect(screen.getByTestId('error-screen-patient')).toBeInTheDocument()
    expect(screen.getByText(/contact your clinic/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(reset).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('link')).toBeNull()
    expect(container.textContent).not.toContain('Reference')
    expect(container.textContent).not.toContain('d1g3st42')
    expect(container.textContent).not.toContain('4a5b')
    expect(container.textContent).not.toContain('relation')
    expect(captureException).toHaveBeenCalled()
    expect((await axe(container)).violations.map(v => v.id)).toEqual([])
  })
})

it('global error: its own document, friendly copy, no raw message', () => {
  // It renders <html> and <body>; outside Next that only makes React warn
  // about nesting (console.error is silenced above).
  const { container } = render(<GlobalError error={boom()} reset={() => {}} />)
  expect(screen.getByTestId('error-screen-global')).toBeInTheDocument()
  expect(screen.getByRole('heading', { level: 1, name: 'Something went wrong' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute('href', '/login')
  expect(container.ownerDocument.documentElement.textContent).not.toContain('relation')
  expect(captureException).toHaveBeenCalled()
})

describe.each([
  ['clinic app', ClinicAppNotFound, 'not-found-clinic', 'Back to dashboard', '/dashboard'],
  ['ops dashboard', OpsDashboardNotFound, 'not-found-ops', 'Back to ops dashboard', '/ops'],
  ['pharmacy portal', PharmacyPortalNotFound, 'not-found-pharmacy', 'Back to pharmacy portal', '/pharmacy'],
] as const)('%s not-found', (_name, Page, testId, label, href) => {
  it('says the page was not found and links home', async () => {
    const { container } = render(<Page />)
    expect(screen.getByTestId(testId)).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: label })).toHaveAttribute('href', href)
    expect((await axe(container)).violations.map(v => v.id)).toEqual([])
  })
})

describe('root not-found: the way out fits who is looking', () => {
  afterEach(() => { user = null; authFails = false })

  it.each([
    ['clinic_admin', 'Back to dashboard', '/dashboard'],
    ['provider', 'Back to dashboard', '/dashboard'],
    ['medical_assistant', 'Back to dashboard', '/dashboard'],
    ['ops_admin', 'Back to ops dashboard', '/ops'],
    ['pharmacy_admin', 'Back to pharmacy portal', '/pharmacy'],
  ])('%s goes home', async (role, label, href) => {
    user = { app_metadata: { app_role: role } }
    render(await NotFound())
    expect(screen.getByTestId('not-found-staff')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: label })).toHaveAttribute('href', href)
  })

  it('signed out (a patient with a broken link): sign in, and ask the clinic for a new link', async () => {
    render(await NotFound())
    expect(screen.getByTestId('not-found-public')).toBeInTheDocument()
    expect(screen.getByText(/ask them to send it again/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute('href', '/login')
  })

  it('a role from user_metadata only does not count, and an auth failure falls back to the public page', async () => {
    user = { app_metadata: {} }
    render(await NotFound())
    expect(screen.getByTestId('not-found-public')).toBeInTheDocument()
    authFails = true
    render(await NotFound())
    expect(screen.getAllByTestId('not-found-public')).toHaveLength(2)
  })
})
