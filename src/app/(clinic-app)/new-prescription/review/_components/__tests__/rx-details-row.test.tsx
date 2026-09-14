/**
 * WO-96 Rx details on the Review card.
 *
 * Acceptance criteria pinned here:
 *   - Review card shows "Rx details" collapsed; expanding shows every
 *     field pre-filled.
 *   - Testosterone Cypionate (Schedule III) cannot be sent without a
 *     diagnosis; the row auto-expands with the diagnosis field focused.
 *   - Semaglutide (requires_clinical_difference) cannot be sent without a
 *     clinical difference; the picklist is pre-selected with the first
 *     option, so it sends with zero typing.
 *   - BPC-157 (non-GLP-1, non-controlled) sends with zero interaction
 *     with the Rx details row.
 *   - Lines that entered the session without rules (protocol quick-load,
 *     pre-WO-96 sessions) are resolved from /api/formulations?level=
 *     rx_defaults and then behave like margin-built lines.
 *   - Every POST /api/orders carries rxDetails.
 */

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { PrescriptionSessionProvider } from '../../../_context/prescription-session'
import { BatchReviewForm } from '../batch-review-form'
import { defaultRxDetails, STANDARD_CLINICAL_DIFFERENCE_OPTIONS } from '@/lib/orders/rx-details'

// WO-102: the Review page also looks up shipping rates (GET
// /api/pharmacies/shipping) and allocates shipping on send (POST
// /api/orders/shipping). These tests are about the other calls.
const SHIPPING_URL = /\/api\/(pharmacies|orders)\/shipping/
function nonShippingCalls(): unknown[][] {
  return (global.fetch as jest.Mock).mock.calls.filter(c => !SHIPPING_URL.test(String(c[0])))
}


const mockPush = jest.fn()
const mockReplace = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, refresh: jest.fn() }),
}))
jest.mock('@sentry/nextjs', () => ({ addBreadcrumb: jest.fn() }))
jest.mock('react-signature-canvas', () => {
  const React = jest.requireActual('react')
  return {
    __esModule: true,
    default: React.forwardRef(function FakeCanvas(_props: unknown, ref: React.Ref<unknown>) {
      React.useImperativeHandle(ref, () => ({
        isEmpty: () => true,
        clear: () => {},
        toDataURL: () => 'data:image/png;base64,' + 'A'.repeat(6000),
      }))
      return React.createElement('canvas', { 'aria-label': 'Provider signature pad' })
    }),
  }
})
jest.mock('../../../_components/drug-interaction-alerts', () => ({ DrugInteractionAlerts: () => null }))
jest.mock('../../../_components/epcs-totp-gate', () => ({ EpcsTotpGate: () => null }))

const STORAGE_KEY = 'compoundiq-rx-session'

const PATIENT = {
  patient_id: '11111111-1111-4111-8111-111111111111',
  first_name: 'Alex',
  last_name: 'Demo',
  date_of_birth: '1985-06-15',
  phone: '+15125550000',
  state: 'TX',
  sms_opt_in: true,
}
const PROVIDER = {
  provider_id: '22222222-2222-4222-8222-222222222222',
  first_name: 'Sarah',
  last_name: 'Chen',
  npi_number: '1234567890',
  signature_hash: null,
}

const GLP1_DEFAULTS = {
  default_syringe_option: 'sc_kit' as const,
  default_shipping_type: 'cold_chain' as const,
  clinical_difference_options: [...STANDARD_CLINICAL_DIFFERENCE_OPTIONS],
  requires_clinical_difference: true,
}
const PLAIN_DEFAULTS = {
  default_syringe_option: 'sc_kit' as const,
  default_shipping_type: 'standard' as const,
  clinical_difference_options: [],
  requires_clinical_difference: false,
}

function line(overrides: Record<string, unknown>) {
  return {
    id: 'line-' + Math.random().toString(36).slice(2, 8),
    pharmacyId: 'pharmacy-strive',
    pharmacyName: 'Strive Pharmacy',
    itemId: null,
    formulationId: 'formulation-x',
    medicationName: 'Medication',
    form: 'Injectable Solution',
    dose: '10 units',
    wholesaleCents: 9500,
    deaSchedule: null,
    retailCents: 19000,
    sigText: 'Inject 10 units (0.10mL / 0.50mg) subcutaneously once weekly',
    integrationTier: '',
    ...overrides,
  }
}

const BPC157 = line({
  id: 'line-bpc',
  formulationId: 'formulation-bpc',
  medicationName: 'BPC-157 5mg/mL Injectable',
  rxDetails: defaultRxDetails(PLAIN_DEFAULTS, { derived: { daysSupply: 350, dispenseQuantity: 5, dispenseUnit: 'mL' } }),
  rxRules: { isControlled: false, requiresClinicalDifference: false, clinicalDifferenceOptions: [] },
})

const TESTOSTERONE = line({
  id: 'line-test',
  formulationId: 'formulation-test',
  medicationName: 'Testosterone Cypionate 200mg/mL Injectable',
  deaSchedule: 3,
  rxDetails: defaultRxDetails({ ...PLAIN_DEFAULTS, default_syringe_option: 'im_kit' }),
  rxRules: { isControlled: true, requiresClinicalDifference: false, clinicalDifferenceOptions: [] },
})

const SEMAGLUTIDE = line({
  id: 'line-sema',
  formulationId: 'formulation-sema',
  medicationName: 'Semaglutide 5mg/mL Injectable',
  rxDetails: defaultRxDetails(GLP1_DEFAULTS, { derived: { daysSupply: 350, dispenseQuantity: 5, dispenseUnit: 'mL' } }),
  rxRules: { isControlled: false, requiresClinicalDifference: true, clinicalDifferenceOptions: [...STANDARD_CLINICAL_DIFFERENCE_OPTIONS] },
})

function seedSession(prescriptions: unknown[]) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ patient: PATIENT, provider: PROVIDER, prescriptions, notices: [] }))
}

function renderReview(isProvider = true) {
  return render(
    <PrescriptionSessionProvider>
      <BatchReviewForm isProvider={isProvider} />
    </PrescriptionSessionProvider>,
  )
}

function rowFor(lineId: string) {
  return screen.getByTestId(`rx-details-${lineId}`)
}

beforeEach(() => {
  sessionStorage.clear()
  mockPush.mockReset()
  mockReplace.mockReset()
  global.fetch = jest.fn() as unknown as typeof fetch
})

describe('Rx details row — BPC-157 (no rule applies)', () => {
  it('renders collapsed, needs no interaction, and asks only for a signature', async () => {
    seedSession([BPC157])
    renderReview()

    const row = await screen.findByTestId('rx-details-line-bpc')
    expect(row).toHaveAttribute('data-expanded', 'false')
    expect(within(row).getByText('Rx details')).toBeInTheDocument()
    // Summary reflects the pre-filled values without opening the row.
    expect(within(row).getByText(/350-day supply · dispense 5 mL · 0 refills · substitution OK · SubQ syringe kit · Standard/)).toBeInTheDocument()

    // Nothing to resolve — the line already carries its rules.
    expect(nonShippingCalls()).toHaveLength(0)

    // The only thing standing between the provider and Send is the signature.
    expect(screen.getByText(/Sign in the signature box above to enable sending/)).toBeInTheDocument()
  })

  it('expanding shows every field pre-filled', async () => {
    seedSession([BPC157])
    renderReview()
    const row = await screen.findByTestId('rx-details-line-bpc')

    fireEvent.click(within(row).getByRole('button', { name: /Rx details/ }))
    expect(row).toHaveAttribute('data-expanded', 'true')

    expect(within(row).getByLabelText('Refills')).toHaveValue('0')
    expect(within(row).getByLabelText(/Allowed/)).toBeChecked()
    expect(within(row).getByLabelText('Syringe option')).toHaveValue('sc_kit')
    expect(within(row).getByLabelText('Shipping')).toHaveValue('standard')
    expect(within(row).getByLabelText(/Clinical difference \(optional\)/)).toHaveValue('')
    expect(within(row).getByLabelText(/Diagnosis code/)).toHaveValue('')
    expect(within(row).getByLabelText(/Special instructions/)).toHaveValue('')
    expect(within(row).getByText('350 days')).toBeInTheDocument()
    expect(within(row).getByText('5 mL')).toBeInTheDocument()
  })
})

describe('Rx details row — Testosterone Cypionate (controlled → diagnosis)', () => {
  it('auto-expands with the diagnosis field focused and blocks sending until a diagnosis is entered', async () => {
    seedSession([TESTOSTERONE])
    renderReview()

    const row = await screen.findByTestId('rx-details-line-test')
    expect(row).toHaveAttribute('data-expanded', 'true')
    const dxCode = within(row).getByLabelText(/Diagnosis code \(required\)/)
    await waitFor(() => expect(dxCode).toHaveFocus())
    expect(within(row).getByRole('alert')).toHaveTextContent(/A diagnosis is required for a controlled substance/)

    // Send is blocked with a reason that names the line and the field.
    const send = screen.getByRole('button', { name: /Sign & Send/ })
    expect(send).toBeDisabled()
    expect(screen.getByText(/Testosterone Cypionate 200mg\/mL Injectable needs a diagnosis \(controlled substance\)/)).toBeInTheDocument()

    fireEvent.change(dxCode, { target: { value: 'E29.1' } })

    // The rule is satisfied; only the signature remains.
    await waitFor(() => {
      expect(screen.getByText(/Sign in the signature box above to enable sending/)).toBeInTheDocument()
    })
    expect(within(row).queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('Rx details row — Semaglutide (requires clinical difference)', () => {
  it('auto-expands with the picklist pre-selected on the first option and does not block sending', async () => {
    seedSession([SEMAGLUTIDE])
    renderReview()

    const row = await screen.findByTestId('rx-details-line-sema')
    expect(row).toHaveAttribute('data-expanded', 'true')
    const select = within(row).getByLabelText(/Clinical difference \(required\)/)
    expect(select).toHaveValue(STANDARD_CLINICAL_DIFFERENCE_OPTIONS[0])
    expect(within(row).getByLabelText('Shipping')).toHaveValue('cold_chain')
    expect(within(row).queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText(/Sign in the signature box above to enable sending/)).toBeInTheDocument()
  })

  it('clearing the clinical difference blocks sending until one is chosen again', async () => {
    seedSession([SEMAGLUTIDE])
    renderReview()
    const row = await screen.findByTestId('rx-details-line-sema')
    const select = within(row).getByLabelText(/Clinical difference \(required\)/)

    fireEvent.change(select, { target: { value: '' } })
    await waitFor(() => {
      expect(screen.getByText(/Semaglutide 5mg\/mL Injectable needs a clinical difference statement/)).toBeInTheDocument()
    })
    expect(select).toHaveAttribute('aria-invalid', 'true')

    fireEvent.change(select, { target: { value: STANDARD_CLINICAL_DIFFERENCE_OPTIONS[2] } })
    await waitFor(() => {
      expect(screen.getByText(/Sign in the signature box above to enable sending/)).toBeInTheDocument()
    })
  })
})

describe('Rx details row — lines without rules resolve from /api/formulations', () => {
  it('fetches rx_defaults for unresolved formulation lines and applies defaults + rules', async () => {
    const unresolved = line({ id: 'line-proto', formulationId: 'formulation-sema', medicationName: 'Semaglutide (protocol)', protocolId: 'protocol-1' })
    seedSession([unresolved, BPC157])
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        level: 'rx_defaults',
        data: {
          'formulation-sema': {
            formulationId: 'formulation-sema',
            defaults: GLP1_DEFAULTS,
            deaSchedule: null,
            suggestedDiagnosis: { code: 'E66.9', text: 'Obesity, unspecified' },
          },
        },
      }),
    })
    renderReview()

    const row = await screen.findByTestId('rx-details-line-proto')
    await waitFor(() => expect(row).toHaveAttribute('data-expanded', 'true'))

    // Only the unresolved line's formulation was requested.
    expect(nonShippingCalls()).toHaveLength(1)
    const url = String(nonShippingCalls()[0]![0])
    expect(url).toContain('level=rx_defaults')
    expect(url).toContain(encodeURIComponent('formulation-sema'))
    expect(url).not.toContain('formulation-bpc')

    expect(within(row).getByLabelText(/Clinical difference \(required\)/)).toHaveValue(STANDARD_CLINICAL_DIFFERENCE_OPTIONS[0])
    expect(within(row).getByLabelText('Shipping')).toHaveValue('cold_chain')
    expect(within(row).getByLabelText(/Diagnosis code/)).toHaveValue('E66.9')
  })
})

describe('Save as Draft (non-provider) carries rxDetails', () => {
  it('posts the per-line details and blocks while a rule-required field is empty', async () => {
    seedSession([TESTOSTERONE, BPC157])
    renderReview(false)

    const draftButton = await screen.findByRole('button', { name: /Save as Draft/ })
    expect(draftButton).toBeDisabled()
    expect(screen.getByText(/Complete Rx details to enable saving drafts: Testosterone Cypionate 200mg\/mL Injectable needs a diagnosis/)).toBeInTheDocument()

    const row = rowFor('line-test')
    fireEvent.change(within(row).getByLabelText(/Diagnosis code/), { target: { value: 'E29.1' } })
    fireEvent.change(within(row).getByLabelText('Refills'), { target: { value: '2' } })
    await waitFor(() => expect(draftButton).toBeEnabled())

    ;(global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({ orderId: 'order-1' }) })
    fireEvent.click(draftButton)

    await waitFor(() => expect(nonShippingCalls()).toHaveLength(2))
    const bodies = nonShippingCalls().map(c => JSON.parse((c[1] as RequestInit).body as string))
    const testBody = bodies.find(b => b.formulationId === 'formulation-test')
    expect(testBody.rxDetails).toEqual(expect.objectContaining({
      refills: 2,
      substitutionAllowed: true,
      syringeOption: 'im_kit',
      shippingType: 'standard',
      diagnosisCode: 'E29.1',
    }))
    const bpcBody = bodies.find(b => b.formulationId === 'formulation-bpc')
    expect(bpcBody.rxDetails).toEqual(expect.objectContaining({
      daysSupply: 350,
      dispenseQuantity: 5,
      dispenseUnit: 'mL',
      syringeOption: 'sc_kit',
      shippingType: 'standard',
      clinicalDifference: null,
    }))
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/dashboard?draft=2'))
  })
})

// ============================================================
// WO-96 fix — quantity round-trips on the edit path
// ============================================================
// A draft saved from Review used to omit the builder inputs, so the
// order's medication_snapshot had no quantity_label and a reopened draft
// lost its quantity (dose and frequency survived only by re-parsing the
// sig). Both Review POSTs now send dose, frequencyCode and quantityLabel.

describe('WO-96 fix — Review POSTs carry dose, frequency and quantity', () => {
  const GLP1_LINE = line({
    id: 'line-rt',
    formulationId: 'formulation-sema',
    medicationName: 'Semaglutide 5mg/mL Injectable',
    dose: '10 units',
    frequencyCode: 'QW',
    quantityLabel: '1mL vial',
    sigText: 'Inject 10 units (0.10mL / 0.50mg) subcutaneous once weekly in the morning for 30 days',
    rxDetails: defaultRxDetails(PLAIN_DEFAULTS, { derived: { daysSupply: 30, dispenseQuantity: 0.4, dispenseUnit: 'mL' } }),
    rxRules: { isControlled: false, requiresClinicalDifference: false, clinicalDifferenceOptions: [] },
  })

  it('Save as Draft sends the line quantity with dose and frequency', async () => {
    seedSession([GLP1_LINE])
    renderReview(false)
    ;(global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({ orderId: 'order-1' }) })

    fireEvent.click(await screen.findByRole('button', { name: /Save as Draft/ }))
    await waitFor(() => expect(nonShippingCalls()).toHaveLength(1))
    const body = JSON.parse((nonShippingCalls()[0]![1] as RequestInit).body as string)
    expect(body).toEqual(expect.objectContaining({
      dose:          '10 units',
      frequencyCode: 'QW',
      quantityLabel: '1mL vial',
    }))
    expect(body.rxDetails).toEqual(expect.objectContaining({ daysSupply: 30, dispenseQuantity: 0.4, dispenseUnit: 'mL' }))
  })

  it('the Review card shows the derived values, not "—"', async () => {
    seedSession([GLP1_LINE])
    renderReview()
    const row = await screen.findByTestId('rx-details-line-rt')
    expect(within(row).getByText(/30-day supply · dispense 0.4 mL/)).toBeInTheDocument()
  })

  it('a quick-loaded line with no derived values is computed from its sig duration once defaults resolve', async () => {
    const unresolved = line({
      id: 'line-proto-rt',
      formulationId: 'formulation-sema',
      medicationName: 'Semaglutide (protocol)',
      dose: '10 units',
      frequencyCode: 'QW',
      sigText: 'Inject 10 units (0.10mL / 0.50mg) subcutaneous once weekly for 30 days',
    })
    seedSession([unresolved])
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          'formulation-sema': {
            formulationId: 'formulation-sema',
            defaults: PLAIN_DEFAULTS,
            deaSchedule: null,
            suggestedDiagnosis: null,
            dispenseInputs: { concentrationValue: 5, concentrationUnit: 'mg/mL', dosageFormName: 'Injectable Solution' },
          },
        },
      }),
    })
    renderReview()
    const row = await screen.findByTestId('rx-details-line-proto-rt')
    await waitFor(() => expect(within(row).getByText(/30-day supply · dispense 0.4 mL/)).toBeInTheDocument())
  })
})

// ============================================================
// WO-96 fix — structured dose / frequency / quantity in both POST bodies
// ============================================================
// Sign & Send and Save as Draft both build their body with orderPostBody,
// which sends the line's structured dose, frequencyCode and quantityLabel.
// A sig the provider edited by hand never changes what is stored.

describe('WO-96 fix — orderPostBody (Sign & Send and Save as Draft)', () => {
  const HAND_EDITED_DETAILS = defaultRxDetails(PLAIN_DEFAULTS, { derived: { daysSupply: 30, dispenseQuantity: 0.4, dispenseUnit: 'mL' } })
  const HAND_EDITED = line({
    id: 'line-hand-edited',
    formulationId: 'formulation-sema',
    medicationName: 'Semaglutide 5mg/mL Injectable',
    dose: '10 units',
    frequencyCode: 'QW',
    quantityLabel: '1mL vial',
    // Edited by hand on the price step: different dose, frequency and duration.
    sigText: 'Inject 20 units (0.20mL / 1.00mg) subcutaneously twice daily for 90 days',
    rxDetails: HAND_EDITED_DETAILS,
    rxRules: { isControlled: false, requiresClinicalDifference: false, clinicalDifferenceOptions: [] },
  })

  it('carries the structured dose, frequency and quantity, not values parsed from a hand-edited sig', async () => {
    const { orderPostBody } = await import('../batch-review-form')
    const body = orderPostBody(HAND_EDITED as never, PATIENT, PROVIDER, HAND_EDITED_DETAILS)
    expect(body).toEqual(expect.objectContaining({
      dose:          '10 units',
      frequencyCode: 'QW',
      quantityLabel: '1mL vial',
      sigText:       'Inject 20 units (0.20mL / 1.00mg) subcutaneously twice daily for 90 days',
    }))
  })

  it('falls back to the sig only for a legacy line with no structured values', async () => {
    const { orderPostBody } = await import('../batch-review-form')
    const legacy = { ...HAND_EDITED, dose: '', frequencyCode: null, quantityLabel: null }
    expect(orderPostBody(legacy as never, PATIENT, PROVIDER, HAND_EDITED_DETAILS)).toEqual(expect.objectContaining({
      dose: '20 units', frequencyCode: 'BID', quantityLabel: null,
    }))
  })

  it('Save as Draft sends the structured values for a line whose sig was hand-edited', async () => {
    seedSession([HAND_EDITED])
    renderReview(false)
    ;(global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({ orderId: 'order-1' }) })

    fireEvent.click(await screen.findByRole('button', { name: /Save as Draft/ }))
    await waitFor(() => expect(nonShippingCalls()).toHaveLength(1))
    const body = JSON.parse((nonShippingCalls()[0]![1] as RequestInit).body as string)
    expect(body).toEqual(expect.objectContaining({ dose: '10 units', frequencyCode: 'QW', quantityLabel: '1mL vial' }))
  })
})
