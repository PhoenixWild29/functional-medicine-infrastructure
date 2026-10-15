/**
 * @jest-environment node
 *
 * Click-through, 14 Oct: the Settings side nav listed Notifications third
 * while its section is last on the page, so the highlight did not match
 * what was in view. The nav now follows the order of the sections.
 */

import { renderToStaticMarkup } from 'react-dom/server'

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u', email: 'a@c.example', app_metadata: { app_role: 'clinic_admin', clinic_id: 'c-1' } } } }) } }),
}))
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
    const chain: Record<string, unknown> = {}
    for (const k of ['from', 'select', 'eq', 'is']) chain[k] = () => chain
    chain['maybeSingle'] = async () => ({ data: { clinic_id: 'c-1', name: 'Sunrise', logo_url: null, default_markup_pct: 40, absorb_shipping: false, practice_dashboard_visible_to_providers: false, stripe_connect_status: 'ACTIVE', stripe_connect_account_id: null }, error: null })
    return chain
  },
}))
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }))

import SettingsPage from '../page'

it('the nav lists the sections in the order they appear on the page', async () => {
  const out = renderToStaticMarkup(await SettingsPage())
  const navStart = out.indexOf('aria-label="Settings sections"')
  const nav = out.slice(navStart, out.indexOf('</nav>', navStart))
  const navIds = [...nav.matchAll(/href="#([a-z-]+)"/g)].map(m => m[1])
  const body = out.slice(out.indexOf('</nav>', navStart))
  const sectionIds = [...body.matchAll(/<div id="([a-z-]+)" class="scroll-mt-6"/g)].map(m => m[1])
  expect(navIds).toEqual(sectionIds)
  expect(navIds[navIds.length - 1]).toBe('notifications')
})
