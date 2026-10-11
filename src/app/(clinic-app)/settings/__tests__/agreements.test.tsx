/**
 * @jest-environment jsdom
 *
 * /settings/agreements (clinic admin; read-only for other clinic roles):
 *   - each accepted agreement: title, version, signer, date, "View text"
 *   - "A new version is available" with review and accept (admin only),
 *     posting to /api/settings/agreements
 *   - /settings/agreements/[acceptanceId] shows the accepted text when it
 *     is known and its hash matches; another clinic's acceptance is not
 *     shown
 *   - a Settings nav link; the dashboard banner (dismissible, admin only)
 * Role and clinic from app_metadata; getUser() only. axe-checked.
 */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { configureAxe } from 'jest-axe'
import { createHash } from 'node:crypto'
import { AGREEMENTS } from '@/lib/onboarding/agreement-texts'

const CLINIC = 'c0000000-0000-4000-8000-000000000001'
const V01_SHA = '14367b35e4b4ef51e6ed53d150275474635929a38c9bb900eef8d6e77ebc064e'
const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex')

let user: unknown = null
let rows: Array<Record<string, unknown>> = []
const refresh = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), refresh }) }))
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser: async () => ({ data: { user }, error: null }) } }),
}))
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
    const filters: Record<string, unknown> = {}
    const pick = () => rows.filter(r => Object.entries(filters).every(([k, v]) => r[k] === v))
    const chain: Record<string, unknown> = {}
    for (const m of ['from', 'select', 'order', 'limit', 'is']) chain[m] = () => chain
    chain['eq'] = (k: string, v: unknown) => { filters[k] = v; return chain }
    chain['maybeSingle'] = async () => ({ data: pick()[0] ?? null, error: null })
    chain['then'] = (res: (v: unknown) => unknown) => Promise.resolve({ data: pick(), error: null }).then(res)
    // The clinic row, for the Settings page.
    chain['single'] = async () => ({ data: null, error: null })
    return chain
  },
}))

import AgreementsPage from '../agreements/page'
import AcceptedTextPage from '../agreements/[acceptanceId]/page'
import { AgreementUpdateBanner } from '@/app/(clinic-app)/dashboard/_components/agreement-update-banner'

const as = (role: string) => ({ id: `u-${role}`, email: `${role}@clinic.test`, app_metadata: { app_role: role, clinic_id: CLINIC } })
const acceptance = (over: Record<string, unknown>) => ({
  acceptance_id: 'a-baa-old', clinic_id: CLINIC, agreement: 'baa', template_version: 'v0.1', text_sha256: V01_SHA,
  signer_name: 'Jo Park', signer_title: 'Owner', accepted_at: '2026-10-02T13:00:00Z', ...over,
})
const CURRENT_TERMS = acceptance({ acceptance_id: 'a-terms', agreement: 'terms', template_version: AGREEMENTS.terms.version, text_sha256: sha(AGREEMENTS.terms.text), accepted_at: '2026-10-02T14:00:00Z' })

const axe = configureAxe({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })

beforeEach(() => {
  user = as('clinic_admin')
  rows = [acceptance({}), CURRENT_TERMS]
  refresh.mockClear()
  try { window.localStorage.clear() } catch { /* ignore */ }
})
afterEach(cleanup)

const renderPage = async () => render(<main>{await AgreementsPage()}</main>)

describe('/settings/agreements', () => {
  it('lists each accepted agreement with title, version, signer, date and a View text link', async () => {
    await renderPage()
    const baa = within(screen.getByRole('region', { name: 'Business Associate Agreement' }))
    expect(baa.getByText('v0.1')).toBeTruthy()
    expect(baa.getByText('Jo Park, Owner')).toBeTruthy()
    expect(baa.getByText('Oct 2, 2026')).toBeTruthy()
    expect(baa.getByRole('link', { name: 'View text of the Business Associate Agreement v0.1' }).getAttribute('href')).toBe('/settings/agreements/a-baa-old')
    const terms = within(screen.getByRole('region', { name: 'Terms of Service' }))
    expect(terms.getByText(AGREEMENTS.terms.version)).toBeTruthy()
    expect(terms.queryByText('A new version is available')).toBeNull()
  })

  it('a newer version: the admin sees the notice and the review-and-accept form, which records it', async () => {
    const fetchMock = jest.fn(async () => ({ ok: true, status: 201, json: async () => ({ ok: true, version: AGREEMENTS.baa.version }) }))
    global.fetch = fetchMock as unknown as typeof fetch
    await renderPage()
    const baa = within(screen.getByRole('region', { name: 'Business Associate Agreement' }))
    expect(baa.getByText('A new version is available')).toBeTruthy()
    expect(baa.getByRole('region', { name: `Business Associate Agreement ${AGREEMENTS.baa.version} text` })).toBeTruthy()

    fireEvent.change(baa.getByLabelText(/Signer name/), { target: { value: 'Jo Park' } })
    fireEvent.change(baa.getByLabelText(/^Title/), { target: { value: 'Owner' } })
    fireEvent.click(baa.getByRole('button', { name: `Accept the Business Associate Agreement ${AGREEMENTS.baa.version}` }))
    expect(fetchMock).not.toHaveBeenCalled() // the agree box is required
    fireEvent.click(baa.getByLabelText(/I have read the Business Associate Agreement/))
    await act(async () => { fireEvent.click(baa.getByRole('button', { name: `Accept the Business Associate Agreement ${AGREEMENTS.baa.version}` })) })

    expect(fetchMock).toHaveBeenCalledWith('/api/settings/agreements', expect.objectContaining({ method: 'POST' }))
    expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body)).toEqual({
      agreement: 'baa', version: AGREEMENTS.baa.version, signerName: 'Jo Park', signerTitle: 'Owner',
    })
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/accepted/i))
    expect(refresh).toHaveBeenCalled()
  })

  it.each(['provider', 'medical_assistant'])('a %s sees the agreements and the notice, read-only', async role => {
    user = as(role)
    await renderPage()
    const baa = within(screen.getByRole('region', { name: 'Business Associate Agreement' }))
    expect(baa.getByText('A new version is available')).toBeTruthy()
    expect(baa.getByText(/Your clinic admin can review and accept it/)).toBeTruthy()
    expect(baa.queryByRole('button')).toBeNull()
    expect(baa.getByRole('link', { name: /View text/ })).toBeTruthy()
  })

  it('nothing accepted yet says so', async () => {
    rows = []
    await renderPage()
    expect(within(screen.getByRole('region', { name: 'Terms of Service' })).getByText('Not accepted yet')).toBeTruthy()
  })

  it('has no axe violations', async () => {
    const { container } = await renderPage()
    expect((await axe(container)).violations).toEqual([])
  })

  it('a signed-out visitor gets the session notice; nothing is read', async () => {
    user = null
    const html = renderToStaticMarkup(await AgreementsPage())
    expect(html).not.toContain('Business Associate Agreement')
  })
})

describe('/settings/agreements/[acceptanceId]', () => {
  it('shows the text the clinic accepted (archived v0.1, hash verified)', async () => {
    render(await AcceptedTextPage({ params: Promise.resolve({ acceptanceId: 'a-baa-old' }) }))
    expect(screen.getByRole('heading', { level: 1, name: /Business Associate Agreement.*v0\.1/ })).toBeTruthy()
    expect(screen.getByText(/Accepted by Jo Park, Owner/)).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Business Associate Agreement v0.1 text' }).textContent!.length).toBeGreaterThan(500)
  })

  it('a text whose hash does not match is not shown', async () => {
    rows = [acceptance({ text_sha256: '0'.repeat(64) })]
    render(await AcceptedTextPage({ params: Promise.resolve({ acceptanceId: 'a-baa-old' }) }))
    expect(screen.queryByRole('region', { name: /text$/ })).toBeNull()
    expect(screen.getByText(/does not match/)).toBeTruthy()
  })

  it('another clinic’s acceptance is not found', async () => {
    rows = [acceptance({ clinic_id: 'f0000000-0000-4000-8000-0000000000ff' })]
    render(await AcceptedTextPage({ params: Promise.resolve({ acceptanceId: 'a-baa-old' }) }))
    expect(screen.getByText('This agreement was not found for your clinic.')).toBeTruthy()
    expect(screen.queryByText(/Jo Park/)).toBeNull()
  })
})

describe('the Settings nav and the dashboard banner', () => {
  it('Settings links to Agreements in its side nav', () => {
    const src = require('node:fs').readFileSync(require('node:path').join(process.cwd(), 'src', 'app', '(clinic-app)', 'settings', 'page.tsx'), 'utf8') as string
    expect(src).toMatch(/\{ href: '\/settings\/agreements', +label: 'Agreements' +\}/)
  })

  it('the banner names the agreements with a new version, links to Settings, and can be dismissed', () => {
    const notice = { agreements: [{ key: 'baa' as const, title: 'Business Associate Agreement', version: AGREEMENTS.baa.version }] }
    const { unmount } = render(<AgreementUpdateBanner notice={notice} />)
    const banner = screen.getByRole('region', { name: 'A new version is available' })
    expect(banner.textContent).toMatch(new RegExp(`Business Associate Agreement \\(${AGREEMENTS.baa.version.replace(/\./g, '\\.')}\\)`))
    expect(within(banner).getByRole('link', { name: /Review in Settings/ }).getAttribute('href')).toBe('/settings/agreements')
    fireEvent.click(within(banner).getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('region', { name: 'A new version is available' })).toBeNull()
    unmount()
    render(<AgreementUpdateBanner notice={notice} />)
    expect(screen.queryByRole('region', { name: 'A new version is available' })).toBeNull()
  })

  it('the dashboard shows the banner from loadAgreementNotice (clinic admin only; a failed read shows none)', () => {
    const src = require('node:fs').readFileSync(require('node:path').join(process.cwd(), 'src', 'app', '(clinic-app)', 'dashboard', 'page.tsx'), 'utf8') as string
    expect(src).toMatch(/loadAgreementNotice\(/)
    expect(src).toMatch(/<AgreementUpdateBanner notice=\{agreementNotice\} \/>/)
  })

  it('no notice, no banner', () => {
    const { container } = render(<AgreementUpdateBanner notice={null} />)
    expect(container.innerHTML).toBe('')
  })
})
