/**
 * @jest-environment node
 *
 * userMessage: the API's own friendly text passes; what the browser,
 * runtime or database throws is replaced by the caller's fallback.
 */

import { userMessage, isUserFacingMessage } from '../user-message'

const FALLBACK = 'The order could not be saved.'

it('keeps the friendly text the API sent', () => {
  expect(userMessage(new Error('This patient already has a draft for this medication.'), FALLBACK))
    .toBe('This patient already has a draft for this medication.')
})

it.each([
  ['a network failure', new TypeError('Failed to fetch')],
  ['an empty or HTML body parsed as JSON', new SyntaxError('Unexpected end of JSON input')],
  ['an aborted request', Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })],
  ['a Firefox network error', new Error('NetworkError when attempting to fetch resource.')],
  ['a raw constraint error', new Error('duplicate key value violates unique constraint "orders_pkey"')],
  ['a missing column', new Error('column orders.example does not exist')],
  ['a PostgREST code', new Error('PGRST116: JSON object requested, multiple (or no) rows returned')],
  ['row-level security', new Error('new row violates row-level security policy for table "orders"')],
  ['a stack frame', new Error('boom at Object.handler (/var/task/route.js:12:5)')],
  ['an empty message', new Error('')],
  ['a very long message', new Error('x'.repeat(401))],
])('%s becomes the fallback', (_name, err) => {
  expect(userMessage(err, FALLBACK)).toBe(FALLBACK)
})

it('anything that is not an Error becomes the fallback', () => {
  expect(userMessage('oops', FALLBACK)).toBe(FALLBACK)
  expect(userMessage({ message: 'x' }, FALLBACK)).toBe(FALLBACK)
  expect(userMessage(undefined, FALLBACK)).toBe(FALLBACK)
})

it('isUserFacingMessage', () => {
  expect(isUserFacingMessage('Sign in again to continue.')).toBe(true)
  expect(isUserFacingMessage('permission denied for table orders')).toBe(false)
})
