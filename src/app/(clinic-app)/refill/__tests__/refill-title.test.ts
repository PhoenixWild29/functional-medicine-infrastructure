/**
 * @jest-environment node
 *
 * Click-through, 14 Oct: /refill had no page title of its own. It is
 * "Refill | CompoundIQ".
 */

jest.mock('@/lib/supabase/server', () => ({ createServerClient: jest.fn() }))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: jest.fn() }))

import { metadata } from '../page'

it('/refill is titled "Refill | CompoundIQ"', () => {
  expect(metadata.title).toBe('Refill | CompoundIQ')
})
