/**
 * Click-through, 14 Oct: clicking Notifications in the Settings side nav
 * highlighted the wrong section. The nav had no active state of its own,
 * and its order (Notifications third) did not match the page
 * (Notifications last), so the highlight followed the pointer and focus.
 *
 * Now:
 *   - the nav lists the sections in page order;
 *   - the section in view is marked aria-current="location" (and styled):
 *     the one clicked, then whichever the scroll position reaches, with the
 *     last section active at the bottom of the page (it can never reach
 *     the top of the viewport);
 *   - every other link is not marked.
 */

import { render, screen, fireEvent, act } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SettingsSectionNav } from '../_components/settings-section-nav'

const ITEMS = [
  { href: '#stripe-connect', label: 'Stripe Connect' },
  { href: '#clinic-profile', label: 'Clinic Profile' },
  { href: '#sign-in-security', label: 'Sign-in Security' },
  { href: '#notifications', label: 'Notifications' },
  { href: '/settings/agreements', label: 'Agreements' },
]

/** Sections whose tops are at the given viewport positions. */
function sections(tops: Record<string, number>) {
  for (const [id, top] of Object.entries(tops)) {
    const el = document.createElement('div')
    el.id = id
    el.getBoundingClientRect = () => ({ top, bottom: top + 300, left: 0, right: 0, width: 0, height: 300, x: 0, y: top, toJSON: () => ({}) })
    el.scrollIntoView = () => {}
    document.body.appendChild(el)
  }
}

const current = () => screen.getAllByRole('link').filter(a => a.getAttribute('aria-current') === 'location').map(a => a.textContent)

afterEach(() => { document.body.innerHTML = '' })

it('marks the first section at the top of the page', () => {
  sections({ 'stripe-connect': 0, 'clinic-profile': 400, 'sign-in-security': 800, notifications: 1200 })
  render(<SettingsSectionNav items={ITEMS} />)
  expect(current()).toEqual(['Stripe Connect'])
})

it.each(['Clinic Profile', 'Sign-in Security', 'Notifications'])('clicking %s marks that section, and only it', label => {
  sections({ 'stripe-connect': 0, 'clinic-profile': 400, 'sign-in-security': 800, notifications: 1200 })
  render(<SettingsSectionNav items={ITEMS} />)
  fireEvent.click(screen.getByRole('link', { name: label }))
  expect(current()).toEqual([label])
})

it('follows the scroll position', () => {
  sections({ 'stripe-connect': -900, 'clinic-profile': -500, 'sign-in-security': 40, notifications: 500 })
  render(<SettingsSectionNav items={ITEMS} />)
  act(() => { window.dispatchEvent(new Event('scroll')) })
  expect(current()).toEqual(['Sign-in Security'])
})

it('at the bottom of the page the last section is current, though its top is not reached', () => {
  sections({ 'stripe-connect': -1500, 'clinic-profile': -1100, 'sign-in-security': -600, notifications: 300 })
  Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 2000 })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
  Object.defineProperty(window, 'scrollY', { configurable: true, value: 1200 })
  render(<SettingsSectionNav items={ITEMS} />)
  act(() => { window.dispatchEvent(new Event('scroll')) })
  expect(current()).toEqual(['Notifications'])
})

it('the Agreements page link is never marked as a section', () => {
  sections({ 'stripe-connect': 0 })
  render(<SettingsSectionNav items={ITEMS} />)
  expect(screen.getByRole('link', { name: 'Agreements' })).not.toHaveAttribute('aria-current')
})

describe('the page lists the nav in the order of its sections', () => {
  it('nav hrefs follow the section ids', async () => {
    jest.resetModules()
    jest.doMock('@/lib/supabase/server', () => ({
      createServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u', email: 'a@c.example', app_metadata: { app_role: 'clinic_admin', clinic_id: 'c-1' } } } }) } }),
    }))
    jest.doMock('@/lib/supabase/service', () => ({
      createServiceClient: () => {
        const chain: Record<string, unknown> = {}
        for (const k of ['from', 'select', 'eq', 'is']) chain[k] = () => chain
        chain['maybeSingle'] = async () => ({ data: { clinic_id: 'c-1', name: 'Sunrise', logo_url: null, default_markup_pct: 40, absorb_shipping: false, practice_dashboard_visible_to_providers: false, stripe_connect_status: 'ACTIVE', stripe_connect_account_id: null }, error: null })
        return chain
      },
    }))
    jest.doMock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }))
    const { default: SettingsPage } = await import('../page')
    const out = renderToStaticMarkup(await SettingsPage())
    const navStart = out.indexOf('aria-label="Settings sections"')
    const nav = out.slice(navStart, out.indexOf('</nav>', navStart))
    const navIds = [...nav.matchAll(/href="#([a-z-]+)"/g)].map(m => m[1])
    const body = out.slice(out.indexOf('</nav>', navStart))
    const sectionIds = [...body.matchAll(/<div id="([a-z-]+)" class="scroll-mt-6"/g)].map(m => m[1])
    expect(navIds).toEqual(sectionIds)
    expect(navIds).toContain('notifications')
  })
})
