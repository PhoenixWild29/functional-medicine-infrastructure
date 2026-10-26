/**
 * @jest-environment jsdom
 *
 * Post-login redirect from /login. The clinic admin lands on the Practice
 * dashboard; providers and medical assistants on /dashboard; ops on the
 * pipeline. A safe ?redirectTo wins over the role default.
 */

import { render, screen, fireEvent, act } from '@testing-library/react'
import { signInFetch } from '@/__tests__/helpers/sign-in-fetch'

const pushMock    = jest.fn()
const refreshMock = jest.fn()
const signInMock  = jest.fn()
let searchParams  = new URLSearchParams()

jest.mock('next/navigation', () => ({
  useRouter:       () => ({ push: pushMock, refresh: refreshMock }),
  useSearchParams: () => searchParams,
}))

// After sign-in the page navigates fully (lib/auth/full-navigation): the
// destination may have been redirected to /login earlier in this tab, and
// since Next 16.3 the client router reuses that redirect.
const navigateFullyMock = jest.fn()
jest.mock('@/lib/auth/full-navigation', () => ({
  ...jest.requireActual('@/lib/auth/full-navigation'),
  navigateFully: (path: string) => navigateFullyMock(path),
}))

jest.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({ auth: { signInWithPassword: signInMock } }),
}))
// Security B12: the page posts to /api/sign-in, answered here from
// signInMock with the route's status mapping.
beforeEach(() => { global.fetch = signInFetch({ signInWithPassword: signInMock }) as unknown as typeof fetch })

import LoginPage from '../login/page'

function signInReturns(role: string) {
  const user = { id: 'u1', email: 'someone@clinic.test', app_metadata: { app_role: role } }
  signInMock.mockResolvedValue({ data: { user, session: { user } }, error: null })
}

async function submitLogin() {
  render(<LoginPage />)
  fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'someone@clinic.test' } })
  fireEvent.change(screen.getByLabelText('Password'),      { target: { value: 'pw' } })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  })
}

beforeEach(() => {
  pushMock.mockClear()
  refreshMock.mockClear()
  signInMock.mockReset()
  searchParams = new URLSearchParams()
  navigateFullyMock.mockClear()
})

describe('login post-sign-in redirect', () => {
  it('lands the clinic admin on the Practice dashboard', async () => {
    signInReturns('clinic_admin')
    await submitLogin()
    expect(navigateFullyMock).toHaveBeenCalledWith('/practice')
  })

  it('lands a provider on /dashboard', async () => {
    signInReturns('provider')
    await submitLogin()
    expect(navigateFullyMock).toHaveBeenCalledWith('/dashboard')
  })

  it('lands a medical assistant on /dashboard', async () => {
    signInReturns('medical_assistant')
    await submitLogin()
    expect(navigateFullyMock).toHaveBeenCalledWith('/dashboard')
  })

  it('lands ops on the pipeline', async () => {
    signInReturns('ops_admin')
    await submitLogin()
    expect(navigateFullyMock).toHaveBeenCalledWith('/ops/pipeline')
  })

  it('honours ?redirectTo over the admin default', async () => {
    searchParams = new URLSearchParams('redirectTo=/dashboard')
    signInReturns('clinic_admin')
    await submitLogin()
    expect(navigateFullyMock).toHaveBeenCalledWith('/dashboard')
  })

  it('ignores a protocol-relative ?redirectTo and uses the admin default', async () => {
    searchParams = new URLSearchParams('redirectTo=//evil.example.com')
    signInReturns('clinic_admin')
    await submitLogin()
    expect(navigateFullyMock).toHaveBeenCalledWith('/practice')
  })
})

it('a full navigation, never the client router: a destination redirected to /login before sign-in would otherwise be reused', async () => {
  searchParams = new URLSearchParams('redirectTo=%2Fpractice')
  signInReturns('clinic_admin')
  await submitLogin()
  expect(navigateFullyMock).toHaveBeenCalledWith('/practice')
  expect(pushMock).not.toHaveBeenCalled()
})
