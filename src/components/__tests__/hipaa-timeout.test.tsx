/**
 * HipaaTimeout unit tests.
 *
 * These cover the 30-minute idle-timeout state machine. The equivalent E2E
 * coverage in e2e/auth.spec.ts only asserts that the component is mounted on
 * /dashboard — Playwright's page.clock is unreliable across full-page
 * navigations on Chromium (CDP-based polyfill doesn't survive context
 * recreation), so the real timer semantics are validated here against
 * jest.useFakeTimers() instead.
 *
 * REQ-OAS-011: HIPAA 30-minute inactivity timeout.
 */

import { render, screen, act } from '@testing-library/react'
import { HipaaTimeout } from '../hipaa-timeout'

// ── Mocks ──────────────────────────────────────────────────────────────

const pushMock = jest.fn()
const signOutMock = jest.fn().mockResolvedValue({ error: null })

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}))

jest.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({
    auth: { signOut: signOutMock },
  }),
}))

// ── Shared setup ───────────────────────────────────────────────────────

const WARNING_MS = 28 * 60 * 1000
const TIMEOUT_MS = 30 * 60 * 1000

beforeEach(() => {
  jest.useFakeTimers()
  pushMock.mockClear()
  signOutMock.mockClear()
})

afterEach(() => {
  // Clean up any remaining timers so they don't leak across tests.
  jest.runOnlyPendingTimers()
  jest.useRealTimers()
})

describe('HipaaTimeout', () => {
  it('renders only a hidden sentinel when no warning is active', () => {
    render(<HipaaTimeout />)
    const sentinel = screen.getByTestId('hipaa-timeout-root')
    expect(sentinel).toBeInTheDocument()
    expect(sentinel).not.toHaveAttribute('role', 'dialog')
  })

  it('shows the warning dialog at 28 minutes of inactivity', () => {
    render(<HipaaTimeout />)

    // Before the warning fires, no dialog is in the tree.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    // Advance to WARNING_MS. React state updates from timer callbacks must
    // be wrapped in act() so their effects flush before we assert.
    act(() => {
      jest.advanceTimersByTime(WARNING_MS)
    })

    const dialog = screen.getByRole('dialog', { name: /Session Expiring Soon/i })
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveAttribute('aria-modal', 'true')
  })

  it('signs the user out at 30 minutes and redirects to /login', async () => {
    render(<HipaaTimeout />)

    act(() => {
      jest.advanceTimersByTime(TIMEOUT_MS)
    })

    // forceSignOut is async (awaits supabase.auth.signOut) before pushing.
    // Flush pending microtasks so the router.push lands before assertion.
    await act(async () => {
      await Promise.resolve()
    })

    expect(signOutMock).toHaveBeenCalledTimes(1)
    expect(pushMock).toHaveBeenCalledWith('/login?reason=session_timeout')
  })

  it('counts down the remaining seconds while the warning is showing', () => {
    render(<HipaaTimeout />)

    act(() => {
      jest.advanceTimersByTime(WARNING_MS)
    })
    expect(screen.getByText(/120 seconds/)).toBeInTheDocument()

    act(() => {
      jest.advanceTimersByTime(60_000)
    })
    expect(screen.getByText(/60 seconds/)).toBeInTheDocument()
  })

  it('user activity before the warning resets the timers', () => {
    render(<HipaaTimeout />)

    // Advance most of the way to the warning.
    act(() => {
      jest.advanceTimersByTime(WARNING_MS - 60_000)
    })

    // Simulate user activity — any ACTIVITY_EVENT on window triggers reset.
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove'))
    })

    // Advance the original remaining 60 seconds; warning should NOT fire
    // because the reset pushed the warning deadline back by WARNING_MS.
    act(() => {
      jest.advanceTimersByTime(60_000)
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    // But if we advance another WARNING_MS from the reset, it DOES fire.
    act(() => {
      jest.advanceTimersByTime(WARNING_MS - 60_000)
    })
    expect(screen.getByRole('dialog', { name: /Session Expiring Soon/i })).toBeInTheDocument()
  })

  it('activity AFTER the warning is showing does NOT reset (per HIPAA spec)', () => {
    render(<HipaaTimeout />)

    // Trigger the warning.
    act(() => {
      jest.advanceTimersByTime(WARNING_MS)
    })
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    // Simulate user activity — should be ignored while warning is showing.
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove'))
    })

    // Dialog still visible.
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
