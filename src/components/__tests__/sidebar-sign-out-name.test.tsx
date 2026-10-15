/**
 * Click-through, 14 Oct: in the collapsed sidebar (the icon rail, always
 * on md to lg screens) Sign out is an icon only, with no accessible name
 * (a title is not one). Every Sign out button now has the name "Sign out",
 * and the icon is hidden from assistive technology.
 */

import { render, screen } from '@testing-library/react'
import { SidebarNav } from '../sidebar-nav'

jest.mock('next/navigation', () => ({ usePathname: () => '/dashboard', useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }))
jest.mock('@/lib/supabase/client', () => ({ createBrowserClient: () => ({ auth: { signOut: jest.fn().mockResolvedValue({ error: null }) } }) }))
jest.mock('@/lib/auth/redirect-to-login', () => ({ redirectToLogin: jest.fn() }))

it('every Sign out button, including the icon-only one, is named "Sign out"', () => {
  localStorage.setItem('sidebar-collapsed', 'true')
  render(<SidebarNav userEmail="lauren@clinic.example" userRole="clinic_admin" />)
  const buttons = screen.getAllByRole('button', { name: 'Sign out' })
  // The xl sidebar (collapsed here) and the md–lg icon rail both render one.
  expect(buttons.length).toBeGreaterThanOrEqual(2)
  for (const b of buttons) {
    const svg = b.querySelector('svg')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  }
})
