/**
 * Guided first prescription: on a user's first New Prescription, short
 * tips, one line each, with "Next" and "Skip tips". Shown once: finishing
 * or skipping stores rx_tips_seen in the user's own user_metadata
 * (POST /api/coaching/prefs), and the page passes it back as `seen`.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { FirstPrescriptionTips, RX_TIPS } from '../first-prescription-tips'

const fetchMock = jest.fn()
beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
  global.fetch = fetchMock as unknown as typeof fetch
})

const posted = () => fetchMock.mock.calls.filter(c => c[0] === '/api/coaching/prefs').map(c => JSON.parse((c[1] as { body: string }).body))

it('the tips are one line each, with no em dash', () => {
  expect(RX_TIPS.length).toBeGreaterThanOrEqual(3)
  for (const tip of RX_TIPS) {
    expect(tip).not.toMatch(/\n/)
    expect(tip).not.toContain('—')
  }
})

it('steps through the tips with Next, and Done stores them as seen', async () => {
  render(<FirstPrescriptionTips seen={false} />)
  const region = screen.getByRole('region', { name: 'Tips for your first prescription' })
  expect(region).toHaveTextContent(`Tip 1 of ${RX_TIPS.length}`)
  expect(region).toHaveTextContent(RX_TIPS[0]!)
  for (let i = 1; i < RX_TIPS.length; i++) {
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(region).toHaveTextContent(RX_TIPS[i]!)
  }
  expect(screen.queryByRole('button', { name: 'Next' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Done' }))
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Tips for your first prescription' })).toBeNull())
  expect(posted()).toEqual([{ rxTipsSeen: true }])
})

it('Skip tips stores them as seen and they go', async () => {
  render(<FirstPrescriptionTips seen={false} />)
  fireEvent.click(screen.getByRole('button', { name: 'Skip tips' }))
  await waitFor(() => expect(screen.queryByRole('region')).toBeNull())
  expect(posted()).toEqual([{ rxTipsSeen: true }])
})

it('already seen: nothing', () => {
  const { container } = render(<FirstPrescriptionTips seen />)
  expect(container).toBeEmptyDOMElement()
})

it('New Prescription shows them, seen from the user\'s coaching prefs', () => {
  const page = readFileSync(join(process.cwd(), 'src', 'app', '(clinic-app)', 'new-prescription', 'page.tsx'), 'utf8')
  expect(page).toMatch(/<FirstPrescriptionTips seen=\{coachingPrefs\(user\)\.rxTipsSeen\} \/>/)
})
