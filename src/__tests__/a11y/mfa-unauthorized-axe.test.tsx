/**
 * @jest-environment jsdom
 *
 * WCAG 2.1 AA: /mfa/enroll, /mfa/challenge and /unauthorized, every state,
 * checked with axe. jsdom cannot measure colour contrast, so the explicit
 * assertions cover the contrast-failing classes found in the audit, plus
 * error linking and visible focus; e2e/accessibility-auth.spec.ts runs axe
 * in a real browser, contrast included.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { configureAxe } from 'jest-axe'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}))
const mfa = { listFactors: jest.fn(), enroll: jest.fn(), unenroll: jest.fn(), challengeAndVerify: jest.fn() }
jest.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({ auth: { mfa, signOut: jest.fn() } }),
}))
let serverUser: unknown = null
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: serverUser }, error: null }) } }),
}))
jest.mock('@/lib/auth/redirect-to-login', () => ({ redirectToLogin: jest.fn() }))

import { MfaEnroll } from '@/app/mfa/_components/mfa-enroll'
import { MfaChallenge } from '@/app/mfa/_components/mfa-challenge'
import UnauthorizedPage, { metadata as unauthorizedMeta } from '@/app/unauthorized/page'
import { metadata as enrollMeta } from '@/app/mfa/enroll/page'
import { metadata as challengeMeta } from '@/app/mfa/challenge/page'
import { SessionGuardNotice } from '@/components/session-guard-notice'

const axe = configureAxe({
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
  rules: { region: { enabled: true } },
})
async function violations(): Promise<string[]> {
  const results = await axe(document.body)
  return results.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)
}

const MISMATCH = 'That code did not match. Check the time on your device and try the newest code.'

beforeEach(() => {
  jest.clearAllMocks()
  serverUser = null
  mfa.listFactors.mockResolvedValue({ data: { all: [], totp: [{ id: 'factor-1', status: 'verified' }] }, error: null })
  mfa.enroll.mockResolvedValue({ data: { id: 'factor-new', type: 'totp', totp: { qr_code: 'data:image/svg+xml;utf-8,<svg/>', secret: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://totp/x' } }, error: null })
  mfa.unenroll.mockResolvedValue({ data: {}, error: null })
  mfa.challengeAndVerify.mockResolvedValue({ data: {}, error: null })
})
afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

async function submitWrongCode() {
  mfa.challengeAndVerify.mockResolvedValue({ data: null, error: { message: 'Invalid TOTP code' } })
  fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '000000' } })
  await act(async () => { fireEvent.submit(screen.getByLabelText('6-digit code').closest('form')!) })
}

function expectCodeFieldNamesTheError() {
  const input = screen.getByLabelText('6-digit code')
  expect(input).toHaveAttribute('aria-invalid', 'true')
  expect(input).toHaveAccessibleDescription(MISMATCH)
}

describe('page titles', () => {
  it('each page has its own title', () => {
    expect(enrollMeta.title).toBe('Set up two-step sign-in')
    expect(challengeMeta.title).toBe('Two-step sign-in')
    expect(unauthorizedMeta.title).toBeTruthy()
  })
})

describe('/mfa/enroll', () => {
  it('no axe violations once the code is shown', async () => {
    render(<MfaEnroll destination="/dashboard" />)
    await screen.findByLabelText('6-digit code')
    expect(await violations()).toEqual([])
  })

  it('the code field has a 3:1 border and the sign-out control shows keyboard focus', async () => {
    render(<MfaEnroll destination="/dashboard" />)
    const input = await screen.findByLabelText('6-digit code')
    // border-input (#E2E8F0) is 1.2:1 on white; WCAG 1.4.11 needs 3:1.
    expect(input.className).not.toMatch(/\bborder-input\b/)
    // focus-visible:outline-none with no ring left keyboard focus invisible.
    expect(screen.getByRole('button', { name: 'Sign out' }).className).toMatch(/focus-visible:ring-2/)
  })

  it('a wrong code is announced and tied to the code field', async () => {
    render(<MfaEnroll destination="/dashboard" />)
    await screen.findByLabelText('6-digit code')
    await submitWrongCode()
    expect(await screen.findByRole('alert')).toHaveTextContent(MISMATCH)
    expectCodeFieldNamesTheError()
    expect(await violations()).toEqual([])
  })

  it('typing a new code clears the invalid state', async () => {
    render(<MfaEnroll destination="/dashboard" />)
    await screen.findByLabelText('6-digit code')
    await submitWrongCode()
    fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '12345' } })
    expect(screen.getByLabelText('6-digit code')).not.toHaveAttribute('aria-invalid', 'true')
  })

  it('setup that could not start is announced; no axe violations', async () => {
    mfa.enroll.mockResolvedValue({ data: null, error: { message: 'down' } })
    jest.spyOn(console, 'error').mockImplementation(() => {})
    render(<MfaEnroll destination="/dashboard" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Two-step sign-in could not start.')
    expect(await violations()).toEqual([])
  })
})

describe('/mfa/challenge', () => {
  it('no axe violations', async () => {
    render(<MfaChallenge destination="/dashboard" />)
    await screen.findByLabelText('6-digit code')
    expect(await violations()).toEqual([])
  })

  it('a wrong code is announced and tied to the code field', async () => {
    render(<MfaChallenge destination="/dashboard" />)
    await screen.findByLabelText('6-digit code')
    await submitWrongCode()
    expect(await screen.findByRole('alert')).toHaveTextContent(MISMATCH)
    expectCodeFieldNamesTheError()
    expect(await violations()).toEqual([])
  })

  it('a sign-in that could not be checked is announced; no axe violations', async () => {
    mfa.listFactors.mockResolvedValue({ data: null, error: { message: 'down' } })
    jest.spyOn(console, 'error').mockImplementation(() => {})
    render(<MfaChallenge destination="/dashboard" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Your sign-in could not be checked.')
    expect(await violations()).toEqual([])
  })
})

describe('/unauthorized', () => {
  it('signed in: no axe violations; one main landmark and one h1', async () => {
    serverUser = { email: 'admin@clinic.test', user_metadata: { app_role: 'clinic_admin' } }
    render(await UnauthorizedPage())
    expect(await violations()).toEqual([])
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('signed out: no axe violations', async () => {
    render(await UnauthorizedPage())
    expect(await violations()).toEqual([])
  })

  it('the sign-out button shows keyboard focus', async () => {
    render(await UnauthorizedPage())
    expect(screen.getByRole('button', { name: 'Sign out' }).className).toMatch(/focus(-visible)?:ring-2/)
  })
})

describe('session expired notice (what /mfa/* renders with no session)', () => {
  it('no axe violations; the sign-in link shows keyboard focus', async () => {
    render(<SessionGuardNotice />)
    expect(await violations()).toEqual([])
    expect(screen.getByRole('link', { name: 'Sign in' }).className).toMatch(/focus-visible:ring-2/)
  })
})
