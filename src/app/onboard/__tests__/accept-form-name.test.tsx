/**
 * Team invites: the accept form starts with the name the clinic admin
 * typed on the invite; the invitee can change it.
 */

import { render, screen } from '@testing-library/react'

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }))
jest.mock('@/lib/supabase/client', () => ({ createBrowserClient: () => ({ auth: { signInWithPassword: jest.fn() } }) }))

import { AcceptInviteForm } from '../_components/accept-invite-form'

it('fills the name from the invite', () => {
  render(<AcceptInviteForm token="t" kind="medical_assistant" clinicName="Sunrise" email="mia@sunrise.test" status="pending" inviteeName="Mia Assistant" />)
  expect(screen.getByLabelText(/Full name/)).toHaveValue('Mia Assistant')
})

it('no name on the invite: empty, as before', () => {
  render(<AcceptInviteForm token="t" kind="provider" clinicName="Sunrise" email="doc@sunrise.test" status="pending" />)
  expect(screen.getByLabelText(/Full name/)).toHaveValue('')
})
