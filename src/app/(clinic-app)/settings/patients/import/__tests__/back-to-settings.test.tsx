/**
 * Click-through, 14 Oct: the patient import page had no way back to
 * Settings. It now starts with a "Back to Settings" link, for everyone
 * who can reach it (the notice a provider sees included).
 */

import { render, screen } from '@testing-library/react'

const getUserMock = jest.fn()
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn(async () => ({ auth: { getUser: () => getUserMock() } })),
}))
jest.mock('../_components/import-wizard', () => ({ ImportWizard: () => <div data-testid="import-wizard" /> }))

import ImportPatientsPage from '../page'

const as = (role: string) => getUserMock.mockResolvedValue({ data: { user: { id: 'u', app_metadata: { app_role: role, clinic_id: 'c1' } } }, error: null })

it.each(['clinic_admin', 'medical_assistant', 'provider'])('%s: a Back to Settings link', async role => {
  as(role)
  render(await ImportPatientsPage())
  expect(screen.getByRole('link', { name: 'Back to Settings' })).toHaveAttribute('href', '/settings')
})
