/**
 * Pharmacy Terms of Service on screen:
 *   - the wizard has a "Terms of service" step right after "BAA", rendered
 *     with LegalMarkdown under the draft banner, with signer name, title
 *     and an "I accept" checkbox; Submit waits for both;
 *   - ops review shows both acceptances (signer, title, version, time and
 *     the first 12 characters of the hash);
 *   - /pharmacy/agreements lists what was accepted with a "View text"
 *     link, and flags a newer version with a review-and-accept action.
 */

import { render, screen, fireEvent, within, act } from '@testing-library/react'

const push = jest.fn()
const refresh = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh, replace: jest.fn() }), usePathname: () => '/pharmacy/onboarding' }))

import { OnboardingWizard } from '@/app/pharmacy/onboarding/_components/onboarding-wizard'
import { PharmacyApplicationReview } from '@/app/(ops-dashboard)/ops/onboarding/_components/pharmacy/pharmacy-application-review'
import { AgreementsList } from '@/app/pharmacy/agreements/_components/agreements-list'
import { pharmacyAgreement } from '@/lib/pharmacy-onboarding/agreement'
import type { WizardState } from '@/lib/pharmacy-onboarding/application'

const fetchMock = jest.fn()
beforeEach(() => {
  fetchMock.mockReset()
  push.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
})
const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as unknown as Response

const view = (key: 'baa' | 'pharmacy_terms', acceptance: WizardState['agreement']['acceptance'] = null) => {
  const a = pharmacyAgreement(key)
  return { key: a.key, version: a.version, title: a.title, text: a.text, textSha256: a.textSha256, banner: a.banner, draft: true, acceptance }
}

function state(over: Partial<WizardState> = {}): WizardState {
  return {
    status: 'in_progress', stepsCompleted: [], reviewNote: null, submittedAt: null,
    pharmacy: { name: 'Strive Pharmacy', ship_carriers: [], ship_to_states: [] },
    licenses: [], ordering: null, catalog: { choice: null, rowCount: null, warnings: [] },
    agreement: view('baa'), terms: view('pharmacy_terms'),
    ...over,
  }
}

const nav = () => within(screen.getByRole('navigation', { name: 'Onboarding steps' }))
const stepLabels = () => nav().getAllByRole('button').map(b => b.textContent!.replace(/^\d+|✓|\(done\)/g, '').trim())

describe('the wizard', () => {
  it('"Terms of service" comes right after "BAA"', () => {
    render(<OnboardingWizard initial={state()} />)
    const labels = stepLabels()
    expect(labels[labels.indexOf('BAA') + 1]).toBe('Terms of service')
  })

  it('the step renders the final v1.0 terms with LegalMarkdown (no draft banner), and records the acceptance', async () => {
    render(<OnboardingWizard initial={state({ stepsCompleted: ['details', 'facility', 'licenses', 'ordering', 'shipping', 'agreement'] })} />)
    fireEvent.click(nav().getByRole('button', { name: /^\d*\s*Terms of service/ }))
    expect(screen.getByRole('heading', { level: 2, name: 'Terms of service' })).toBeInTheDocument()
    const region = screen.getByRole('region', { name: 'Pharmacy Terms of Service text' })
    expect(within(region).getByRole('heading', { name: /Definitions/ })).toBeInTheDocument()
    expect(region.innerHTML).not.toContain('## ')
    expect(document.body.textContent).not.toMatch(/draft|pending legal review/i)
    expect(screen.getByText('Pharmacy Terms of Service, version v1.0')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Your full name'), { target: { value: 'Dana Ruiz' } })
    fireEvent.change(screen.getByLabelText('Your title'), { target: { value: 'Pharmacist in charge' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /I have read and accept the Pharmacy Terms of Service/ }))
    fetchMock.mockResolvedValueOnce(reply({ ok: true })).mockResolvedValue(reply({ state: state({ terms: view('pharmacy_terms', { signerName: 'Dana Ruiz', signerTitle: 'Pharmacist in charge', acceptedAt: '2026-10-11T12:00:00.000Z' }) }) }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /accept and continue/i })) })

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/pharmacy/onboarding/agreement')
    const t = pharmacyAgreement('pharmacy_terms')
    expect(JSON.parse(init.body)).toEqual({ agreement: 'pharmacy_terms', signerName: 'Dana Ruiz', signerTitle: 'Pharmacist in charge', accept: true, templateVersion: t.version, textSha256: t.textSha256 })
  })

  it('the BAA step posts as the BAA', async () => {
    render(<OnboardingWizard initial={state()} />)
    fireEvent.click(nav().getByRole('button', { name: /^\d*\s*BAA/ }))
    expect(screen.getByRole('region', { name: 'Business Associate Agreement text' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Your full name'), { target: { value: 'Dana Ruiz' } })
    fireEvent.change(screen.getByLabelText('Your title'), { target: { value: 'PIC' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /Business Associate Agreement/ }))
    fetchMock.mockResolvedValueOnce(reply({ ok: true })).mockResolvedValue(reply({ state: state() }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /accept and continue/i })) })
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual(expect.objectContaining({ agreement: 'baa' }))
  })

  it('Submit waits for the terms', () => {
    const allButTerms = ['details', 'facility', 'licenses', 'ordering', 'shipping', 'agreement', 'catalog']
    const { unmount } = render(<OnboardingWizard initial={state({ stepsCompleted: allButTerms })} />)
    fireEvent.click(nav().getByRole('button', { name: /Review and submit/ }))
    const steps = within(screen.getByRole('list', { name: 'Steps' }))
    expect(steps.getByText('Terms of service').closest('li')).toHaveTextContent('To do')
    expect(screen.getByRole('button', { name: /submit for review/i })).toBeDisabled()
    unmount()

    render(<OnboardingWizard initial={state({ stepsCompleted: [...allButTerms, 'terms'] })} />)
    expect(screen.getByRole('button', { name: /submit for review/i })).toBeEnabled()
  })
})

describe('ops review', () => {
  const acc = (over: Record<string, unknown> = {}) => ({ title: 'x', signerName: 'Dana Ruiz', signerTitle: 'PIC', acceptedAt: '2026-10-10T09:00:00.000Z', templateVersion: 'v0.1', hashPrefix: 'abcdef012345', current: true, ...over })
  const review = (acceptances: Record<string, unknown>) => ({ review: {
    applicationId: 'a-1', pharmacyId: 'p-1', status: 'submitted', stepsCompleted: [], submittedAt: null, reviewNote: null,
    pharmacy: { name: 'Strive Pharmacy' }, ordering: { method: 'fax', faxNumber: '+15125550199' }, adapter: { required: false, configuredAt: null },
    acceptances, catalog: { choice: 'skipped', rowCount: null, warnings: [], rows: [] }, events: [],
    licenses: [{ state: 'TX', licenseNumber: 'TX-1', expiresOn: '2027-06-30', sterileCompounding: true, verificationStatus: 'verified', verificationNote: null, verifiedAt: null, documentUrl: null }],
  } })

  it('shows both acceptances with signer, title, version, time and the hash prefix', async () => {
    fetchMock.mockResolvedValue(reply(review({
      baa:   acc({ title: 'Business Associate Agreement', templateVersion: 'v0.1.1', hashPrefix: 'b26c8364eaa6' }),
      terms: acc({ title: 'Pharmacy Terms of Service', hashPrefix: '0123456789ab', signerName: 'Sam Lee', signerTitle: 'Owner' }),
    })))
    render(<PharmacyApplicationReview applicationId="a-1" />)
    const section = within(await screen.findByRole('region', { name: 'Agreements' }))
    const baa = section.getByRole('heading', { name: 'BAA' }).closest('div')!
    expect(baa).toHaveTextContent('Dana Ruiz'); expect(baa).toHaveTextContent('PIC'); expect(baa).toHaveTextContent('v0.1.1'); expect(baa).toHaveTextContent('b26c8364eaa6')
    const terms = section.getByRole('heading', { name: 'Terms of service' }).closest('div')!
    expect(terms).toHaveTextContent('Sam Lee'); expect(terms).toHaveTextContent('Owner'); expect(terms).toHaveTextContent('v0.1'); expect(terms).toHaveTextContent('0123456789ab')
    expect(screen.getByRole('button', { name: /^approve$/i })).toBeEnabled()
  })

  it('approve waits for the terms', async () => {
    fetchMock.mockResolvedValue(reply(review({ baa: acc({ title: 'Business Associate Agreement' }), terms: null })))
    render(<PharmacyApplicationReview applicationId="a-1" />)
    expect(await screen.findByRole('button', { name: /^approve$/i })).toBeDisabled()
    expect(within(screen.getByRole('region', { name: 'Agreements' })).getByText(/Pharmacy Terms of Service: not accepted/)).toBeInTheDocument()
  })
})

describe('/pharmacy/agreements', () => {
  const agreements = [
    { key: 'baa' as const, title: 'Business Associate Agreement', currentVersion: 'v0.1.1', acceptedCurrent: false, newVersionAvailable: true,
      acceptances: [{ acceptanceId: 'acc-old', version: 'v0.1', signerName: 'Dana Ruiz', signerTitle: 'PIC', acceptedAt: '2026-10-09T09:00:00.000Z', current: false }] },
    { key: 'pharmacy_terms' as const, title: 'Pharmacy Terms of Service', currentVersion: 'v0.1', acceptedCurrent: true, newVersionAvailable: false,
      acceptances: [{ acceptanceId: 'acc-terms', version: 'v0.1', signerName: 'Dana Ruiz', signerTitle: 'PIC', acceptedAt: '2026-10-10T09:00:00.000Z', current: true }] },
  ]

  it('lists title, version, signer and date, each with a link to the text accepted', () => {
    render(<AgreementsList agreements={agreements} />)
    const table = within(screen.getByRole('table', { name: 'Accepted agreements' }))
    const rows = table.getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Business Associate Agreement'); expect(rows[0]).toHaveTextContent('v0.1'); expect(rows[0]).toHaveTextContent('Dana Ruiz')
    expect(within(rows[0]!).getByRole('link', { name: /view text.*Business Associate Agreement v0\.1/i })).toHaveAttribute('href', '/pharmacy/agreements/acc-old')
    expect(within(rows[1]!).getByRole('link', { name: /view text.*Pharmacy Terms of Service v0\.1/i })).toHaveAttribute('href', '/pharmacy/agreements/acc-terms')
  })

  it('a newer version: "A new version is available" with review and accept; nothing for one that is current', () => {
    render(<AgreementsList agreements={agreements} />)
    const notice = screen.getByRole('status')
    expect(notice).toHaveTextContent('A new version is available')
    expect(notice).toHaveTextContent('Business Associate Agreement')
    expect(within(notice).getByRole('link', { name: /review and accept.*Business Associate Agreement v0\.1\.1/i })).toHaveAttribute('href', '/pharmacy/agreements/review/baa')
    expect(screen.queryByRole('link', { name: /review and accept.*Pharmacy Terms/i })).toBeNull()
  })
})
