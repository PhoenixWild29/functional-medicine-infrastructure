/**
 * @jest-environment node
 *
 * sameOriginPath: a destination the server sent back (sign-up, accept
 * invite) is followed only when it is an in-app path; anything else gives
 * the fallback. Same rule as postLoginDestination's, but '/' is kept (the
 * root redirects by role on a full load).
 */

import { sameOriginPath } from '../full-navigation'

it.each([
  ['/', '/'],
  ['/dashboard', '/dashboard'],
  ['/onboarding?step=1', '/onboarding?step=1'],
  ['//evil.example', '/'],
  ['/\\evil.example', '/'],
  ['https://evil.example/', '/'],
  ['dashboard', '/'],
  ['', '/'],
  [undefined, '/'],
  [null, '/'],
  [42, '/'],
])('%j -> %j', (input, expected) => {
  expect(sameOriginPath(input)).toBe(expected)
})

it('the fallback can be chosen', () => {
  expect(sameOriginPath('//x', '/login')).toBe('/login')
})
