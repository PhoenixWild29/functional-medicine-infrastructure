/**
 * Compliance C3 / HIPAA automatic logoff: every clinic page signs the
 * user out after inactivity, 15 minutes by default, configurable.
 *
 * Before, the timer was 30 minutes, fixed, and each page had to mount it
 * itself: eight clinic pages did, and Settings (and anything added later)
 * did not. It is now mounted once, by the clinic layout and the ops
 * layout, with the timeout read from IDLE_TIMEOUT_MINUTES through
 * src/lib/env (default 15).
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, act } from '@testing-library/react'
import { HipaaTimeout } from '../hipaa-timeout'
import { serverEnv } from '@/lib/env'

const signOutMock = jest.fn().mockResolvedValue({ error: null })
const redirectToLoginMock = jest.fn()
jest.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({ auth: { signOut: signOutMock } }),
}))
jest.mock('@/lib/auth/redirect-to-login', () => ({
  redirectToLogin: (reason?: string) => redirectToLoginMock(reason),
}))

const MIN = 60 * 1000

describe('the timeout is configurable', () => {
  beforeEach(() => { jest.useFakeTimers(); signOutMock.mockClear(); redirectToLoginMock.mockClear() })
  afterEach(() => { jest.runOnlyPendingTimers(); jest.useRealTimers() })

  it('timeoutMinutes=5: warning at 3 minutes, sign-out at 5', async () => {
    render(<HipaaTimeout timeoutMinutes={5} />)
    act(() => { jest.advanceTimersByTime(3 * MIN - 1000) })
    expect(screen.queryByRole('dialog')).toBeNull()
    act(() => { jest.advanceTimersByTime(1000) })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await act(async () => { jest.advanceTimersByTime(2 * MIN) })
    expect(signOutMock).toHaveBeenCalled()
    expect(redirectToLoginMock).toHaveBeenCalledWith('session_timeout')
  })
})

describe('IDLE_TIMEOUT_MINUTES', () => {
  const saved = process.env['IDLE_TIMEOUT_MINUTES']
  afterEach(() => { if (saved === undefined) delete process.env['IDLE_TIMEOUT_MINUTES']; else process.env['IDLE_TIMEOUT_MINUTES'] = saved })

  it('defaults to 15 when unset', () => {
    delete process.env['IDLE_TIMEOUT_MINUTES']
    expect(serverEnv.idleTimeoutMinutes()).toBe(15)
  })

  it('reads a whole number of minutes', () => {
    process.env['IDLE_TIMEOUT_MINUTES'] = '10'
    expect(serverEnv.idleTimeoutMinutes()).toBe(10)
  })

  it('falls back to 15 for anything that is not a positive whole number', () => {
    for (const bad of ['', '0', '-5', 'abc', '2.5']) {
      process.env['IDLE_TIMEOUT_MINUTES'] = bad
      expect(serverEnv.idleTimeoutMinutes()).toBe(15)
    }
  })
})

// ── Mounted once, on every clinic and ops page ─────────────────────────

const ROOT = join(process.cwd(), 'src', 'app')
function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return name === '__tests__' ? [] : filesUnder(p)
    return /\.(tsx|ts)$/.test(name) ? [p] : []
  })
}

describe('where it is mounted', () => {
  it('the clinic layout mounts it with the configured timeout', () => {
    const layout = readFileSync(join(ROOT, '(clinic-app)', 'layout.tsx'), 'utf8')
    expect(layout).toMatch(/<HipaaTimeout\s+timeoutMinutes=\{serverEnv\.idleTimeoutMinutes\(\)\}\s*\/>/)
  })

  it('the ops layout mounts it with the configured timeout', () => {
    const layout = readFileSync(join(ROOT, '(ops-dashboard)', 'ops', 'layout.tsx'), 'utf8')
    expect(layout).toMatch(/<HipaaTimeout\s+timeoutMinutes=\{serverEnv\.idleTimeoutMinutes\(\)\}\s*\/>/)
  })

  it('no clinic page mounts its own (two timers would race; the layout covers every page)', () => {
    const pages = filesUnder(join(ROOT, '(clinic-app)')).filter(p => !p.endsWith('layout.tsx'))
    const offenders = pages.filter(p => /<HipaaTimeout\b/.test(readFileSync(p, 'utf8')))
    expect(offenders.map(p => p.slice(ROOT.length))).toEqual([])
  })
})
