/**
 * B11 (technical-safeguards-evidence-2026-10-25.md) in the browser:
 *   - /login has "Forgot password?" and, after a reset, a plain notice;
 *   - /forgot-password sends the reset request and always shows the same
 *     neutral answer;
 *   - /reset-password sets a new password, then goes to /login with the notice;
 *   - Settings > Account "Change password".
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { configureAxe } from 'jest-axe'

const navigateMock = jest.fn()
jest.mock('@/lib/auth/full-navigation', () => ({ navigateFully: (to: string) => navigateMock(to) }))
let search = new URLSearchParams()
jest.mock('next/navigation', () => ({
  useSearchParams: () => search,
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}))
jest.mock('@/lib/supabase/client', () => ({ createBrowserClient: () => ({ auth: { signInWithPassword: jest.fn() } }) }))

import LoginPage from '@/app/login/page'
import { ForgotPasswordForm } from '@/app/forgot-password/_components/forgot-password-form'
import { ResetPasswordForm } from '@/app/reset-password/_components/reset-password-form'
import { ChangePasswordForm } from '@/app/(clinic-app)/settings/_components/change-password-form'

const axe = configureAxe({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })
const NEW = 'violet harbor 42 lantern'

let calls: Array<{ url: string; body: unknown }> = []
function answer(status: number, body: unknown) {
  global.fetch = jest.fn(async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null })
    return { ok: status < 400, status, json: async () => body } as unknown as Response
  }) as unknown as typeof fetch
}

beforeEach(() => {
  calls = []
  navigateMock.mockReset()
  search = new URLSearchParams()
})

describe('/login', () => {
  it('links to "Forgot password?"', () => {
    render(<LoginPage />)
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute('href', '/forgot-password')
  })

  it('after a reset says so, as a status, not an error', () => {
    search = new URLSearchParams('notice=password_reset')
    render(<LoginPage />)
    expect(screen.getByTestId('login-notice')).toHaveTextContent('Your password was changed. Sign in with your new password.')
    expect(screen.getByTestId('login-notice')).toHaveAttribute('role', 'status')
  })
})

describe('/forgot-password', () => {
  it('sends the address and shows the neutral answer', async () => {
    answer(200, { message: 'If an account uses that email, we sent it a link to set a new password. The link works once.' })
    const { container } = render(<ForgotPasswordForm />)
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'provider@clinic.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }))
    expect(await screen.findByTestId('reset-sent')).toHaveTextContent('If an account uses that email, we sent it a link to set a new password.')
    expect(calls[0]).toEqual({ url: '/api/auth/password-reset', body: { email: 'provider@clinic.test' } })
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/login')
    expect((await axe(container)).violations).toEqual([])
  })

  it('shows the rate-limit answer', async () => {
    answer(429, { error: 'Too many reset requests. Wait a few minutes, then try again.' })
    render(<ForgotPasswordForm />)
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'provider@clinic.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }))
    expect(await screen.findByTestId('reset-request-error')).toHaveTextContent('Too many reset requests.')
  })
})

describe('/reset-password', () => {
  it('sets the new password, then goes to /login with the notice', async () => {
    answer(200, { ok: true })
    const { container } = render(<ResetPasswordForm />)
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: NEW } })
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: NEW } })
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }))
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/login?notice=password_reset'))
    expect(calls[0]).toEqual({ url: '/api/auth/password', body: { password: NEW } })
    expect((await axe(container)).violations).toEqual([])
  })

  it('a mismatch is caught before anything is sent; a refusal is shown', async () => {
    answer(400, { error: 'That password is too common. Choose one that is harder to guess.' })
    render(<ResetPasswordForm />)
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: NEW } })
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: `${NEW}x` } })
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }))
    expect(await screen.findByTestId('reset-password-error')).toHaveTextContent('The passwords do not match.')
    expect(calls).toEqual([])
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: NEW } })
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }))
    await waitFor(() => expect(screen.getByTestId('reset-password-error')).toHaveTextContent('That password is too common.'))
    expect(navigateMock).not.toHaveBeenCalled()
  })
})

describe('Settings > Account: Change password', () => {
  it('sends the current and new password and confirms', async () => {
    answer(200, { ok: true })
    const { container } = render(<ChangePasswordForm />)
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'the old password 2026' } })
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: NEW } })
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: NEW } })
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))
    expect(await screen.findByTestId('change-password-done')).toHaveTextContent('Your password was changed. You were signed out on your other devices.')
    expect(calls[0]).toEqual({ url: '/api/auth/password/change', body: { currentPassword: 'the old password 2026', newPassword: NEW } })
    expect((screen.getByLabelText('Current password') as HTMLInputElement).value).toBe('')
    expect((await axe(container)).violations).toEqual([])
  })

  it('shows a wrong current password', async () => {
    answer(400, { error: 'Your current password is not right.' })
    render(<ChangePasswordForm />)
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'wrong one entirely' } })
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: NEW } })
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: NEW } })
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))
    expect(await screen.findByTestId('change-password-error')).toHaveTextContent('Your current password is not right.')
  })
})
