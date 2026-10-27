/**
 * @jest-environment node
 *
 * A checkout token is the patient's credential: a failed verification
 * logs why (expired, bad signature, malformed), never the token or any
 * text decoded from it. JSON.parse quotes the text it could not read, so
 * a malformed token's error message is not logged, only its name.
 */

import { verifyCheckoutToken } from '../checkout-token'

jest.mock('@/lib/env', () => ({
  serverEnv: {
    jwtSecret:           () => 'test-secret-do-not-use-in-prod-32chars',
    checkoutTokenExpiry: () => 60 * 60,
  },
}))

const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64url')

let logs: string[] = []
beforeEach(() => {
  logs = []
  for (const level of ['log', 'info', 'warn', 'error'] as const) {
    jest.spyOn(console, level).mockImplementation((...a: unknown[]) => {
      logs.push(a.map(x => (x instanceof Error ? `${x.name}: ${x.message}` : typeof x === 'string' ? x : JSON.stringify(x))).join(' '))
    })
  }
})
afterEach(() => jest.restoreAllMocks())

it.each([
  ['a payload that is not JSON', `${b64url('{"alg":"HS256"}')}.${b64url('{"orderId":"SECRET-PART-1234')}.c2ln`],
  ['a payload that is JSON garbage', `${b64url('x')}.${b64url('SECRET-PART-1234 not json')}.c2ln`],
  ['a bad signature', `${b64url('{"alg":"HS256"}')}.${b64url(JSON.stringify({ orderId: 'o', clinicId: 'c', exp: 9e9, n: 'SECRET-PART-1234' }))}.c2lnbmF0dXJl`],
])('%s: null, and nothing from the token is logged', async (_name, token) => {
  expect(await verifyCheckoutToken(token)).toBeNull()
  const all = logs.join('\n')
  expect(all).toContain('[checkout-token]')
  // JSON.parse quotes the first characters it could not read ("SECRET-PAR"...).
  expect(all).not.toContain('SECRET-PAR')
  expect(all).not.toContain(token)
  for (const part of token.split('.')) expect(all).not.toContain(part)
})
