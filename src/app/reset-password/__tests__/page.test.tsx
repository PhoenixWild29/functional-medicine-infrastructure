/**
 * @jest-environment node
 *
 * Review P1: /reset-password offers the new-password form only to a recent
 * recovery session (the reset link). Another signed-in session is sent to
 * Settings, Account, where the current password is asked; no session is
 * told the link expired.
 */

import { renderToStaticMarkup } from 'react-dom/server'

const getUser = jest.fn()
const getClaims = jest.fn()
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser, getClaims } }),
}))
jest.mock('../_components/reset-password-form', () => ({ ResetPasswordForm: () => 'NEW-PASSWORD-FORM' }))

import ResetPasswordPage from '../page'
import { NOT_RECOVERY_MESSAGE } from '@/lib/auth/recovery-session'

const now = () => Math.floor(Date.now() / 1000)
const html = async () => renderToStaticMarkup(await ResetPasswordPage())

beforeEach(() => {
  getUser.mockReset().mockResolvedValue({ data: { user: { id: 'u-1' } } })
  getClaims.mockReset()
})

it('a recovery session from the link: the form', async () => {
  getClaims.mockResolvedValue({ data: { claims: { sub: 'u-1', amr: [{ method: 'recovery', timestamp: now() - 60 }] } } })
  expect(await html()).toContain('NEW-PASSWORD-FORM')
})

it('an ordinary signed-in session: no form, sent to Settings', async () => {
  getClaims.mockResolvedValue({ data: { claims: { sub: 'u-1', amr: [{ method: 'password', timestamp: now() - 60 }] } } })
  const out = await html()
  expect(out).not.toContain('NEW-PASSWORD-FORM')
  expect(out).toContain(NOT_RECOVERY_MESSAGE.replace(/,/g, ','))
  expect(out).toContain('href="/settings"')
})

it('no session: the expired-link message, and the claims are not read', async () => {
  getUser.mockResolvedValue({ data: { user: null } })
  const out = await html()
  expect(out).toContain('This reset link has expired or was already used.')
  expect(out).not.toContain('NEW-PASSWORD-FORM')
  expect(getClaims).not.toHaveBeenCalled()
})
