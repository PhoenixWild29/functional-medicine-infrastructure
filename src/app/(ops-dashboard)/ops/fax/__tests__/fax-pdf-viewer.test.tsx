/**
 * @jest-environment jsdom
 *
 * FaxPdfViewer: ops open an inbound fax from the triage queue. The PDF comes
 * from GET /api/ops/fax/[faxId]/pdf (fetched from Documo on demand; Issue
 * Log 72). States:
 *   - "Open fax" button; on click the PDF shows inline in a titled frame;
 *   - a missing or expired fax, no permission, too many views, or Documo
 *     down: a plain message in the viewer, never a stack trace or raw body;
 *   - axe-checked in each state.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { configureAxe } from 'jest-axe'
import { FaxPdfViewer } from '../_components/fax-pdf-viewer'

const axe = configureAxe({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })
async function violations(): Promise<string[]> {
  const r = await axe(document.body)
  return r.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)
}

const FAX = '55555555-5555-4555-8555-555555555555'
const fetchMock = jest.fn()
const createObjectURL = jest.fn(() => 'blob:fax-1')
const revokeObjectURL = jest.fn()

beforeEach(() => {
  fetchMock.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
  Object.assign(URL, { createObjectURL, revokeObjectURL })
  createObjectURL.mockClear()
  revokeObjectURL.mockClear()
})
afterEach(cleanup)

const pdfResponse = () => ({ ok: true, status: 200, blob: async () => new Blob(['%PDF-1'], { type: 'application/pdf' }) })
const errorResponse = (status: number, body: unknown = { error: 'x' }) => ({ ok: false, status, json: async () => body, blob: async () => new Blob([]) })

async function open() {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Open fax' })) })
}

it('before opening: one button, nothing fetched, axe-clean', async () => {
  render(<FaxPdfViewer faxId={FAX} pdfUrl={`/api/ops/fax/${FAX}/pdf`} />)
  expect(screen.getByRole('button', { name: 'Open fax' })).toBeTruthy()
  expect(fetchMock).not.toHaveBeenCalled()
  expect(await violations()).toEqual([])
})

it('opened: fetched from the ops route, same-origin; shown inline in a titled frame; axe-clean', async () => {
  fetchMock.mockResolvedValue(pdfResponse())
  render(<FaxPdfViewer faxId={FAX} pdfUrl={`/api/ops/fax/${FAX}/pdf`} />)
  await open()
  expect(fetchMock).toHaveBeenCalledWith(`/api/ops/fax/${FAX}/pdf`, expect.objectContaining({ credentials: 'same-origin', cache: 'no-store' }))
  const frame = screen.getByTitle(`Fax ${FAX.slice(0, 8)}`)
  expect(frame.getAttribute('src')).toBe('blob:fax-1')
  expect(await violations()).toEqual([])
})

it('the blob URL is revoked when the viewer closes', async () => {
  fetchMock.mockResolvedValue(pdfResponse())
  const { unmount } = render(<FaxPdfViewer faxId={FAX} pdfUrl={`/api/ops/fax/${FAX}/pdf`} />)
  await open()
  unmount()
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:fax-1')
})

it.each([
  [404, 'This fax is no longer available.'],
  [403, 'Only ops admins can open faxes.'],
  [429, 'Too many faxes opened in a short time. Wait a few minutes and try again.'],
  [502, 'The fax could not be opened right now. Try again in a few minutes.'],
  [500, 'The fax could not be opened right now. Try again in a few minutes.'],
])('%i: a plain message, no frame, axe-clean', async (status, message) => {
  fetchMock.mockResolvedValue(errorResponse(status, { error: 'Error: boom\n    at handler (route.ts:1:1)' }))
  render(<FaxPdfViewer faxId={FAX} pdfUrl={`/api/ops/fax/${FAX}/pdf`} />)
  await open()
  expect(screen.getByRole('alert').textContent).toBe(message)
  expect(document.body.textContent).not.toMatch(/at handler|Error: boom/)
  expect(document.querySelector('iframe')).toBeNull()
  expect(await violations()).toEqual([])
})

it('a network failure: the same plain message', async () => {
  fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
  render(<FaxPdfViewer faxId={FAX} pdfUrl={`/api/ops/fax/${FAX}/pdf`} />)
  await open()
  expect(screen.getByRole('alert').textContent).toBe('The fax could not be opened right now. Try again in a few minutes.')
})

it('the copy has no em dashes', async () => {
  fetchMock.mockResolvedValue(errorResponse(404))
  render(<FaxPdfViewer faxId={FAX} pdfUrl={`/api/ops/fax/${FAX}/pdf`} />)
  await open()
  expect(document.body.textContent).not.toContain('—')
})
