/**
 * /settings/notifications (B-2026-10-25-07): read only, every notification
 * CompoundIQ sends with when and to whom, and whether texting is on in
 * this environment. No switches: a preference needs a column that does
 * not exist yet. getUser(), never getSession().
 */

import { render, screen, within } from '@testing-library/react'
import { configureAxe } from 'jest-axe'

let user: unknown = null
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) } }),
}))
let textingOn = false
jest.mock('@/lib/twilio/config', () => ({ isTwilioConfigured: () => textingOn }))

import NotificationsPage from '../page'
import { NOTIFICATION_GROUPS } from '@/lib/notifications/catalog'

const as = (role: string) => ({ id: `u-${role}`, email: `${role}@clinic.example`, app_metadata: { app_role: role, clinic_id: 'c-1' } })
const axe = configureAxe({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } })

beforeEach(() => { user = as('clinic_admin'); textingOn = false })

it('lists every notification, with when and who receives it, for every clinic role', async () => {
  for (const role of ['clinic_admin', 'provider', 'medical_assistant']) {
    user = as(role)
    const { unmount } = render(await NotificationsPage())
    expect(screen.getByRole('heading', { level: 1, name: 'Notifications' })).toBeInTheDocument()
    expect(screen.getByText('Notification settings are coming. This is what CompoundIQ sends today, and to whom.')).toBeInTheDocument()
    for (const group of NOTIFICATION_GROUPS) {
      const section = screen.getByRole('region', { name: group.title })
      for (const e of group.entries) {
        const row = within(section).getByTestId(`notification-${e.id}`)
        expect(within(row).getByRole('rowheader', { name: e.title })).toBeInTheDocument()
        expect(row).toHaveTextContent(e.when)
        expect(row).toHaveTextContent(e.to)
      }
    }
    expect(screen.getByRole('region', { name: 'Not sent today' })).toHaveTextContent('Email of any kind')
    unmount()
  }
})

it('texting not set up: says no texts are sent today and how to share links instead', async () => {
  render(await NotificationsPage())
  expect(screen.getByTestId('texting-status')).toHaveTextContent('Texting is not set up yet, so no texts are sent today.')
})

it('texting on: says the texts are sent', async () => {
  textingOn = true
  render(await NotificationsPage())
  expect(screen.getByTestId('texting-status')).toHaveTextContent('Texting is on: the texts below are sent.')
})

it('read only: no switch, checkbox or button to change anything', async () => {
  render(await NotificationsPage())
  expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
  expect(screen.queryAllByRole('switch')).toHaveLength(0)
  expect(screen.queryAllByRole('button')).toHaveLength(0)
  expect(screen.getByRole('link', { name: 'Back to Settings' })).toHaveAttribute('href', '/settings')
})

it('signed out, or no clinic: the session notice, nothing listed', async () => {
  user = null
  const { unmount } = render(await NotificationsPage())
  expect(screen.queryByText('Texts to your patients')).toBeNull()
  unmount()
  user = { id: 'u-x', email: 'x@clinic.example', app_metadata: { app_role: 'provider' } }
  render(await NotificationsPage())
  expect(screen.getByText('No clinic linked')).toBeInTheDocument()
})

it('axe clean, and no em dash', async () => {
  const { container } = render(await NotificationsPage())
  expect((await axe(container)).violations.map(v => v.id)).toEqual([])
  expect(container.textContent).not.toMatch(/—/)
})
