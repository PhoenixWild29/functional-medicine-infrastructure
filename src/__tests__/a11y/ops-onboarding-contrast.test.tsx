/**
 * @jest-environment jsdom
 *
 * Ops onboarding in the ops DARK theme (the (ops-dashboard) layout wraps
 * every ops page in .dark): text must meet 4.5:1. PR #215's browser axe
 * run flagged the muted paragraphs (slate-700 on the dark card) and the
 * primary button (white on blue-500, 3.7:1).
 *
 * jsdom cannot compute colours, so this pins the classes that fix it and
 * checks the colour pairs they resolve to against WCAG's formula:
 *   - primary button: bg-primary-hover in dark (#2563EB, the --primary-
 *     hover token from #212), hover blue-700 (#1D4ED8); never the 90%
 *     opacity hover, which lightens the blue
 *   - muted text: slate-300 (#CBD5E1) in dark
 *   - errors and the danger button: red-300 (#FCA5A5) in dark
 *   - "complete" step text: emerald-300 (#6EE7B7) in dark
 * e2e/accessibility.spec.ts measures the real page in Chromium.
 */

import { render, screen, cleanup, fireEvent } from '@testing-library/react'

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }))

const opsData = {
  invites: [{ inviteId: 'i1', clinicId: 'c1', clinicName: 'Blue Cedar', email: 'o@b.test', status: 'pending' as const, expiresAt: '2026-10-17T00:00:00Z', createdAt: '2026-10-10T00:00:00Z', sentCount: 1 }],
  clinics: [{
    clinicId: 'c1', name: 'Blue Cedar', onboardingStatus: 'submitted' as const, submittedAt: '2026-10-11T00:00:00Z', reviewNote: null,
    steps: { practice: 'complete', providers: 'complete', staff: 'not_started', baa: 'complete', terms: 'complete', payouts: 'not_started', review: 'complete' } as const,
  }],
}
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({}) }))
jest.mock('@/lib/onboarding/ops', () => ({ loadOpsOnboarding: async () => opsData }))

import OpsOnboardingPage from '@/app/(ops-dashboard)/ops/onboarding/page'
import { OnboardingAdmin } from '@/app/(ops-dashboard)/ops/onboarding/_components/onboarding-admin'

// ── WCAG relative luminance / contrast ratio ─────────────────
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}
const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}
const OPS_BACKGROUND = '#0C0E14' // .dark --background
const OPS_CARD       = '#161B27' // .dark --card

afterEach(cleanup)

describe('colour pairs used in the ops dark theme meet 4.5:1', () => {
  it.each([
    ['white on the dark primary (#2563EB, --primary-hover)', '#FFFFFF', '#2563EB'],
    ['white on the hover blue-700 (#1D4ED8)',                '#FFFFFF', '#1D4ED8'],
    ['slate-300 on the dark card',                           '#CBD5E1', OPS_CARD],
    ['slate-300 on the dark background',                     '#CBD5E1', OPS_BACKGROUND],
    ['red-300 on the dark card',                             '#FCA5A5', OPS_CARD],
    ['red-300 on the dark background',                       '#FCA5A5', OPS_BACKGROUND],
    ['emerald-300 on the dark card',                         '#6EE7B7', OPS_CARD],
  ])('%s', (_name, fg, bg) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5)
  })

  it('and the old pairs did not (white on blue-500, slate-700 on the card)', () => {
    expect(ratio('#FFFFFF', '#3B82F6')).toBeLessThan(4.5)
    expect(ratio('#334155', OPS_CARD)).toBeLessThan(4.5)
  })
})

describe('the ops onboarding page uses the dark-safe classes', () => {
  async function renderPage() {
    const ui = await OpsOnboardingPage()
    return render(<div className="dark">{ui}</div>)
  }

  it('the primary buttons: --primary-hover in dark, blue-700 on hover, no opacity hover', async () => {
    await renderPage()
    for (const name of [/create invite/i, /approve blue cedar/i]) {
      const cls = screen.getByRole('button', { name }).className
      expect(cls).toMatch(/(^|\s)dark:bg-primary-hover(\s|$)/)
      expect(cls).toMatch(/(^|\s)dark:hover:bg-blue-700(\s|$)/)
      expect(cls).not.toMatch(/bg-primary\/\d+/)
    }
  })

  it('every muted paragraph turns slate-300 in dark', async () => {
    const { container } = await renderPage()
    const muted = [...container.querySelectorAll('p')].filter(p => /\btext-slate-(600|700)\b/.test(p.className))
    expect(muted.length).toBeGreaterThan(1)
    for (const p of muted) expect(p.className).toMatch(/(^|\s)dark:text-slate-300(\s|$)/)
    for (const p of container.querySelectorAll('p')) expect(p.className).not.toMatch(/\btext-muted-foreground\b/)
  })

  it('the danger button and complete-step text have dark variants', async () => {
    const { container } = await renderPage()
    expect(screen.getByRole('button', { name: /revoke invite for blue cedar/i }).className).toMatch(/(^|\s)dark:text-red-300(\s|$)/)
    const complete = [...container.querySelectorAll('dd')].filter(d => /\btext-emerald-800\b/.test(d.className))
    expect(complete.length).toBeGreaterThan(0)
    for (const d of complete) expect(d.className).toMatch(/(^|\s)dark:text-emerald-300(\s|$)/)
  })

  it('a field error is red-300 in dark', () => {
    render(
      <div className="dark">
        <OnboardingAdmin invites={[]} clinics={opsData.clinics} />
      </div>,
    )
    // Sending back without a note shows the field error.
    fireEvent.click(screen.getByRole('button', { name: /send blue cedar back/i }))
    const error = screen.getByText(/write what the clinic needs to change/i)
    expect(error.className).toMatch(/(^|\s)dark:text-red-300(\s|$)/)
  })
})
