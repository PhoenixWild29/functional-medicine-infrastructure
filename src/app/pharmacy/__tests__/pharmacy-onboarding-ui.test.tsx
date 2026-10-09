/**
 * Pharmacy onboarding screens (WCAG 2.1 AA: every control labelled,
 * errors announced and tied to their field, current step marked).
 *
 *   - The invite page: full name, password and confirmation; a mismatch
 *     is caught before anything is sent; on success the new account signs
 *     in and goes to MFA enrollment, then the wizard.
 *   - The wizard: the steps in order with the current one marked
 *     (aria-current="step"); field errors from the server are shown on
 *     their fields (aria-invalid, aria-describedby) with an alert summary;
 *     the BAA and terms show the DRAFT banner and need the explicit yes;
 *     saved secrets are never shown and may be kept; submit is offered
 *     only when every step is done; a sent-back note is shown.
 *   - Ops: creating an invite shows the link once, with a copy button;
 *     the review cannot approve while a license is not verified, and a
 *     rejection needs a note.
 */

import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'

const push = jest.fn()
const refresh = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh, replace: jest.fn() }), usePathname: () => '/pharmacy/onboarding' }))
const signInWithPassword = jest.fn(async () => ({ data: {}, error: null }))
jest.mock('@/lib/supabase/client', () => ({ createBrowserClient: () => ({ auth: { signInWithPassword } }) }))

import { AcceptInviteForm } from '@/app/onboard/pharmacy/[token]/_components/accept-invite-form'
import { OnboardingWizard } from '@/app/pharmacy/onboarding/_components/onboarding-wizard'
import { PharmacyOnboardingSection } from '@/app/(ops-dashboard)/ops/onboarding/_components/pharmacy/pharmacy-onboarding-section'
import { PharmacyApplicationReview } from '@/app/(ops-dashboard)/ops/onboarding/_components/pharmacy/pharmacy-application-review'
import { AGREEMENT, agreementText, agreementTextSha256 } from '@/lib/pharmacy-onboarding/agreement'
import type { WizardState } from '@/lib/pharmacy-onboarding/application'

const fetchMock = jest.fn()
beforeEach(() => {
  fetchMock.mockReset()
  push.mockReset()
  signInWithPassword.mockClear()
  global.fetch = fetchMock as unknown as typeof fetch
})
const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as unknown as Response

function state(over: Partial<WizardState> = {}): WizardState {
  return {
    status: 'in_progress', stepsCompleted: [], reviewNote: null, submittedAt: null,
    pharmacy: { name: 'Strive Pharmacy', ship_carriers: [], ship_to_states: [] },
    licenses: [], ordering: null, catalog: { choice: null, rowCount: null, warnings: [] },
    agreement: { key: AGREEMENT.key, version: AGREEMENT.version, title: AGREEMENT.title, text: agreementText(), textSha256: agreementTextSha256(), banner: AGREEMENT.banner, draft: true, acceptance: null },
    ...over,
  }
}

describe('the invite page', () => {
  it('labelled fields; a password mismatch is caught before anything is sent', async () => {
    render(<AcceptInviteForm token="tok" pharmacyName="Strive Pharmacy" adminEmail="dana@strive.example" />)
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Dana Ruiz' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a long passphrase 42' } })
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'something else entirely' } })
    fireEvent.click(screen.getByRole('button', { name: /create account/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/do not match/i)
    expect(screen.getByLabelText('Confirm password')).toHaveAttribute('aria-invalid', 'true')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('creates the account, signs in, and goes to MFA enrollment then the wizard', async () => {
    fetchMock.mockResolvedValue(reply({ email: 'dana@strive.example' }))
    render(<AcceptInviteForm token="tok" pharmacyName="Strive Pharmacy" adminEmail="dana@strive.example" />)
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Dana Ruiz' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a long passphrase 42' } })
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'a long passphrase 42' } })
    fireEvent.click(screen.getByRole('button', { name: /create account/i }))
    await waitFor(() => expect(push).toHaveBeenCalledWith('/mfa/enroll?redirectTo=%2Fpharmacy%2Fonboarding'))
    expect(fetchMock).toHaveBeenCalledWith('/api/onboard/pharmacy/tok', expect.objectContaining({ method: 'POST', body: JSON.stringify({ fullName: 'Dana Ruiz', password: 'a long passphrase 42' }) }))
    expect(signInWithPassword).toHaveBeenCalledWith({ email: 'dana@strive.example', password: 'a long passphrase 42' })
  })

  it('a server refusal is shown on its field', async () => {
    fetchMock.mockResolvedValue(reply({ error: 'Check the highlighted fields.', errors: { password: 'Use at least 12 characters.' } }, 400))
    render(<AcceptInviteForm token="tok" pharmacyName="Strive Pharmacy" adminEmail="dana@strive.example" />)
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Dana Ruiz' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'short' } })
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'short' } })
    fireEvent.click(screen.getByRole('button', { name: /create account/i }))
    expect(await screen.findByText('Use at least 12 characters.')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Password').getAttribute('aria-describedby')).toContain('password-error')
  })
})

describe('the wizard', () => {
  it('lists the steps in order and marks the current one', () => {
    render(<OnboardingWizard initial={state({ stepsCompleted: ['details'] })} />)
    const nav = screen.getByRole('navigation', { name: /onboarding steps/i })
    const items = within(nav).getAllByRole('button')
    expect(items.map(b => b.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('Pharmacy details'), expect.stringContaining('Review and submit')]))
    expect(within(nav).getByRole('button', { current: 'step' })).toHaveTextContent('Facility type')
  })

  it('details: server errors appear on their fields, with an alert summary', async () => {
    fetchMock.mockResolvedValue(reply({ error: 'Check the highlighted fields.', errors: { npi: 'This one is not a valid NPI.' } }, 400))
    render(<OnboardingWizard initial={state()} />)
    fireEvent.click(screen.getByRole('button', { name: /save and continue/i }))
    expect(await screen.findByText('This one is not a valid NPI.')).toBeInTheDocument()
    expect(screen.getByLabelText('NPI')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent(/check the highlighted fields/i)
    expect(fetchMock).toHaveBeenCalledWith('/api/pharmacy/onboarding/details', expect.objectContaining({ method: 'PUT' }))
  })

  it('a save moves to the next step with the refreshed state', async () => {
    fetchMock
      .mockResolvedValueOnce(reply({}))
      .mockResolvedValueOnce(reply(state({ stepsCompleted: ['details'] })))
    render(<OnboardingWizard initial={state()} />)
    fireEvent.click(screen.getByRole('button', { name: /save and continue/i }))
    expect(await screen.findByRole('heading', { name: 'Facility type' })).toBeInTheDocument()
  })

  it('the BAA and terms: DRAFT banner, the text, and the explicit yes', async () => {
    render(<OnboardingWizard initial={state({ stepsCompleted: ['details', 'facility', 'licenses', 'ordering', 'shipping'] })} />)
    expect(screen.getByRole('heading', { name: 'BAA and terms' })).toBeInTheDocument()
    expect(screen.getByText('Draft, pending legal review')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /agreement text/i })).toHaveTextContent('Business Associate')
    fireEvent.change(screen.getByLabelText('Your full name'), { target: { value: 'Dana Ruiz' } })
    fireEvent.change(screen.getByLabelText('Your title'), { target: { value: 'PIC' } })
    expect(screen.getByRole('button', { name: /accept and continue/i })).toBeDisabled()
    fireEvent.click(screen.getByLabelText(/I have read and accept/i))
    fetchMock.mockResolvedValueOnce(reply({})).mockResolvedValueOnce(reply(state()))
    fireEvent.click(screen.getByRole('button', { name: /accept and continue/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/pharmacy/onboarding/agreement', expect.objectContaining({ method: 'POST' })))
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body)
    expect(body).toEqual({ signerName: 'Dana Ruiz', signerTitle: 'PIC', accept: true, templateVersion: AGREEMENT.version, textSha256: agreementTextSha256() })
  })

  it('ordering: saved secrets are not shown and may be kept', () => {
    render(<OnboardingWizard initial={state({ stepsCompleted: ['details', 'facility', 'licenses'], ordering: { method: 'portal', portalUrl: 'https://portal.strive.example', secretsStored: true } })} />)
    expect(screen.getByRole('heading', { name: 'How you receive orders' })).toBeInTheDocument()
    expect(screen.getByLabelText('Portal password')).toHaveValue('')
    expect(screen.getByText(/saved securely.*leave blank to keep/i)).toBeInTheDocument()
  })

  it('submit is offered only when every step is done', () => {
    const { unmount } = render(<OnboardingWizard initial={state({ stepsCompleted: ['details', 'facility', 'licenses', 'ordering', 'shipping', 'agreement'] })} />)
    fireEvent.click(screen.getByRole('button', { name: /Review and submit/ }))
    expect(screen.getByRole('button', { name: /submit for review/i })).toBeDisabled()
    unmount()
    render(<OnboardingWizard initial={state({ stepsCompleted: ['details', 'facility', 'licenses', 'ordering', 'shipping', 'agreement', 'catalog'] })} />)
    expect(screen.getByRole('button', { name: /submit for review/i })).toBeEnabled()
  })

  it('a sent-back application shows the note; a submitted one is read-only', () => {
    const { unmount } = render(<OnboardingWizard initial={state({ status: 'sent_back', reviewNote: 'Upload the CA license document.' })} />)
    expect(screen.getByRole('status')).toHaveTextContent('Upload the CA license document.')
    unmount()
    render(<OnboardingWizard initial={state({ status: 'submitted', submittedAt: '2026-10-09T12:00:00.000Z' })} />)
    expect(screen.getByRole('status')).toHaveTextContent(/submitted.*review/i)
    expect(screen.queryByRole('button', { name: /save and continue/i })).toBeNull()
  })
})

describe('ops', () => {
  it('creating an invite shows the link once, with a copy button', async () => {
    fetchMock
      .mockResolvedValueOnce(reply({ invites: [] }))
      .mockResolvedValueOnce(reply({ applications: [] }))
      .mockResolvedValueOnce(reply({ invite: { inviteId: 'i-1' }, link: 'https://app.example/onboard/pharmacy/tok' }))
      .mockResolvedValue(reply({ invites: [], applications: [] }))
    render(<PharmacyOnboardingSection />)
    fireEvent.change(await screen.findByLabelText('Pharmacy name'), { target: { value: 'Strive Pharmacy' } })
    fireEvent.change(screen.getByLabelText('Administrator email'), { target: { value: 'dana@strive.example' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /create invite/i })) })
    expect(await screen.findByDisplayValue('https://app.example/onboard/pharmacy/tok')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /copy link/i })).toBeInTheDocument()
    expect(screen.getByText(/shown once/i)).toBeInTheDocument()
  })

  it('the review: a portal pharmacy with every license verified still waits for its adapter', async () => {
    fetchMock.mockResolvedValue(reply({ review: {
      applicationId: 'a-1', pharmacyId: 'p-1', status: 'submitted', stepsCompleted: [], submittedAt: null, reviewNote: null,
      pharmacy: { name: 'Strive Pharmacy' }, ordering: { method: 'portal', portalUrl: 'https://portal.strive.example', secretsStored: true },
      adapter: { required: true, configuredAt: null },
      acceptance: { signerName: 'Dana', signerTitle: 'PIC', acceptedAt: '2026-10-08T00:00:00.000Z', templateVersion: 'v0.1', current: true },
      catalog: { choice: 'skipped', rowCount: null, warnings: [], rows: [] }, events: [],
      licenses: [{ state: 'TX', licenseNumber: 'TX-1', expiresOn: '2027-06-30', sterileCompounding: true, verificationStatus: 'verified', verificationNote: null, verifiedAt: null, documentUrl: null }],
    } }))
    render(<PharmacyApplicationReview applicationId="a-1" />)
    expect(await screen.findByRole('button', { name: /^approve$/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /mark adapter configured/i })).toBeEnabled()
    expect(screen.getByText(/adapter is not configured/i)).toBeInTheDocument()
  })

  it('the review: approve waits for every license; a rejection needs a note', async () => {
    fetchMock.mockResolvedValue(reply({ review: {
      applicationId: 'a-1', pharmacyId: 'p-1', status: 'submitted', stepsCompleted: [], submittedAt: null, reviewNote: null,
      pharmacy: { name: 'Strive Pharmacy' }, ordering: { method: 'fax', faxNumber: '+15125550199' }, adapter: { required: false, configuredAt: null }, acceptance: null,
      catalog: { choice: 'skipped', rowCount: null, warnings: [], rows: [] }, events: [],
      licenses: [{ state: 'TX', licenseNumber: 'TX-1', expiresOn: '2027-06-30', sterileCompounding: true, verificationStatus: 'pending', verificationNote: null, verifiedAt: null, documentUrl: 'https://storage.example/doc' }],
    } }))
    render(<PharmacyApplicationReview applicationId="a-1" />)
    expect(await screen.findByRole('button', { name: /approve/i })).toBeDisabled()
    expect(screen.getByRole('link', { name: /view TX license document/i })).toHaveAttribute('href', 'https://storage.example/doc')
    fireEvent.click(screen.getByRole('button', { name: /reject TX/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/note/i)
  })
})
