/**
 * @jest-environment jsdom
 *
 * Refresh Demo Data: the "Last refresh" line reads the status on mount and
 * again after a refresh. Pinned before the status read moved out of an
 * async effect callback (eslint-plugin-react-hooks 7.1
 * set-state-in-effect); behaviour unchanged.
 */

import { act, fireEvent, render, screen } from '@testing-library/react'
import { RefreshDemoDataCard } from '../_components/refresh-demo-data-card'

const ok = (body: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) })
const fetchMock = jest.fn()

beforeEach(() => {
  fetchMock.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
})

it('checking, then the status read on mount', async () => {
  fetchMock.mockReturnValueOnce(ok({ last_refresh_at: null, poc_mode: true }))
  render(<RefreshDemoDataCard />)
  expect(screen.getByText('checking…')).toBeInTheDocument()
  expect(await screen.findByText('Last refresh: never. Click Refresh Demo Data before demo.')).toBeInTheDocument()
  expect(fetchMock).toHaveBeenCalledWith('/api/admin/refresh-demo-data', { method: 'GET' })
})

it('a failed status read leaves "checking"', async () => {
  fetchMock.mockReturnValueOnce(ok({ error: 'x' }, 500))
  render(<RefreshDemoDataCard />)
  await act(async () => {})
  expect(screen.getByText('checking…')).toBeInTheDocument()
})

it('after a refresh the status is read again', async () => {
  const now = new Date().toISOString()
  fetchMock
    .mockReturnValueOnce(ok({ last_refresh_at: null, poc_mode: true }))
    .mockReturnValueOnce(ok({ ran_at: now, ok: true, scaffolding: { action: 'already_exists' }, fax_seed: { pre_delete: 0, post_delete: 0, inserted: 4, action: 'refreshed' }, submission_seed: { pre_delete: 0, post_delete: 0, inserted: 200, action: 'refreshed' } }))
    .mockReturnValueOnce(ok({ last_refresh_at: now, poc_mode: true }))
  render(<RefreshDemoDataCard />)
  await screen.findByText('Last refresh: never. Click Refresh Demo Data before demo.')
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Refresh Demo Data/ })) })
  expect(await screen.findByText('just now')).toBeInTheDocument()
  expect(fetchMock).toHaveBeenCalledTimes(3)
})
