/**
 * @jest-environment node
 *
 * Patient Intake PR 3: the Settings > Patients card links to the patient
 * sign-up link and shows how many new patients signed up through it in
 * the last 7 days. Clinic admin and medical assistants (the Patients card
 * already is theirs); providers see neither. A count only: no patient data.
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
const countMock = jest.fn()
jest.mock('@/lib/intake/signup-links', () => ({ countRecentSignups: (...a: unknown[]) => countMock(...a) }))

import SettingsPage from '../page'

const as = (role: string) => ({ id: `u-${role}`, email: `${role}@clinic.example`, app_metadata: { app_role: role, clinic_id: 'c-1' } })

beforeEach(() => countMock.mockReset().mockResolvedValue(3))

it.each(['clinic_admin', 'medical_assistant'])('%s: the card links to the sign-up link, with the new sign-ups count for the clinic', async role => {
  user = as(role)
  const out = renderToStaticMarkup(await SettingsPage())
  expect(out).toContain('href="/settings/patients/signup-link"')
  expect(out).toContain('Patient sign-up link')
  expect(out).toContain('3 new sign-ups in the last 7 days')
  expect(countMock).toHaveBeenCalledWith(expect.anything(), 'c-1')
})

it('one sign-up reads in the singular', async () => {
  user = as('clinic_admin')
  countMock.mockResolvedValue(1)
  expect(renderToStaticMarkup(await SettingsPage())).toContain('1 new sign-up in the last 7 days')
})

it('the count could not be read: the link is still there, no number is made up', async () => {
  user = as('clinic_admin')
  countMock.mockResolvedValue(null)
  const out = renderToStaticMarkup(await SettingsPage())
  expect(out).toContain('href="/settings/patients/signup-link"')
  expect(out).not.toMatch(/new sign-ups? in the last 7 days/)
})

it('a provider sees neither the link nor the count', async () => {
  user = as('provider')
  const out = renderToStaticMarkup(await SettingsPage())
  expect(out).not.toContain('/settings/patients/signup-link')
  expect(countMock).not.toHaveBeenCalled()
})
