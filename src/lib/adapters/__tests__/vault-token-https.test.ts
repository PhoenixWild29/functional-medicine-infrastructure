/**
 * @jest-environment node
 *
 * D's verification (2026-10-26), finding 6: the OAuth token request posts
 * the pharmacy's client secret to creds.token_url, so that URL must be
 * https (http only to localhost under tests), checked before anything is
 * sent, and the request never follows a redirect.
 */

jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({}) }))

import { buildAuthHeaders } from '../vault'

const fetchMock = jest.fn()
beforeAll(() => { (global as { fetch: unknown }).fetch = fetchMock })
jest.spyOn(console, 'error').mockImplementation(() => {})

const cred = (token_url: string) => JSON.stringify({ token_url, client_id: 'cid', client_secret: 'the-client-secret' })

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue({ ok: true, status: 200, json: async () => ({ access_token: 'tok' }), text: async () => '' })
})

it('an http token_url is refused before the client secret is sent', async () => {
  await expect(buildAuthHeaders('oauth2', cred('http://auth.pharm.test/token'))).rejects.toMatchObject({ code: 'insecure_pharmacy_url' })
  expect(fetchMock).not.toHaveBeenCalled()
})

it('junk or another scheme is refused too', async () => {
  for (const url of ['ftp://auth.pharm.test/token', 'auth.pharm.test/token', 'javascript:alert(1)']) {
    await expect(buildAuthHeaders('oauth2', cred(url))).rejects.toMatchObject({ code: 'insecure_pharmacy_url' })
  }
  expect(fetchMock).not.toHaveBeenCalled()
})

it('an https token_url is requested, never following a redirect', async () => {
  const headers = await buildAuthHeaders('oauth2', cred('https://auth.pharm.test/token'))
  expect(headers).toEqual({ Authorization: 'Bearer tok' })
  const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit]
  expect(url).toBe('https://auth.pharm.test/token')
  expect(init.redirect).toBe('error')
})
