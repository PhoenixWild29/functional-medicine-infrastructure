/**
 * Nov 5, 2026: a prescription line priced by one clinic was still in the
 * tab's sessionStorage after its user signed out, and showed up on the next
 * user's (another clinic's) Review page. Sign-out clears it.
 */

const signOut = jest.fn().mockResolvedValue({ error: null })
jest.mock('@/lib/supabase/client', () => ({ createBrowserClient: () => ({ auth: { signOut } }) }))

import { signOutInBrowser } from '@/lib/supabase/sign-out'
import { RX_SESSION_STORAGE_KEY, clearSignedInTabState } from '../clear'

beforeEach(() => {
  sessionStorage.clear()
  signOut.mockClear()
})

it('signing out removes the prescription session and signs out', async () => {
  sessionStorage.setItem(RX_SESSION_STORAGE_KEY, JSON.stringify({ patient: { patient_id: 'p1' }, prescriptions: [{ id: 'l1' }] }))
  sessionStorage.setItem('unrelated', 'kept')
  await signOutInBrowser()
  expect(sessionStorage.getItem(RX_SESSION_STORAGE_KEY)).toBeNull()
  expect(sessionStorage.getItem('unrelated')).toBe('kept')
  expect(signOut).toHaveBeenCalledTimes(1)
})

it('the key matches the one the prescription session uses', () => {
  expect(RX_SESSION_STORAGE_KEY).toBe('compoundiq-rx-session')
})

it('clearing with nothing stored is harmless', () => {
  expect(() => clearSignedInTabState()).not.toThrow()
})
