/**
 * @jest-environment node
 *
 * Compliance C4: Settings shows the Team entry (nav and section) to the
 * clinic admin and to providers. Medical assistants never see it.
 */

import { renderToStaticMarkup } from 'react-dom/server'

let user: unknown = null
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) } }),
}))
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
    const chain: Record<string, unknown> = {}
    chain['from'] = () => chain
    chain['select'] = () => chain
    chain['eq'] = () => chain
    chain['is'] = () => chain
    chain['maybeSingle'] = async () => ({
      data: { clinic_id: 'c-1', name: 'Sunrise', logo_url: null, default_markup_pct: 40, absorb_shipping: false, practice_dashboard_visible_to_providers: false, stripe_connect_status: 'ACTIVE', stripe_connect_account_id: null },
      error: null,
    })
    return chain
  },
}))
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }))

import SettingsPage from '../page'

const as = (role: string) => ({ id: `u-${role}`, email: `${role}@clinic.example`, user_metadata: { app_role: role, clinic_id: 'c-1' } })

it('the clinic admin sees the Team entry, to manage the team', async () => {
  user = as('clinic_admin')
  const out = renderToStaticMarkup(await SettingsPage())
  expect(out).toContain('href="#team"')
  expect(out).toContain('href="/settings/team"')
  expect(out).toContain('Manage the team')
})

it('a provider sees it too, to view their own credentials', async () => {
  user = as('provider')
  const out = renderToStaticMarkup(await SettingsPage())
  expect(out).toContain('href="/settings/team"')
  expect(out).toContain('View my credentials')
})

it('a medical assistant does not', async () => {
  user = as('medical_assistant')
  const out = renderToStaticMarkup(await SettingsPage())
  expect(out).not.toContain('settings-team')
  expect(out).not.toContain('/settings/team')
})
