/**
 * Patient Intake PR 3: Settings > Patients > Patient sign-up link.
 *
 *   - The clinic admin manages it: shows the link and its QR code (drawn
 *     in the browser, no third-party service), Copy, Print, Turn off / Turn
 *     on, and Make a new link (after a confirmation: the old link and
 *     printed QR codes stop working).
 *   - A medical assistant sees it read-only: the link, the QR code, Copy
 *     and Print (the front desk prints it), but cannot turn it off or
 *     replace it.
 *   - A provider sees a notice and nothing else.
 *   - The print page carries the clinic name and the QR code only: no
 *     patient data.
 *   - No axe violations.
 */

import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { configureAxe } from 'jest-axe'
import QRCode from 'qrcode'

let user: unknown = null
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) } }),
}))
const clinicName = { name: 'Sunrise Wellness' }
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
    const chain: Record<string, unknown> = {}
    for (const m of ['from', 'select', 'eq', 'is']) chain[m] = () => chain
    chain['maybeSingle'] = async () => ({ data: clinicName, error: null })
    return chain
  },
}))
const getLinkMock = jest.fn()
jest.mock('@/lib/intake/signup-links', () => ({ getSignupLink: (...a: unknown[]) => getLinkMock(...a) }))

import SignupLinkPage, { metadata } from '../page'
import { SignupLinkPanel } from '../_components/signup-link-panel'

// Violations only: the helper reads nothing else, and skipping the passes and
// incomplete node lists makes each run about a quarter faster.
const axe = configureAxe({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] })
async function violations(): Promise<string[]> {
  const r = await axe(document.body)
  return r.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)
}

const URL_1 = `https://app.test/join/${'A'.repeat(43)}`
const URL_2 = `https://app.test/join/${'B'.repeat(43)}`
const LINK = { linkId: 'l1', enabled: true, useCount: 4, lastUsedAt: '2026-10-13T10:00:00Z', createdAt: '2026-10-01T10:00:00Z', url: URL_1 }
const as = (role: string) => ({ id: `u-${role}`, app_metadata: { app_role: role, clinic_id: 'c-1' } })

const fetchMock = jest.fn()
const writeText = jest.fn()
const printMock = jest.fn()
beforeEach(() => {
  getLinkMock.mockReset().mockResolvedValue({ ok: true, link: LINK })
  fetchMock.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
  writeText.mockReset().mockResolvedValue(undefined)
  Object.assign(navigator, { clipboard: { writeText } })
  printMock.mockReset()
  window.print = printMock
})

const click = async (name: string | RegExp) => { await act(async () => { fireEvent.click(screen.getByRole('button', { name })) }) }

describe('the page', () => {
  it('has a title', () => {
    expect(metadata.title).toBe('Patient sign-up link')
  })

  it('clinic admin: the panel, manageable, for the clinic from claims', async () => {
    user = as('clinic_admin')
    render(await SignupLinkPage())
    expect(getLinkMock).toHaveBeenCalledWith(expect.anything(), 'c-1')
    expect(screen.getByRole('heading', { level: 1, name: 'Patient sign-up link' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Turn off' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Make a new link' })).toBeInTheDocument()
  })

  it('medical assistant: read-only (Copy and Print, no Turn off or Make a new link)', async () => {
    user = as('medical_assistant')
    render(await SignupLinkPage())
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Print' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Turn off' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Make a new link' })).toBeNull()
    expect(screen.getByText(/Only the clinic admin can turn this link off or make a new one/)).toBeInTheDocument()
  })

  it('provider: a notice only, no link read', async () => {
    user = as('provider')
    render(await SignupLinkPage())
    expect(screen.getByRole('main')).toHaveTextContent('Only the clinic admin or a medical assistant can see the patient sign-up link.')
    expect(getLinkMock).not.toHaveBeenCalled()
    expect(screen.queryByRole('img', { name: /QR code/ })).toBeNull()
  })

  it('the link could not be read: says so, offers nothing to change', async () => {
    user = as('clinic_admin')
    getLinkMock.mockResolvedValue({ ok: false })
    render(await SignupLinkPage())
    expect(screen.getByRole('main')).toHaveTextContent(/could not be loaded/)
    expect(screen.queryByRole('button', { name: 'Make a new link' })).toBeNull()
  })
})

describe('the panel', () => {
  it('shows the link, a QR code drawn in the browser, and its use, with no axe violations', async () => {
    render(<main><SignupLinkPanel clinicName="Sunrise Wellness" initial={LINK} canManage /></main>)
    expect(screen.getByLabelText('Sign-up link')).toHaveValue(URL_1)
    const qr = screen.getAllByRole('img', { name: 'QR code for the patient sign-up link' })[0]!
    expect(qr.tagName.toLowerCase()).toBe('svg')
    // The dark modules are one path, not one rect each: a 33x33 code was
    // about 570 rects per copy (two copies with the print sheet), so every
    // query and axe pass walked over a thousand nodes.
    expect(qr.querySelectorAll('*').length).toBe(2)
    expect(screen.getByText(/Used 4 times/)).toBeInTheDocument()
    expect(await violations()).toEqual([])
  })

  it('the QR path draws exactly the dark modules of the encoded link, inside the quiet zone', () => {
    render(<main><SignupLinkPanel clinicName="Sunrise Wellness" initial={LINK} canManage /></main>)
    const qr = screen.getAllByRole('img', { name: 'QR code for the patient sign-up link' })[0]!
    const d = qr.querySelector('path')!.getAttribute('d')!
    const drawn = new Set<string>()
    for (const [, x, y, w] of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
      for (let i = 0; i < Number(w); i++) drawn.add(`${Number(x) + i - 4},${Number(y) - 4}`)
    }
    const { modules } = QRCode.create(URL_1, { errorCorrectionLevel: 'M' })
    const dark = new Set<string>()
    for (let r = 0; r < modules.size; r++) for (let c = 0; c < modules.size; c++) if (modules.get(r, c)) dark.add(`${c},${r}`)
    expect(dark.size).toBeGreaterThan(50)
    expect([...drawn].sort()).toEqual([...dark].sort())
    expect(qr.getAttribute('viewBox')).toBe(`0 0 ${modules.size + 8} ${modules.size + 8}`)
  })

  it('Copy puts the link on the clipboard and says so', async () => {
    render(<main><SignupLinkPanel clinicName="Sunrise Wellness" initial={LINK} canManage /></main>)
    await click('Copy link')
    expect(writeText).toHaveBeenCalledWith(URL_1)
    expect(screen.getByRole('status')).toHaveTextContent('Link copied.')
  })

  // Self sign-up: a clinic under review cannot create or turn on a link
  // (the server refuses), but Copy and Print of an existing link stay
  // allowed: neither calls the server, so the approval guard never applies.
  it('Copy and Print make no server call (they stay allowed while the clinic is under review)', async () => {
    render(<main><SignupLinkPanel clinicName="Sunrise Wellness" initial={LINK} canManage /></main>)
    await click('Copy link')
    await click('Print')
    expect(writeText).toHaveBeenCalledWith(URL_1)
    expect(printMock).toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('Print prints a page with the clinic name and the QR code, and no patient data', async () => {
    render(<main><SignupLinkPanel clinicName="Sunrise Wellness" initial={LINK} canManage /></main>)
    const sheet = screen.getByTestId('signup-print-sheet')
    expect(within(sheet).getByText('Sunrise Wellness')).toBeInTheDocument()
    expect(within(sheet).getByRole('img', { name: 'QR code for the patient sign-up link' })).toBeInTheDocument()
    expect(within(sheet).getByText(/Scan to sign up as a new patient/)).toBeInTheDocument()
    expect(sheet.textContent).not.toMatch(/Used 4 times|DOB|patient name/i)
    await click('Print')
    expect(printMock).toHaveBeenCalled()
  })

  it('Turn off: posts disable, then says patients are told it is no longer active; Turn on again', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ link: { ...LINK, enabled: false } }) })
    render(<main><SignupLinkPanel clinicName="Sunrise Wellness" initial={LINK} canManage /></main>)
    await click('Turn off')
    expect(fetchMock).toHaveBeenCalledWith('/api/settings/signup-link', expect.objectContaining({ method: 'POST', body: JSON.stringify({ action: 'disable' }) }))
    expect(screen.getByText(/This link is off/)).toBeInTheDocument()
    expect(await violations()).toEqual([])
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ link: LINK }) })
    await click('Turn on')
    expect(fetchMock).toHaveBeenLastCalledWith('/api/settings/signup-link', expect.objectContaining({ body: JSON.stringify({ action: 'enable' }) }))
    expect(screen.queryByText(/This link is off/)).toBeNull()
  })

  it('Make a new link asks first, then replaces the link shown', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ link: { ...LINK, linkId: 'l2', url: URL_2, useCount: 0 } }) })
    render(<main><SignupLinkPanel clinicName="Sunrise Wellness" initial={LINK} canManage /></main>)
    await click('Make a new link')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.getByText(/The current link and any printed QR codes will stop working/)).toBeInTheDocument()
    expect(await violations()).toEqual([])
    await click('Yes, make a new link')
    expect(fetchMock).toHaveBeenCalledWith('/api/settings/signup-link', expect.objectContaining({ body: JSON.stringify({ action: 'create' }) }))
    expect(screen.getByLabelText('Sign-up link')).toHaveValue(URL_2)
  })

  it('no link yet: the clinic admin can create one', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ link: LINK }) })
    render(<main><SignupLinkPanel clinicName="Sunrise Wellness" initial={null} canManage /></main>)
    expect(screen.getByText(/does not have a sign-up link yet/)).toBeInTheDocument()
    await click('Create a sign-up link')
    expect(screen.getByLabelText('Sign-up link')).toHaveValue(URL_1)
  })

  it('a failed change: announced, the link shown is unchanged', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: 'The sign-up link could not be changed. Try again.' }) })
    render(<main><SignupLinkPanel clinicName="Sunrise Wellness" initial={LINK} canManage /></main>)
    await click('Turn off')
    expect(screen.getByRole('alert')).toHaveTextContent('The sign-up link could not be changed. Try again.')
    expect(screen.queryByText(/This link is off/)).toBeNull()
  })
})
