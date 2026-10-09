/**
 * Patient Intake PR 2: the intake page on the patient's phone.
 *
 *   1. Consent: the privacy (HIPAA) notice must be acknowledged; texts are
 *      optional, with the exact consent wording; the license scan's purpose
 *      and retention are explained.
 *   2. Your details: scan the license barcode in the browser (nothing is
 *      uploaded) or type them. A New Hampshire license is manual only:
 *      scanning is not offered, and a scanned NH barcode is discarded.
 *   3. Shipping address: filled from the scan, confirmed or edited.
 *   4. Allergies (or no known drug allergies) and current medications.
 *   5. Review and submit; then straight into payment when an order waits.
 *
 * Every step: one heading that takes focus, labelled fields, errors tied
 * to their field and announced, and no axe violations (WCAG 2.1 AA).
 */

import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { configureAxe } from 'jest-axe'

jest.mock('../_components/license-scanner', () => ({
  LicenseScanner: ({ onScanned, onCancel }: { onScanned: (raw: string) => void; onCancel: () => void }) => (
    <div>
      <button type="button" onClick={() => onScanned((globalThis as unknown as { __scan: string }).__scan)}>Simulate scan</button>
      <button type="button" onClick={onCancel}>Stop scanning</button>
    </div>
  ),
}))

import { IntakeFlow } from '../_components/intake-flow'
import { SMS_CONSENT_TEXT } from '@/lib/intake/consent'

const axe = configureAxe({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })
async function violations(): Promise<string[]> {
  const r = await axe(document.body)
  return r.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)
}

const TOKEN = 'A'.repeat(43)
function aamva(fields: Record<string, string>, iin = '636015') {
  return `@\n\u001e\rANSI ${iin}100102DL00410288ZT03290015DL` + Object.entries(fields).map(([k, v]) => `${k}${v}`).join('\n') + '\r'
}
const TX_LICENSE = aamva({ DCS: 'SMITH', DAC: 'JANE', DBB: '04151985', DBC: '2', DAG: '123 MAIN ST', DAI: 'AUSTIN', DAJ: 'TX', DAK: '787010000' })
const NH_LICENSE = aamva({ DCS: 'DOE', DAC: 'JOHN', DBB: '01021970', DBC: '1', DAG: '1 ELM ST', DAI: 'CONCORD', DAJ: 'NH', DAK: '033010000' }, '636039')

const fetchMock = jest.fn()
const assignMock = jest.fn()

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, checkoutUrl: null }) })
  global.fetch = fetchMock as unknown as typeof fetch
  ;(globalThis as unknown as { __scan: string }).__scan = TX_LICENSE
  assignMock.mockReset()
  Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, assign: assignMock } })
})

const click = async (name: string | RegExp) => { await act(async () => { fireEvent.click(screen.getByRole('button', { name })) }) }
const type = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

async function passConsent(sms = false) {
  fireEvent.click(screen.getByRole('checkbox', { name: /I have read the privacy notice/ }))
  if (sms) fireEvent.click(screen.getByRole('checkbox', { name: /text messages/i }))
  await click('Continue')
}

async function typeDetails() {
  await click('Type my details')
  type('First name', 'Jane')
  type('Last name', 'Smith')
  type('Date of birth', '1985-04-15')
  fireEvent.click(screen.getByRole('radio', { name: 'Female' }))
  await click('Continue')
}

async function fillAddress() {
  type('Street address', '123 Main St')
  type('City', 'Austin')
  fireEvent.change(screen.getByLabelText('State'), { target: { value: 'TX' } })
  type('ZIP code', '78701')
  await click('Continue')
}

async function fillHealth() {
  fireEvent.click(screen.getByRole('radio', { name: 'No known drug allergies' }))
  await click('Continue')
}

function renderFlow() {
  return render(<IntakeFlow token={TOKEN} clinicName="Test Clinic" />)
}

describe('1. consent', () => {
  it('names the clinic, explains the scan, and offers texts with the exact wording', async () => {
    renderFlow()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Complete your details')
    expect(screen.getByText(/Test Clinic/)).toBeInTheDocument()
    expect(screen.getByText(SMS_CONSENT_TEXT)).toBeInTheDocument()
    expect(screen.getByText(/barcode on the back of your license is read on this phone/i)).toBeInTheDocument()
    expect(screen.getByText(/nothing is uploaded/i)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /text messages/i })).not.toBeChecked()
    expect(await violations()).toEqual([])
  })

  it('the privacy notice is required: the error is announced and tied to it', async () => {
    renderFlow()
    await click('Continue')
    const box = screen.getByRole('checkbox', { name: /I have read the privacy notice/ })
    expect(box).toHaveAttribute('aria-invalid', 'true')
    expect(box).toHaveAccessibleDescription(/Please confirm you have read the privacy notice/)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(await violations()).toEqual([])
  })

  it('moves focus to the next step heading', async () => {
    renderFlow()
    await passConsent()
    expect(screen.getByRole('heading', { level: 2, name: 'Your details' })).toHaveFocus()
  })
})

describe('2. details', () => {
  it('typed details: name, date of birth and sex are required, each error tied to its field', async () => {
    renderFlow()
    await passConsent()
    await click('Type my details')
    await click('Continue')
    for (const label of ['First name', 'Last name', 'Date of birth']) {
      expect(screen.getByLabelText(label)).toHaveAttribute('aria-invalid', 'true')
    }
    expect(screen.getByRole('radiogroup', { name: 'Sex' })).toHaveAccessibleDescription(/Choose one/)
    expect(await violations()).toEqual([])
  })

  it('scan: fills name, date of birth, sex, and the address on the next step', async () => {
    renderFlow()
    await passConsent()
    await click('Scan my license')
    await click('Simulate scan')
    expect(screen.getByLabelText('First name')).toHaveValue('Jane')
    expect(screen.getByLabelText('Last name')).toHaveValue('Smith')
    expect(screen.getByLabelText('Date of birth')).toHaveValue('1985-04-15')
    expect(screen.getByRole('radio', { name: 'Female' })).toBeChecked()
    await click('Continue')
    expect(screen.getByLabelText('Street address')).toHaveValue('123 Main St')
    expect(screen.getByLabelText('City')).toHaveValue('Austin')
    expect(screen.getByLabelText('ZIP code')).toHaveValue('78701')
  })

  it('New Hampshire: no scan offered once the license state is NH', async () => {
    renderFlow()
    await passConsent()
    fireEvent.change(screen.getByLabelText('State that issued your license'), { target: { value: 'NH' } })
    expect(screen.queryByRole('button', { name: 'Scan my license' })).not.toBeInTheDocument()
    expect(screen.getByText(/New Hampshire licenses cannot be scanned/)).toBeInTheDocument()
    expect(await violations()).toEqual([])
  })

  it('New Hampshire: a scanned NH barcode is discarded, and the patient types instead', async () => {
    ;(globalThis as unknown as { __scan: string }).__scan = NH_LICENSE
    renderFlow()
    await passConsent()
    await click('Scan my license')
    await click('Simulate scan')
    expect(screen.getByRole('alert')).toHaveTextContent(/New Hampshire licenses cannot be scanned/)
    expect(screen.getByLabelText('First name')).toHaveValue('')
    expect(screen.getByLabelText('Last name')).toHaveValue('')
  })

  it('a barcode that is not a license says so; manual entry stays available', async () => {
    ;(globalThis as unknown as { __scan: string }).__scan = 'https://example.com'
    renderFlow()
    await passConsent()
    await click('Scan my license')
    await click('Simulate scan')
    expect(screen.getByRole('alert')).toHaveTextContent(/could not read that barcode/i)
    expect(screen.getByLabelText('First name')).toBeInTheDocument()
  })
})

describe('3–4. address and health', () => {
  it('address fields are required and tied to their errors', async () => {
    renderFlow()
    await passConsent()
    await typeDetails()
    await click('Continue')
    for (const label of ['Street address', 'City', 'State', 'ZIP code']) {
      expect(screen.getByLabelText(label)).toHaveAttribute('aria-invalid', 'true')
    }
    expect(await violations()).toEqual([])
  })

  it('allergies: choose NKDA or list them; listing none is an error', async () => {
    renderFlow()
    await passConsent()
    await typeDetails()
    await fillAddress()
    fireEvent.click(screen.getByRole('radio', { name: 'I have allergies' }))
    await click('Continue')
    expect(screen.getByLabelText('Your allergies, one per line')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Current medications (optional)')).toBeInTheDocument()
    expect(await violations()).toEqual([])
  })
})

describe('5. submit', () => {
  it('posts everything once; no order waiting: says the payment link will follow', async () => {
    renderFlow()
    await passConsent(true)
    await typeDetails()
    await fillAddress()
    type('Current medications (optional)', 'Levothyroxine 50 mcg daily')
    await fillHealth()
    expect(screen.getByRole('heading', { level: 2, name: 'Check and submit' })).toHaveFocus()
    expect(await violations()).toEqual([])
    await click('Submit')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]![0]).toBe(`/api/intake/${TOKEN}`)
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({
      consent: { privacyNotice: true, sms: true },
      details: { firstName: 'Jane', lastName: 'Smith', dateOfBirth: '1985-04-15', sex: 'female' },
      address: { line1: '123 Main St', line2: '', city: 'Austin', state: 'TX', zip: '78701' },
      health: { nkda: true, allergies: [], currentMedications: 'Levothyroxine 50 mcg daily' },
    })
    expect(screen.getByRole('heading', { level: 2, name: 'Thank you' })).toHaveFocus()
    expect(screen.getByText(/send you a link to pay/)).toBeInTheDocument()
    expect(assignMock).not.toHaveBeenCalled()
  })

  it('an order waiting: goes straight into payment', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, checkoutUrl: 'https://app.test/checkout/tok' }) })
    renderFlow()
    await passConsent()
    await typeDetails()
    await fillAddress()
    await fillHealth()
    await click('Submit')
    expect(assignMock).toHaveBeenCalledWith('https://app.test/checkout/tok')
    expect(screen.getByRole('link', { name: 'Continue to payment' })).toHaveAttribute('href', 'https://app.test/checkout/tok')
  })

  it('a used or expired link: says so, no retry loop', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 410, json: async () => ({ error: 'gone' }) })
    renderFlow()
    await passConsent()
    await typeDetails()
    await fillAddress()
    await fillHealth()
    await click('Submit')
    expect(screen.getByRole('alert')).toHaveTextContent(/link has expired or was already used/)
  })

  it('a server error keeps the answers and lets the patient try again', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: 'x' }) })
    renderFlow()
    await passConsent()
    await typeDetails()
    await fillAddress()
    await fillHealth()
    await click('Submit')
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(/could not be saved/)
    expect(within(document.body).getByRole('button', { name: 'Submit' })).toBeEnabled()
  })
})
