/**
 * @jest-environment jsdom
 *
 * The sign-in page starts a new login in the tab, so the previous login's
 * prescription session is dropped (a session that expired on the server
 * never ran the sign-out code). Nov 5, 2026 cross-clinic line on Review.
 */

import { render } from '@testing-library/react'

jest.mock('next/navigation', () => ({
  useRouter:       () => ({ push: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('@/lib/supabase/client', () => ({ createBrowserClient: () => ({ auth: {} }) }))

import LoginPage from '../login/page'

it('opening /login removes the prescription session from this tab', () => {
  sessionStorage.setItem('compoundiq-rx-session', JSON.stringify({ patient: { patient_id: 'p1' }, prescriptions: [{ id: 'l1' }] }))
  render(<LoginPage />)
  expect(sessionStorage.getItem('compoundiq-rx-session')).toBeNull()
})
