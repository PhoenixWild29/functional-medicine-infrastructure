/**
 * Landmarks (Issue Log 94): on phones the clinic app's top bar (brand and
 * "Open navigation") sat outside every landmark (axe "region"). It is the
 * page's banner; the clinic layout has no other.
 */

import { render, screen, within } from '@testing-library/react'
import { SidebarNav } from '../sidebar-nav'

jest.mock('next/navigation', () => ({ usePathname: () => '/dashboard', useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }))
jest.mock('@/lib/supabase/client', () => ({ createBrowserClient: () => ({ auth: { signOut: jest.fn().mockResolvedValue({ error: null }) } }) }))
jest.mock('@/lib/auth/redirect-to-login', () => ({ redirectToLogin: jest.fn() }))

it('the mobile top bar is the banner, with the menu button in it', () => {
  render(<SidebarNav userEmail="lauren@clinic.example" userRole="clinic_admin" />)
  const banners = screen.getAllByRole('banner')
  expect(banners).toHaveLength(1)
  expect(within(banners[0]!).getByRole('button', { name: 'Open navigation' })).toBeInTheDocument()
})
