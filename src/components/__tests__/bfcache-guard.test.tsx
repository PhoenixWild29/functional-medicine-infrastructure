/**
 * BfcacheGuard unit tests — PR R7-Bucket-1.
 *
 * The component listens for `pageshow` events and reloads the page when
 * `event.persisted === true` (i.e., the page was restored from the
 * back-forward cache). This closes a HIPAA bfcache leak where pressing
 * Back after sign-out restored a prior authenticated page with PHI.
 *
 * jsdom makes `window.location.reload` non-configurable and effectively
 * unmockable, so we don't unit-test the reload call itself. What this
 * test DOES lock in is the only thing that can silently break in
 * isolation: the listener-lifecycle contract.
 *
 *   - Mount registers a single `pageshow` handler on `window`.
 *   - Unmount removes the SAME handler reference (i.e., the cleanup
 *     function in useEffect actually points at the listener that was
 *     added). A bug here would leak listeners across re-mounts and
 *     cause double-reloads on the next bfcache restore — exactly the
 *     class of regression a future refactor could quietly introduce.
 *
 * The persisted-true → reload branch is exercised end-to-end in the
 * manual Chrome/Safari/iOS-Safari smoke checklist on the PR. The
 * handler body is one line; jsdom won't let us intercept it without
 * fighting the platform.
 */

import { render } from '@testing-library/react'
import { BfcacheGuard } from '../bfcache-guard'

describe('BfcacheGuard', () => {
  it('registers a pageshow listener on mount and removes the same handler on unmount', () => {
    const addSpy    = jest.spyOn(window, 'addEventListener')
    const removeSpy = jest.spyOn(window, 'removeEventListener')

    const { unmount } = render(<BfcacheGuard />)

    const addCalls = addSpy.mock.calls.filter(([type]) => type === 'pageshow')
    expect(addCalls).toHaveLength(1)
    const handler = addCalls[0]![1] as EventListener
    expect(typeof handler).toBe('function')

    unmount()

    const removeCalls = removeSpy.mock.calls.filter(([type]) => type === 'pageshow')
    expect(removeCalls).toHaveLength(1)
    // Same reference — otherwise the listener leaks past unmount and
    // a second mount would result in double-fires on the next restore.
    expect(removeCalls[0]![1]).toBe(handler)

    addSpy.mockRestore()
    removeSpy.mockRestore()
  })
})
