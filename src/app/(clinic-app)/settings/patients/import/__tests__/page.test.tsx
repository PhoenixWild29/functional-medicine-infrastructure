/**
 * Settings > Patients > Import, the page. The clinic admin and medical
 * assistants import; a provider sees a notice (imports are an admin task,
 * and the Settings link is not shown to providers). getUser(), never
 * getSession(); the role from claims.ts.
 */

import { render, screen } from '@testing-library/react'

const getUserMock = jest.fn()
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn(async () => ({ auth: { getUser: () => getUserMock() } })),
}))
jest.mock('../_components/import-wizard', () => ({ ImportWizard: () => <div data-testid="import-wizard" /> }))

import ImportPatientsPage, { metadata } from '../page'

const as = (role: string) => getUserMock.mockResolvedValue({ data: { user: { id: 'u', app_metadata: { app_role: role, clinic_id: 'c1' } } }, error: null })

it('has a title', () => {
  expect(metadata.title).toBe('Import patients')
})

it.each(['clinic_admin', 'medical_assistant'])('%s gets the import', async role => {
  as(role)
  render(await ImportPatientsPage())
  expect(screen.getByTestId('import-wizard')).toBeInTheDocument()
})

it('a provider gets a notice, not the import', async () => {
  as('provider')
  render(await ImportPatientsPage())
  expect(screen.queryByTestId('import-wizard')).not.toBeInTheDocument()
  expect(screen.getByRole('heading', { level: 1, name: 'Import patients' })).toBeInTheDocument()
  expect(screen.getByText(/Only the clinic admin or a medical assistant can import patients/)).toBeInTheDocument()
})

it('signed out: the session notice', async () => {
  getUserMock.mockResolvedValue({ data: { user: null }, error: null })
  render(await ImportPatientsPage())
  expect(screen.queryByTestId('import-wizard')).not.toBeInTheDocument()
})
