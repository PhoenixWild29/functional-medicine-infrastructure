/**
 * Batch 1, findings 4 and 6.
 *
 * 4. Drug interaction alerts. `if (!res.ok) return []` and an unread
 *    `isError` meant a failed lookup rendered nothing at all — byte for
 *    byte what "no interactions found" looks like. A provider cannot
 *    tell "we checked and it's clear" from "we could not check".
 *
 * 6. EPCS. The gate called the status endpoint with no res.ok check, so
 *    any failure read as "not enrolled" and it POSTed action=setup —
 *    which overwrites totp_secret_encrypted unconditionally and breaks
 *    the provider's existing authenticator.
 */

import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DrugInteractionAlerts } from '../drug-interaction-alerts'
import { EpcsTotpGate } from '../epcs-totp-gate'

function withQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

let calls: { url: string; method: string }[] = []
function mockFetch(handler: (url: string) => { ok: boolean; status: number; body: unknown }) {
  global.fetch = jest.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url)
    calls.push({ url: u, method: (init?.method ?? 'GET').toUpperCase() })
    const r = handler(u)
    return { ok: r.ok, status: r.status, json: async () => r.body } as unknown as Response
  }) as unknown as typeof fetch
}

beforeEach(() => {
  calls = []
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { jest.restoreAllMocks() })

describe('finding 4 — the interaction check could not run', () => {
  const TWO_MEDS = ['Semaglutide 5mg/mL Injectable', 'Testosterone Cypionate 200mg/mL']

  it('says the check failed, instead of rendering nothing', async () => {
    mockFetch(() => ({ ok: false, status: 500, body: { error: 'db down' } }))

    withQuery(<DrugInteractionAlerts medicationNames={TWO_MEDS} />)

    expect(await screen.findByTestId('drug-interactions-error')).toBeInTheDocument()
  })

  it('a clean check with no interactions still renders nothing', async () => {
    mockFetch(() => ({ ok: true, status: 200, body: { data: [] } }))

    withQuery(<DrugInteractionAlerts medicationNames={TWO_MEDS} />)

    await waitFor(() => expect(calls.length).toBeGreaterThan(0))
    expect(screen.queryByTestId('drug-interactions-error')).not.toBeInTheDocument()
  })

  it('stays quiet with fewer than two medications — nothing to interact', async () => {
    mockFetch(() => ({ ok: false, status: 500, body: { error: 'db down' } }))

    withQuery(<DrugInteractionAlerts medicationNames={['Semaglutide 5mg/mL Injectable']} />)

    await waitFor(() => expect(calls.length).toBeGreaterThan(0))
    expect(screen.queryByTestId('drug-interactions-error')).not.toBeInTheDocument()
  })
})

describe('finding 6 — the EPCS status check could not run', () => {
  const props = {
    providerId: 'prov-1',
    providerName: 'Sarah Chen',
    medicationNames: ['Testosterone Cypionate 200mg/mL'],
    deaSchedules: [3],
    onVerified: jest.fn(),
    onCancel: jest.fn(),
  }

  it('does not enrol a new authenticator when the status call fails', async () => {
    mockFetch(url => url.includes('action=status')
      ? { ok: false, status: 500, body: { error: 'db down' } }
      : { ok: true, status: 200, body: { qr_code: 'data:image/png;base64,AAA', secret: 'S3CRET' } })

    render(<EpcsTotpGate {...props} />)

    expect(await screen.findByTestId('epcs-status-error')).toBeInTheDocument()
    // The proof that matters: setup was never called, so an existing
    // secret cannot have been overwritten.
    expect(calls.some(c => c.url.includes('action=setup'))).toBe(false)
  })

  it('an enrolled provider still goes straight to code entry', async () => {
    mockFetch(url => url.includes('action=status')
      ? { ok: true, status: 200, body: { totp_enabled: true } }
      : { ok: true, status: 200, body: {} })

    render(<EpcsTotpGate {...props} />)

    await waitFor(() => expect(screen.queryByTestId('epcs-status-error')).not.toBeInTheDocument())
    expect(calls.some(c => c.url.includes('action=setup'))).toBe(false)
  })

  it('a provider who is genuinely not enrolled still gets the QR setup', async () => {
    mockFetch(url => url.includes('action=status')
      ? { ok: true, status: 200, body: { totp_enabled: false } }
      : { ok: true, status: 200, body: { qr_code: 'data:image/png;base64,AAA', secret: 'S3CRET' } })

    render(<EpcsTotpGate {...props} />)

    await waitFor(() => expect(calls.some(c => c.url.includes('action=setup'))).toBe(true))
    expect(screen.queryByTestId('epcs-status-error')).not.toBeInTheDocument()
  })
})
