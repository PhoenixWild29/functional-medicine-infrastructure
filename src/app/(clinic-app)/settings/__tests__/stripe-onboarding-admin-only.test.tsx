/**
 * The Stripe payout account is the clinic admin's to set up. The Settings
 * page hides the Start / Continue Onboarding button from every other
 * clinic user and says who can do it; the status itself stays visible.
 */

import { render, screen } from '@testing-library/react'
import { StripeStatusSection } from '../_components/stripe-status-section'

describe('Stripe onboarding button', () => {
  it.each(['PENDING', 'ONBOARDING', 'RESTRICTED'] as const)('%s: hidden for a non-admin, who is told who can do it', (status) => {
    render(<StripeStatusSection stripeConnectStatus={status} stripeAccountId={null} isClinicAdmin={false} />)
    expect(screen.queryByRole('button', { name: /onboarding/i })).not.toBeInTheDocument()
    expect(screen.getByTestId('stripe-onboarding-admin-only')).toHaveTextContent('Only the clinic admin can set up the payout account.')
  })

  it.each([['PENDING', 'Start Onboarding'], ['RESTRICTED', 'Continue Onboarding']] as const)('%s: the clinic admin sees %s', (status, label) => {
    render(<StripeStatusSection stripeConnectStatus={status} stripeAccountId={null} isClinicAdmin />)
    expect(screen.getByRole('button', { name: label })).toBeEnabled()
    expect(screen.queryByTestId('stripe-onboarding-admin-only')).not.toBeInTheDocument()
  })
})
