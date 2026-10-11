/**
 * Settings, payout card. A clinic onboarded through the portal sets up
 * payouts at launch: the card says "Payouts: set up at launch." with no
 * Stripe wording and no button that starts Stripe Connect, for every role.
 *
 * Existing clinics see exactly what they see today (the existing
 * stripe-onboarding-admin-only tests cover today's card too).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import { StripeStatusSection } from '../_components/stripe-status-section'

const STATUSES = ['PENDING', 'ONBOARDING', 'RESTRICTED'] as const

describe('portal-onboarded clinic, payouts not active yet', () => {
  it.each(STATUSES)('%s: "Payouts: set up at launch.", no Stripe wording, no button (clinic admin)', (status) => {
    render(<StripeStatusSection stripeConnectStatus={status} stripeAccountId={null} isClinicAdmin payoutsAtLaunch />)
    expect(screen.getByText('Payouts: set up at launch.')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/Stripe|onboarding/i)
  })

  it('a non-admin sees the same', () => {
    render(<StripeStatusSection stripeConnectStatus="PENDING" stripeAccountId={null} isClinicAdmin={false} payoutsAtLaunch />)
    expect(screen.getByText('Payouts: set up at launch.')).toBeInTheDocument()
    expect(screen.queryByTestId('stripe-onboarding-admin-only')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('never calls the Stripe Connect route', () => {
    const fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch
    render(<StripeStatusSection stripeConnectStatus="PENDING" stripeAccountId={null} isClinicAdmin payoutsAtLaunch />)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('existing clinic', () => {
  it.each([false, undefined])('payoutsAtLaunch=%s: today\'s card, with Start Onboarding for the admin', (flag) => {
    render(<StripeStatusSection stripeConnectStatus="PENDING" stripeAccountId={null} isClinicAdmin {...(flag === undefined ? {} : { payoutsAtLaunch: flag })} />)
    expect(screen.getByRole('heading', { name: 'Stripe Payout Account' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start Onboarding' })).toBeEnabled()
    expect(screen.queryByText('Payouts: set up at launch.')).not.toBeInTheDocument()
  })
})

it('once payouts are active, a portal clinic sees the active card like any other', () => {
  render(<StripeStatusSection stripeConnectStatus="ACTIVE" stripeAccountId="acct_1" isClinicAdmin payoutsAtLaunch />)
  expect(screen.getByText('Payouts active')).toBeInTheDocument()
  expect(screen.queryByText('Payouts: set up at launch.')).not.toBeInTheDocument()
})

it('the settings page decides it on the server, from the clinic in the claims', () => {
  const page = readFileSync(join(process.cwd(), 'src/app/(clinic-app)/settings/page.tsx'), 'utf8')
  expect(page).toMatch(/isPortalOnboardedClinic\(\s*supabase,\s*clinicId\s*\)/)
  expect(page).toMatch(/payoutsAtLaunch=\{payoutsAtLaunch\}/)
  expect(page).toMatch(/getUserClinicId\(user\)/)
})
