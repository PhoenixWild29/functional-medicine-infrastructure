/**
 * @jest-environment jsdom
 *
 * /get-started: sign up without an invite. Three choices, each with one
 * line on what happens next; then the form for that choice. On success the
 * page signs in and goes where the server says (the app under the banner,
 * the clinic wizard, or the pharmacy wizard). Plain language, no em
 * dashes, no promise of an email or a text. axe clean. /login links here.
 */

import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { configureAxe } from 'jest-axe'

const pushMock = jest.fn()
const refreshMock = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock, replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
const navigateFullyMock = jest.fn()
jest.mock('@/lib/auth/full-navigation', () => ({
  ...jest.requireActual('@/lib/auth/full-navigation'),
  navigateFully: (path: string) => navigateFullyMock(path),
}))
const signInMock = jest.fn()
jest.mock('@/lib/supabase/client', () => ({ createBrowserClient: () => ({ auth: { signInWithPassword: signInMock } }) }))

import { GetStartedForm } from '../_components/get-started-form'
import LoginPage from '@/app/login/page'

const axe = configureAxe({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })
const fetchMock = jest.fn()
const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body })

beforeEach(() => {
  pushMock.mockClear(); refreshMock.mockClear(); navigateFullyMock.mockClear()
  signInMock.mockReset().mockResolvedValue({ data: {}, error: null })
  fetchMock.mockReset().mockResolvedValue(reply(201, { email: 'dana@example.test', next: '/dashboard' }))
  global.fetch = fetchMock as unknown as typeof fetch
})

const choose = (name: RegExp) => fireEvent.click(screen.getByRole('radio', { name }))
const type = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

function fillCommon() {
  type('First name', 'Dana')
  type('Last name', 'Ruiz')
  type('Email', 'dana@example.test')
  type('Password', 'a long passphrase 42')
  type('Confirm password', 'a long passphrase 42')
}

describe('the three choices', () => {
  it('each says what happens next, in plain words', () => {
    render(<GetStartedForm />)
    expect(screen.getByRole('heading', { level: 1, name: 'Get started with CompoundIQ' })).toBeInTheDocument()
    const group = screen.getByRole('radiogroup', { name: 'What are you setting up?' })
    const radios = within(group).getAllByRole('radio')
    expect(radios.map(r => r.getAttribute('aria-label') ?? (r as HTMLInputElement).labels?.[0]?.textContent)).toHaveLength(3)
    expect(screen.getByRole('radio', { name: /I'm a provider \(solo practice\)/ })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /I run a clinic or practice/ })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /I run a compounding pharmacy/ })).toBeInTheDocument()
    // One line each on what happens next (tied to the choice).
    for (const r of radios) expect(r).toHaveAccessibleDescription(/approve/i)
  })

  it('no em dashes, and no promise of an email or a text anywhere on the page', () => {
    const { container } = render(<GetStartedForm />)
    for (const name of [/solo practice/, /clinic or practice/, /compounding pharmacy/]) {
      choose(name)
      expect(container.textContent).not.toMatch(/—/)
      expect(container.textContent).not.toMatch(/we('ll| will) (email|text|send)|check your (email|inbox)|confirmation email/i)
    }
  })
})

describe('a solo provider', () => {
  it('collects NPI, state licenses with expiry and an optional DEA; posts them; signs in and goes on', async () => {
    render(<GetStartedForm />)
    choose(/solo practice/)
    fillCommon()
    type('Practice name', 'Ruiz Family Medicine')
    type('NPI', '1234567893')
    fireEvent.change(screen.getByLabelText('License 1 state'), { target: { value: 'TX' } })
    type('License 1 number', 'TX-MD-1234')
    type('License 1 expires', '2099-06-30')
    fireEvent.click(screen.getByRole('button', { name: 'Add another state license' }))
    fireEvent.change(screen.getByLabelText('License 2 state'), { target: { value: 'OK' } })
    type('License 2 number', 'OK-5678')
    type('License 2 expires', '2099-01-31')
    expect(screen.getByLabelText(/DEA number/)).not.toBeRequired()
    type(/DEA number/, 'BR1234563')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create account' })) })

    expect(fetchMock).toHaveBeenCalledWith('/api/signup', expect.objectContaining({ method: 'POST' }))
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body) as Record<string, unknown>
    expect(body).toEqual({
      kind: 'solo_provider', firstName: 'Dana', lastName: 'Ruiz', email: 'dana@example.test', password: 'a long passphrase 42',
      organizationName: 'Ruiz Family Medicine', npiNumber: '1234567893', deaNumber: 'BR1234563', website: '',
      licenses: [{ state: 'TX', licenseNumber: 'TX-MD-1234', expiresOn: '2099-06-30' }, { state: 'OK', licenseNumber: 'OK-5678', expiresOn: '2099-01-31' }],
    })
    expect(signInMock).toHaveBeenCalledWith({ email: 'dana@example.test', password: 'a long passphrase 42' })
    expect(navigateFullyMock).toHaveBeenCalledWith('/dashboard')
  })

  it("the server's field errors show on their fields (a license's expiry)", async () => {
    fetchMock.mockResolvedValue(reply(400, { error: 'Check the highlighted fields.', errors: { 'licenses.0.expiresOn': 'This license has already expired.' } }))
    render(<GetStartedForm />)
    choose(/solo practice/)
    fillCommon()
    type('Practice name', 'Ruiz Family Medicine')
    type('NPI', '1234567893')
    fireEvent.change(screen.getByLabelText('License 1 state'), { target: { value: 'TX' } })
    type('License 1 number', 'TX-1')
    type('License 1 expires', '2020-01-01')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create account' })) })
    expect(screen.getByLabelText('License 1 expires')).toHaveAccessibleDescription(/already expired/)
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0)
    expect(signInMock).not.toHaveBeenCalled()
  })
})

describe('a clinic and a pharmacy', () => {
  it('a clinic: no provider fields; goes to the clinic wizard', async () => {
    fetchMock.mockResolvedValue(reply(201, { email: 'dana@example.test', next: '/onboarding' }))
    render(<GetStartedForm />)
    choose(/clinic or practice/)
    expect(screen.queryByLabelText('NPI')).toBeNull()
    fillCommon()
    type('Clinic or practice name', 'Sunrise Functional Medicine')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create account' })) })
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body)).toEqual(expect.objectContaining({ kind: 'clinic', organizationName: 'Sunrise Functional Medicine' }))
    expect(navigateFullyMock).toHaveBeenCalledWith('/onboarding')
  })

  it('a pharmacy: says two-step verification is set up at first sign-in; goes to the pharmacy wizard', async () => {
    fetchMock.mockResolvedValue(reply(201, { email: 'dana@example.test', next: '/pharmacy/onboarding' }))
    render(<GetStartedForm />)
    choose(/compounding pharmacy/)
    expect(screen.getByText(/two-step verification/i)).toBeInTheDocument()
    fillCommon()
    type('Pharmacy name', 'Strive Compounding')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create account' })) })
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body)).toEqual(expect.objectContaining({ kind: 'pharmacy', organizationName: 'Strive Compounding' }))
    expect(navigateFullyMock).toHaveBeenCalledWith('/pharmacy/onboarding')
  })
})

describe('checks before sending', () => {
  it('a password under 12 characters, or one that does not match, is caught on the page', async () => {
    render(<GetStartedForm />)
    choose(/clinic or practice/)
    fillCommon()
    type('Password', 'short')
    type('Clinic or practice name', 'Sunrise')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create account' })) })
    expect(screen.getByLabelText('Password')).toHaveAccessibleDescription(/at least 12 characters/i)
    expect(screen.getByLabelText('Confirm password')).toHaveAccessibleDescription(/do not match/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a duplicate email: the neutral message, nothing else', async () => {
    fetchMock.mockResolvedValue(reply(409, { error: 'We could not create an account with these details. If you already have an account, sign in instead.' }))
    render(<GetStartedForm />)
    choose(/clinic or practice/)
    fillCommon()
    type('Clinic or practice name', 'Sunrise')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create account' })) })
    expect(screen.getByRole('alert')).toHaveTextContent('We could not create an account with these details. If you already have an account, sign in instead.')
    expect(signInMock).not.toHaveBeenCalled()
  })
})

describe('honeypot', () => {
  it('is in the form for bots but hidden from people and from assistive technology', () => {
    const { container } = render(<GetStartedForm />)
    choose(/clinic or practice/)
    const trap = container.querySelector('input[name="website"]') as HTMLInputElement
    expect(trap).not.toBeNull()
    expect(trap.tabIndex).toBe(-1)
    expect(trap.closest('[aria-hidden="true"]')).not.toBeNull()
  })
})

describe('accessibility', () => {
  it.each([/solo practice/, /clinic or practice/, /compounding pharmacy/])('axe clean (%s)', async name => {
    const { container } = render(<main><GetStartedForm /></main>)
    choose(name)
    expect((await axe(container)).violations).toEqual([])
  })
})

describe('/login', () => {
  it('has a clear secondary link to /get-started', () => {
    render(<LoginPage />)
    expect(screen.getByRole('link', { name: 'New to CompoundIQ? Get started' })).toHaveAttribute('href', '/get-started')
  })
})
