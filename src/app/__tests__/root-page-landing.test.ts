/**
 * @jest-environment node
 *
 * The root "/" redirect lands each role on its home: the clinic admin on
 * the Practice dashboard, providers and medical assistants on /dashboard,
 * ops on the pipeline, and a signed-out visitor on /login.
 */

const redirectMock = jest.fn((url: string) => {
  // next/navigation's redirect() throws to stop rendering.
  throw new Error(`NEXT_REDIRECT:${url}`)
})
const getUserMock = jest.fn()

jest.mock('next/navigation', () => ({
  redirect: (url: string) => redirectMock(url),
}))

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser: () => getUserMock() } }),
}))

import RootPage from '../page'

function signedInAs(role: string | undefined) {
  getUserMock.mockResolvedValue({
    data: { user: { id: 'u1', app_metadata: role ? { app_role: role } : {} } },
  })
}

async function landing(): Promise<string> {
  await expect(RootPage()).rejects.toThrow(/NEXT_REDIRECT/)
  const calls = redirectMock.mock.calls
  return calls[calls.length - 1]![0]
}

beforeEach(() => {
  redirectMock.mockClear()
  getUserMock.mockReset()
})

describe('root "/" redirect', () => {
  it('sends the clinic admin to the Practice dashboard', async () => {
    signedInAs('clinic_admin')
    expect(await landing()).toBe('/practice')
  })

  it('sends a provider to /dashboard', async () => {
    signedInAs('provider')
    expect(await landing()).toBe('/dashboard')
  })

  it('sends a medical assistant to /dashboard', async () => {
    signedInAs('medical_assistant')
    expect(await landing()).toBe('/dashboard')
  })

  it('sends ops to the pipeline', async () => {
    signedInAs('ops_admin')
    expect(await landing()).toBe('/ops/pipeline')
  })

  it('sends a signed-out visitor to /login', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } })
    expect(await landing()).toBe('/login')
  })
})
