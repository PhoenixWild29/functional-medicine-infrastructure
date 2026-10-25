/**
 * @jest-environment node
 *
 * The Notifications card on /settings says what is true today. No order
 * status email is sent to a clinic: there is no email provider in the app,
 * and the clinic's contact email is only shown to patients on the checkout
 * success page. So the card must not claim that updates are emailed to the
 * clinic's registered contact email.
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

const as = (role: string) => ({ id: `u-${role}`, email: `${role}@clinic.example`, app_metadata: { app_role: role, clinic_id: 'c-1' } })

/** The Notifications card's text, tags removed and whitespace collapsed. */
async function notificationsCard(): Promise<string> {
  const out = renderToStaticMarkup(await SettingsPage())
  const start = out.indexOf('id="notifications"')
  expect(start).toBeGreaterThan(-1)
  const card = out.slice(start, out.indexOf('</section>', start))
  return card.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&apos;/g, "'").replace(/\s+/g, ' ').trim()
}

it('says what is sent (patient texts, the app) and that no email is sent, and links to the full list; no placeholder', async () => {
  for (const role of ['clinic_admin', 'provider', 'medical_assistant']) {
    user = as(role)
    const text = await notificationsCard()
    expect(text).toContain('CompoundIQ does not send email.')
    expect(text).toContain('payment links, reminders, plan and intake links')
    expect(text).toContain('See what is sent')
    expect(text).not.toMatch(/coming soon|not yet configurable/i)
  }
  const out = renderToStaticMarkup(await SettingsPage())
  expect(out).toContain('href="/settings/notifications"')
})

it('no longer claims updates are sent to the clinic contact email', async () => {
  user = as('clinic_admin')
  const text = await notificationsCard()
  expect(text).not.toMatch(/sent automatically/i)
  expect(text).not.toMatch(/registered contact email/i)
})
