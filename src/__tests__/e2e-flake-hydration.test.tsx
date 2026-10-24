/**
 * @jest-environment jsdom
 *
 * E2E flakes (C-2026-10-24-02): controls that are server-rendered work
 * only after React hydrates. Playwright (and a fast user, or a password
 * manager) can act on them before that.
 *
 *   - Login: email and password typed or autofilled before hydration are
 *     in the inputs but not in state, so "Sign in" stays disabled for good
 *     (webkit auth.spec flakes: "element is not enabled" for 60 s).
 *     After hydration the form takes the values already in the inputs.
 *   - "Show setup checklist": a click before hydration does nothing (no
 *     handler yet), so the card never comes back (first-run-checklist).
 *     It is disabled until hydrated, so a click waits for it.
 *   - Settings > Team: after a member is deactivated or reactivated the row
 *     shows it at once, not only after router.refresh() comes back
 *     (team-invites: "Reactivate" not found within 15 s).
 */

import { act } from 'react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { render, screen, fireEvent } from '@testing-library/react'

jest.mock('next/navigation', () => ({
  useRouter:       () => ({ push: jest.fn(), refresh: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname:     () => '/dashboard',
}))
jest.mock('@/lib/supabase/client', () => ({ createBrowserClient: () => ({ auth: { signInWithPassword: jest.fn() } }) }))

import LoginPage from '@/app/login/page'
import { ShowChecklistLink } from '@/components/coaching/show-checklist-link'
import { TeamPanel } from '@/app/(clinic-app)/settings/team/_components/team-panel'
import type { TeamMember } from '@/lib/team/team'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function serverRender(el: React.ReactElement): HTMLElement {
  const container = document.createElement('div')
  container.innerHTML = renderToString(el)
  document.body.appendChild(container)
  return container
}

afterEach(() => { document.body.innerHTML = '' })

it('login: values typed before hydration enable "Sign in" once hydrated', async () => {
  const container = serverRender(<LoginPage />)
  const email = container.querySelector<HTMLInputElement>('#email')!
  const password = container.querySelector<HTMLInputElement>('#password')!
  const button = () => container.querySelector<HTMLButtonElement>('button[type="submit"]')!
  expect(button().disabled).toBe(true)
  // Playwright's fill() (or autofill) before React has hydrated.
  email.value = 'lauren@sunrise.test'
  password.value = 'secret-pass'
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
  await act(async () => { hydrateRoot(container, <LoginPage />) })
  spy.mockRestore()
  expect(button().disabled).toBe(false)
  expect(email.value).toBe('lauren@sunrise.test')
})

it('"Show setup checklist" is disabled until hydrated, then enabled', async () => {
  const container = serverRender(<ShowChecklistLink home="/dashboard" />)
  const button = () => container.querySelector('button')!
  expect(button().disabled).toBe(true)
  await act(async () => { hydrateRoot(container, <ShowChecklistLink home="/dashboard" />) })
  expect(button().disabled).toBe(false)
})

it('team: a deactivated member shows "Reactivate" without waiting for the refresh', async () => {
  const ME = 'e1000000-0000-4000-8000-000000000001'
  const MIA = 'd1000000-0000-4000-8000-000000000001'
  const members: TeamMember[] = [
    { userId: ME, email: 'lauren@sunrise.test', name: 'Lauren Admin', role: 'clinic_admin', deactivatedAt: null, lastSignInAt: null },
    { userId: MIA, email: 'mia@sunrise.test', name: 'Mia Assistant', role: 'medical_assistant', deactivatedAt: null, lastSignInAt: null },
  ]
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => ({ status: 'deactivated' }) })) as unknown as typeof fetch
  render(<main><TeamPanel members={members} invites={[]} canManage currentUserId={ME} /></main>)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Deactivate Mia Assistant' })) })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Yes, deactivate' })) })
  expect(await screen.findByRole('button', { name: 'Reactivate Mia Assistant' })).toBeInTheDocument()

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Reactivate Mia Assistant' })) })
  expect(await screen.findByRole('button', { name: 'Deactivate Mia Assistant' })).toBeInTheDocument()
})
