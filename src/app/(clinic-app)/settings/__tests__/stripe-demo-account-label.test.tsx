/**
 * A demo clinic's payout account is a placeholder id ("poc_placeholder",
 * or the seed's "acct_poc_…" ids), not a Stripe account. Settings shows
 * it as "Demo payout account" instead of the raw id. The stored id is not
 * changed; a real Stripe account id is still shown as it is.
 */

import { render, screen } from '@testing-library/react'
import { StripeStatusSection } from '../_components/stripe-status-section'
import { payoutAccountLabel } from '@/lib/stripe/demo-account'

describe('payout account label', () => {
  it.each(['poc_placeholder', 'acct_poc_blue_cedar_demo'])('%s reads "Demo payout account"', id => {
    expect(payoutAccountLabel(id)).toBe('Demo payout account')
    render(<StripeStatusSection stripeConnectStatus="ACTIVE" stripeAccountId={id} isClinicAdmin />)
    expect(screen.getByText('Account: Demo payout account')).toBeInTheDocument()
    expect(screen.queryByText(new RegExp(id))).not.toBeInTheDocument()
  })

  it('a real Stripe account id is shown as it is', () => {
    expect(payoutAccountLabel('acct_1PqRsTuVwXyZ0123')).toBe('acct_1PqRsTuVwXyZ0123')
    render(<StripeStatusSection stripeConnectStatus="ACTIVE" stripeAccountId="acct_1PqRsTuVwXyZ0123" isClinicAdmin />)
    expect(screen.getByText('Account: acct_1PqRsTuVwXyZ0123')).toBeInTheDocument()
  })
})
