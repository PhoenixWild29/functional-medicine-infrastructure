/**
 * @jest-environment jsdom
 *
 * Pending review: an unapproved clinic is no longer held on /onboarding,
 * and the banner on every clinic page links here. So the wizard's header
 * leads back into the app as well as out (sign out).
 */

import { render, screen } from '@testing-library/react'

jest.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`NEXT_REDIRECT:${url}`) } }))
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u1', app_metadata: { app_role: 'clinic_admin', clinic_id: 'c1' } } } }) } }),
}))
jest.mock('@/lib/env', () => ({ serverEnv: { idleTimeoutMinutes: () => 15 } }))
jest.mock('@/components/hipaa-timeout', () => ({ HipaaTimeout: () => null }))
jest.mock('@/components/nav-sign-out-button', () => ({ NavSignOutButton: () => <button type="button">Sign out</button> }))

import OnboardingLayout from '../layout'

it('the header links back into the app (the dashboard), beside Sign out', async () => {
  render(await OnboardingLayout({ children: <main>wizard</main> }))
  expect(screen.getByRole('link', { name: 'Go to the app' })).toHaveAttribute('href', '/dashboard')
  expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
})
