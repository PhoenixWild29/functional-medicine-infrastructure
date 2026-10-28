/**
 * "Show setup checklist" appears in the sidebar as soon as the checklist is
 * hidden, and goes away once it is shown again (no reload needed).
 */

import { act, render, screen } from '@testing-library/react'
import { SidebarNav } from '../sidebar-nav'
import { CHECKLIST_HIDDEN_EVENT, SHOW_CHECKLIST_EVENT } from '../coaching/setup-checklist-card'

jest.mock('next/navigation', () => ({ usePathname: () => '/dashboard', useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }))
jest.mock('@/lib/supabase/client', () => ({ createBrowserClient: () => ({ auth: { signOut: jest.fn().mockResolvedValue({ error: null }) } }) }))
jest.mock('@/lib/auth/redirect-to-login', () => ({ redirectToLogin: jest.fn() }))

it('shows the link right after hiding, and removes it after showing', () => {
  render(<SidebarNav userEmail="admin@clinic.example" userRole="clinic_admin" />)
  expect(screen.queryByRole('button', { name: /Show setup checklist/ })).not.toBeInTheDocument()
  act(() => { window.dispatchEvent(new Event(CHECKLIST_HIDDEN_EVENT)) })
  expect(screen.getByRole('button', { name: /Show setup checklist/ })).toBeInTheDocument()
  act(() => { window.dispatchEvent(new Event(SHOW_CHECKLIST_EVENT)) })
  expect(screen.queryByRole('button', { name: /Show setup checklist/ })).not.toBeInTheDocument()
})
