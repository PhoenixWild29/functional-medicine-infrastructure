/**
 * Compliance C3: TOTP enrollment on first sign-in, and the TOTP challenge
 * on every new sign-in.
 *
 * Enroll: the page asks Supabase Auth for a new TOTP factor and shows the
 * QR code and the manual key; a correct code verifies the factor, which
 * also raises the session to AAL2, and the user continues to where they
 * were going. A wrong code says so and nothing is saved. An abandoned,
 * unverified factor from an earlier attempt is removed first, so a retry
 * never fails on a leftover.
 *
 * Challenge: the user's verified TOTP factor is challenged with a code; a
 * correct code continues, a wrong one says so. A user with no verified
 * factor is sent to enroll.
 *
 * The login factor is Supabase Auth's own (auth.mfa_factors). It is not
 * the EPCS signing secret (providers.totp_secret_encrypted).
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MfaEnroll } from '../_components/mfa-enroll'
import { MfaChallenge } from '../_components/mfa-challenge'

const mockReplace = jest.fn()
const mockRefresh = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: mockReplace, refresh: mockRefresh }),
}))

const mfa = {
  listFactors: jest.fn(),
  enroll: jest.fn(),
  unenroll: jest.fn(),
  challengeAndVerify: jest.fn(),
}
const signOut = jest.fn()
jest.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({ auth: { mfa, signOut } }),
}))

const QR = 'data:image/svg+xml;utf-8,<svg/>'
const SECRET = 'JBSWY3DPEHPK3PXP'

beforeEach(() => {
  jest.clearAllMocks()
  mfa.listFactors.mockResolvedValue({ data: { all: [], totp: [] }, error: null })
  mfa.enroll.mockResolvedValue({ data: { id: 'factor-new', type: 'totp', totp: { qr_code: QR, secret: SECRET, uri: 'otpauth://totp/x' } }, error: null })
  mfa.unenroll.mockResolvedValue({ data: {}, error: null })
  mfa.challengeAndVerify.mockResolvedValue({ data: {}, error: null })
})

async function typeCode(code: string) {
  fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: code } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Verify/ })) })
}

describe('enrollment', () => {
  it('shows the QR code and the manual key for a new TOTP factor', async () => {
    render(<MfaEnroll destination="/dashboard" />)
    expect(await screen.findByAltText('QR code for your authenticator app')).toHaveAttribute('src', QR)
    expect(screen.getByTestId('mfa-manual-key')).toHaveTextContent(SECRET)
    expect(mfa.enroll).toHaveBeenCalledWith(expect.objectContaining({ factorType: 'totp' }))
  })

  it('removes an abandoned unverified factor before enrolling again', async () => {
    mfa.listFactors.mockResolvedValue({ data: { all: [{ id: 'factor-old', factor_type: 'totp', status: 'unverified' }], totp: [] }, error: null })
    render(<MfaEnroll destination="/dashboard" />)
    await screen.findByAltText('QR code for your authenticator app')
    expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: 'factor-old' })
  })

  it('a correct code verifies the factor and continues to the destination', async () => {
    render(<MfaEnroll destination="/new-prescription" />)
    await screen.findByAltText('QR code for your authenticator app')
    await typeCode('123456')
    expect(mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'factor-new', code: '123456' })
    expect(mockRefresh).toHaveBeenCalled()
    expect(mockReplace).toHaveBeenCalledWith('/new-prescription')
  })

  it('a wrong code says so and does not continue', async () => {
    mfa.challengeAndVerify.mockResolvedValue({ data: null, error: { message: 'Invalid TOTP code entered' } })
    render(<MfaEnroll destination="/dashboard" />)
    await screen.findByAltText('QR code for your authenticator app')
    await typeCode('000000')
    expect(screen.getByRole('alert')).toHaveTextContent(/did not match/)
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('a code that is not 6 digits is not sent', async () => {
    render(<MfaEnroll destination="/dashboard" />)
    await screen.findByAltText('QR code for your authenticator app')
    fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '12a4' } })
    expect(screen.getByRole('button', { name: /Verify/ })).toBeDisabled()
  })

  it('an enrollment the server refuses is shown, not swallowed', async () => {
    mfa.enroll.mockResolvedValue({ data: null, error: { message: 'MFA enroll is disabled for TOTP' } })
    render(<MfaEnroll destination="/dashboard" />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not start/)
  })
})

describe('challenge', () => {
  beforeEach(() => {
    mfa.listFactors.mockResolvedValue({ data: { all: [], totp: [{ id: 'factor-1', factor_type: 'totp', status: 'verified' }] }, error: null })
  })

  it('a correct code raises the session and continues', async () => {
    render(<MfaChallenge destination="/ops" />)
    await screen.findByLabelText('6-digit code')
    await typeCode('654321')
    expect(mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'factor-1', code: '654321' })
    expect(mockRefresh).toHaveBeenCalled()
    expect(mockReplace).toHaveBeenCalledWith('/ops')
  })

  it('a wrong code says so and stays', async () => {
    mfa.challengeAndVerify.mockResolvedValue({ data: null, error: { message: 'Invalid TOTP code entered' } })
    render(<MfaChallenge destination="/dashboard" />)
    await screen.findByLabelText('6-digit code')
    await typeCode('000000')
    expect(screen.getByRole('alert')).toHaveTextContent(/did not match/)
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('no verified factor: sent to enroll, keeping the destination', async () => {
    mfa.listFactors.mockResolvedValue({ data: { all: [], totp: [] }, error: null })
    render(<MfaChallenge destination="/settings" />)
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/mfa/enroll?redirectTo=%2Fsettings'))
  })

  it('offers sign-out, so a user without their phone is not stuck', async () => {
    render(<MfaChallenge destination="/dashboard" />)
    await screen.findByLabelText('6-digit code')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign out' })) })
    expect(signOut).toHaveBeenCalled()
  })
})
