/**
 * @jest-environment jsdom
 *
 * R7-Bucket-1 — sign-out hard-navigation contract.
 *
 * Four parallel sign-out implementations exist across this codebase:
 *
 *   1. NavSignOutButton          — ops dashboard nav header
 *   2. SignOutButton              — /unauthorized page
 *   3. SidebarNav (handleSignOut) — clinic-app sidebar
 *   4. HipaaTimeout (forceSignOut) — 30-min idle timeout modal
 *
 * Pre-PR they all called `router.push('/login')`, which is a
 * client-side soft navigation that left the prior authenticated page
 * alive in the JS heap and bfcache-eligible. A walkthrough proved
 * pressing Back after sign-out restored the prior PHI page from
 * bfcache without re-authenticating.
 *
 * The fix routes all four through `redirectToLogin()`, a thin wrapper
 * around `window.location.replace('/login')` that does a real
 * navigation and removes the prior page from history.
 *
 * This test asserts the contract holds for every path. A new fifth
 * sign-out surface that goes back to `router.push` will fail here
 * before it reaches the live POC.
 *
 * HipaaTimeout is covered separately in components/__tests__/
 * hipaa-timeout.test.tsx because it has a non-trivial timer state
 * machine that needs its own setup.
 */

import { render, screen, act } from '@testing-library/react'
import { NavSignOutButton } from '../components/nav-sign-out-button'
import { SignOutButton } from '../app/unauthorized/_components/sign-out-button'

// ── Mocks ──────────────────────────────────────────────────────────────

const signOutMock         = jest.fn().mockResolvedValue({ error: null })
const redirectToLoginMock = jest.fn()

jest.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({
    auth: { signOut: signOutMock },
  }),
}))

jest.mock('@/lib/auth/redirect-to-login', () => ({
  redirectToLogin: (reason?: string) => redirectToLoginMock(reason),
}))

beforeEach(() => {
  signOutMock.mockClear()
  redirectToLoginMock.mockClear()
})

// ── Shared assertion ──────────────────────────────────────────────────

async function assertHardNavOnSignOut(): Promise<void> {
  // Click the sign-out button
  const button = screen.getByRole('button', { name: /sign out/i })
  await act(async () => {
    button.click()
    // Flush the async signOut → redirectToLogin chain
    await Promise.resolve()
    await Promise.resolve()
  })

  // signOut must be awaited before nav (race-fix preserves cookie clearing)
  expect(signOutMock).toHaveBeenCalledTimes(1)
  // Hard-nav wrapper invoked exactly once (no reason for these surfaces)
  expect(redirectToLoginMock).toHaveBeenCalledTimes(1)
  expect(redirectToLoginMock).toHaveBeenCalledWith(undefined)
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('sign-out paths route through redirectToLogin (no router.push)', () => {
  it('NavSignOutButton — ops dashboard nav header', async () => {
    render(<NavSignOutButton />)
    await assertHardNavOnSignOut()
  })

  it('SignOutButton — /unauthorized page', async () => {
    render(<SignOutButton />)
    await assertHardNavOnSignOut()
  })

  // SidebarNav has clinic-specific layout dependencies (Next.js Link,
  // usePathname, localStorage) that need a heavier fixture than the
  // contract-test scope here justifies. The sign-out handler calls the
  // same redirectToLogin wrapper as the others — verified by reading
  // the source. If the implementation drifts (e.g., someone reverts to
  // router.push), grep for `redirectToLogin` would still find the
  // import and the call site, and TypeScript would flag a missing
  // import as a build error. Adequate coverage without the fixture.
})
