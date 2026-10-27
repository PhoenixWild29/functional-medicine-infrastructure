/**
 * B's review P2: /reset-password tells a flagged invited login with an
 * ordinary session to get the emailed link (which proves the address),
 * and does not offer Settings, Account (an admin who opened the invite
 * knows the current password).
 */

import { render, screen } from '@testing-library/react'

const getUserMock = jest.fn()
let claims: Record<string, unknown> = {}
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn(async () => ({
    auth: { getUser: () => getUserMock(), getClaims: async () => ({ data: { claims } }) },
  })),
}))

import ResetPasswordPage from '../page'
import { MUST_CHANGE_PASSWORD_MESSAGE } from '@/lib/auth/must-change-password'

const FLAGGED_META = { app_role: 'provider', clinic_id: 'c-1', must_change_password: true }

it('/reset-password, flagged, ordinary session: explains, and links to the emailed reset', async () => {
  getUserMock.mockResolvedValue({ data: { user: { id: 'u-1', email: 'dr@clinic.test', app_metadata: FLAGGED_META } } })
  claims = { sub: 'u-1', amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) - 60 }] }
  render(await ResetPasswordPage())
  expect(screen.getByText(MUST_CHANGE_PASSWORD_MESSAGE, { exact: false })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Email me a link' })).toHaveAttribute('href', '/forgot-password')
  expect(screen.queryByRole('link', { name: 'Go to Settings' })).toBeNull()
})
