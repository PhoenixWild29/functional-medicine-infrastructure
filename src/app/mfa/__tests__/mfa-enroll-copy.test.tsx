/**
 * /mfa/enroll told a pharmacy_admin "Your clinic requires a second step
 * when you sign in". Pharmacy admins and ops admins have no clinic, so
 * the copy is role-neutral for every role. /mfa/challenge never named
 * the clinic; pinned here too.
 */

import { render, screen } from '@testing-library/react'

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }) }))
jest.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({
    auth: {
      mfa: {
        listFactors: jest.fn(async () => ({ data: { all: [], totp: [] }, error: null })),
        enroll: jest.fn(async () => ({ data: { id: 'f-1', type: 'totp', totp: { qr_code: 'data:image/svg+xml;utf-8,<svg/>', secret: 'S', uri: 'otpauth://totp/x' } }, error: null })),
        unenroll: jest.fn(async () => ({ data: {}, error: null })),
        challengeAndVerify: jest.fn(async () => ({ data: {}, error: null })),
      },
      signOut: jest.fn(),
    },
  }),
}))
let role = 'pharmacy_admin'
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u-1', app_metadata: { app_role: role, clinic_id: role === 'pharmacy_admin' || role === 'ops_admin' ? null : 'c-1', pharmacy_id: role === 'pharmacy_admin' ? 'p-1' : undefined } } }, error: null }) },
  }),
}))

import EnrollPage from '../enroll/page'
import { MfaChallenge } from '../_components/mfa-challenge'

it.each(['pharmacy_admin', 'clinic_admin', 'provider', 'ops_admin'])('enroll copy for %s is role-neutral', async r => {
  role = r
  render(await EnrollPage())
  expect(await screen.findByText(/your account requires a second step when you sign in/i)).toBeInTheDocument()
  expect(document.body.textContent).not.toMatch(/your clinic/i)
})

it('the challenge does not mention a clinic', () => {
  render(<MfaChallenge destination="/pharmacy/onboarding" />)
  expect(document.body.textContent).not.toMatch(/clinic/i)
})
