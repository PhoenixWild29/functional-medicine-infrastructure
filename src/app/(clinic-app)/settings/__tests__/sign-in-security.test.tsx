/**
 * Compliance C3: with enforcement off, a user may still turn on two-step
 * sign-in from Settings. The section says whether it is on, and when it is
 * off links to the enrollment page, which returns to Settings.
 */

import { render, screen } from '@testing-library/react'
import { SignInSecuritySection } from '../_components/sign-in-security-section'

describe('Settings: sign-in security', () => {
  it('not enrolled: says it is off and links to set it up, returning to Settings', () => {
    render(<SignInSecuritySection enrolled={false} enforced={false} />)
    const section = screen.getByTestId('sign-in-security')
    expect(section).toHaveTextContent('Two-step sign-in is off')
    expect(screen.getByRole('link', { name: 'Set up two-step sign-in' }))
      .toHaveAttribute('href', '/mfa/enroll?redirectTo=%2Fsettings')
  })

  it('enrolled: says it is on, with no setup link', () => {
    render(<SignInSecuritySection enrolled enforced={false} />)
    expect(screen.getByTestId('sign-in-security')).toHaveTextContent('Two-step sign-in is on')
    expect(screen.queryByRole('link', { name: 'Set up two-step sign-in' })).toBeNull()
  })

  it('enforced: says the clinic requires it', () => {
    render(<SignInSecuritySection enrolled enforced />)
    expect(screen.getByTestId('sign-in-security')).toHaveTextContent('Required for every sign-in')
  })
})
