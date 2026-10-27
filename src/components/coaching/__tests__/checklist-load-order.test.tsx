/**
 * @jest-environment jsdom
 *
 * The setup checklist card shows the answer to its LATEST read.
 *
 * e2e/first-run-checklist.spec.ts:66 flaked (run 40147163413, PR #268):
 * after a reload, "Show setup checklist" was clicked while the card's own
 * first read (made while the checklist was still hidden) was in flight.
 * The click stored "shown" and made a second read; when the second read
 * answered first, the card showed, and then the slow first read answered
 * "hidden" and blanked it. A user who clicks quickly after the page loads
 * hits the same thing: the card appears and vanishes.
 */

import { act, render, screen } from '@testing-library/react'
import { SetupChecklistCard, SHOW_CHECKLIST_EVENT } from '../setup-checklist-card'

jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }) }))

const STEPS = [{ id: 'practice', label: 'Enter your practice details', href: '/settings#clinic-profile', done: false }]
const shown = { show: true, hidden: false, notice: null, steps: STEPS }
const hidden = { show: false, hidden: true }

type Pending = { resolve: (body: unknown) => void }
let pending: Pending[] = []
beforeEach(() => {
  pending = []
  global.fetch = jest.fn(() => new Promise(resolve => {
    pending.push({ resolve: body => resolve({ ok: true, status: 200, json: async () => body } as Response) })
  })) as unknown as typeof fetch
})

const card = () => screen.queryByRole('region', { name: 'Get set up' })

it('a slow earlier read ("hidden") does not undo a newer one ("shown")', async () => {
  render(<SetupChecklistCard />)
  expect(pending).toHaveLength(1)                       // read 1, on mount: still hidden

  await act(async () => { window.dispatchEvent(new Event(SHOW_CHECKLIST_EVENT)) })
  expect(pending).toHaveLength(2)                       // read 2, after "Show setup checklist"

  await act(async () => { pending[1]!.resolve(shown) }) // read 2 answers first
  expect(card()).not.toBeNull()

  await act(async () => { pending[0]!.resolve(hidden) }) // then the stale read 1
  expect(card()).not.toBeNull()
})

it('in order, the latest answer still wins', async () => {
  render(<SetupChecklistCard />)
  await act(async () => { window.dispatchEvent(new Event(SHOW_CHECKLIST_EVENT)) })
  await act(async () => { pending[0]!.resolve(hidden) })
  expect(card()).toBeNull()
  await act(async () => { pending[1]!.resolve(shown) })
  expect(card()).not.toBeNull()
})

it('a read still in flight when the card is hidden does not bring it back', async () => {
  render(<SetupChecklistCard />)
  await act(async () => { pending[0]!.resolve(shown) })
  expect(card()).not.toBeNull()

  await act(async () => { window.dispatchEvent(new Event(SHOW_CHECKLIST_EVENT)) }) // read 2 in flight
  await act(async () => { screen.getByRole('button', { name: 'Hide checklist' }).click() })
  await act(async () => { pending[2]!.resolve({ checklistHidden: true }) })        // the hide POST
  expect(card()).toBeNull()

  await act(async () => { pending[1]!.resolve(shown) })                            // stale read 2
  expect(card()).toBeNull()
})
