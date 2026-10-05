/**
 * Prod, Menopause BHRT: editing protocol lines one after another on the
 * price step.
 *
 * Saving one line's edit navigates to the next line still owed a price
 * (WO-108 nextAfterReprice). That is the same route, /new-prescription/
 * margin, with new search params, so the price step's component is kept
 * and only its props change. Its state (the sig above all) was seeded
 * from the FIRST line's props and never reset: DHEA's "Take one capsule
 * by mouth each morning with food." was saved as Progesterone's "Take 1
 * capsule oral at bedtime". Each line must keep its own sig, and its
 * pharmacy and shipping must survive the edit.
 */

import { act, fireEvent, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { PrescriptionSessionProvider, usePrescriptionSession, type SessionPrescription } from '../../../_context/prescription-session'
import { MarginBuilderForm } from '../margin-builder-form'
import { STANDARD_CLINICAL_DIFFERENCE_OPTIONS, defaultRxDetails, type PackageOption } from '@/lib/orders/rx-details'
import { computeBundleShipping } from '@/lib/orders/shipping'

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), refresh: jest.fn() }),
}))

const STORAGE_KEY = 'compoundiq-rx-session'
const PORTAL_PLUS = 'pharmacy-portal-plus'
const PORTAL_PLUS_RATES = { pharmacyId: PORTAL_PLUS, pharmacyName: 'Portal Plus Pharmacy', standardCents: 1100, coldChainCents: 2500, freeShippingThresholdCents: null }

const PATIENT = {
  patient_id: '11111111-1111-4111-8111-111111111111',
  first_name: 'Alex', last_name: 'Demo', date_of_birth: '1975-06-15',
  phone: '+15125550000', state: 'TX', sms_opt_in: true,
}
const PROVIDER = {
  provider_id: '22222222-2222-4222-8222-222222222222',
  first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', signature_hash: null,
}

const CAPS_30 = (id: string, price: number): PackageOption[] => [
  { id, label: '30 caps', qty: 30, unit: 'capsule', wholesalePrice: price, isDefault: true },
]

const PROGESTERONE_SIG = 'Take 1 capsule oral at bedtime'
const DHEA_SIG = 'Take one capsule by mouth each morning with food.'

function line(id: string, medicationName: string, formulationId: string, sigText: string, wholesaleCents: number): SessionPrescription {
  return {
    id, pharmacyId: PORTAL_PLUS, pharmacyName: 'Portal Plus Pharmacy', itemId: null, formulationId,
    medicationName, form: 'Capsule', dose: '1 capsule', wholesaleCents, deaSchedule: null,
    retailCents: Math.round(wholesaleCents * 1.4), sigText, integrationTier: 'TIER_2_PORTAL',
    frequencyCode: 'QD', quantityLabel: '30 caps', repriceRequired: true,
    rxDetails: { ...defaultRxDetails(null), shippingType: 'standard', daysSupply: 30, dispenseQuantity: 30, dispenseUnit: 'capsule' },
    protocolId: 'protocol-bhrt', protocolName: 'Menopause Foundation — BHRT',
  }
}

const LINES = [
  line('line-progesterone', 'Progesterone 100 mg Capsule', 'f-progesterone', PROGESTERONE_SIG, 1850),
  line('line-dhea', 'DHEA 10 mg Capsule', 'f-dhea', DHEA_SIG, 1500),
]

const DEFAULTS = (formulationId: string) => ({
  formulationId,
  defaults: {
    default_syringe_option: 'none' as const,
    default_shipping_type: 'standard' as const,
    clinical_difference_options: [...STANDARD_CLINICAL_DIFFERENCE_OPTIONS],
    requires_clinical_difference: false,
  },
  deaSchedule: null,
  suggestedDiagnosis: null,
})

/** The props the margin page renders for one session line (repriceHref). */
function propsFor(rx: SessionPrescription, packages: PackageOption[]): React.ComponentProps<typeof MarginBuilderForm> {
  return {
    pharmacyId: rx.pharmacyId,
    itemId: null,
    formulationId: rx.formulationId,
    pharmacyName: rx.pharmacyName,
    medicationName: rx.medicationName,
    form: rx.form,
    dose: rx.dose,
    wholesalePrice: rx.wholesaleCents / 100,
    deaSchedule: 0,
    defaultMarkupPct: 40,
    presetSigText: rx.sigText,
    presetFrequency: 'QD',
    presetQuantity: '30 caps',
    presetDose: rx.dose,
    presetDurationDays: 30,
    presetRefills: 0,
    packages,
    shippingRates: PORTAL_PLUS_RATES,
    formulationDetails: { concentrationValue: null, concentrationUnit: null, dosageFormName: 'Capsule' },
    rxDefaults: DEFAULTS(rx.formulationId as string),
    editTarget: { kind: 'session', lineId: rx.id },
  }
}

/** The latest session, written after each render (never during it). */
const latest: { session: ReturnType<typeof usePrescriptionSession> | null } = { session: null }
function SessionProbe() {
  const current = usePrescriptionSession()
  useEffect(() => { latest.session = current })
  return null
}

beforeEach(() => {
  sessionStorage.clear()
  mockPush.mockReset()
  latest.session = null
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ patient: PATIENT, provider: PROVIDER, prescriptions: LINES, notices: [] }))
})

function tree(props: React.ComponentProps<typeof MarginBuilderForm>) {
  return (
    <PrescriptionSessionProvider>
      <SessionProbe />
      <MarginBuilderForm {...props} />
    </PrescriptionSessionProvider>
  )
}

async function save() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Save Changes — Back to Review/ }))
  })
}

describe('price step: one edit after another (same route, new line)', () => {
  it('the next line opens with its own sig, not the line just saved', async () => {
    const view = render(tree(propsFor(LINES[0]!, CAPS_30('pkg-prog-30', 18.5))))
    expect(screen.getByLabelText(/Directions|Sig/i)).toHaveValue(PROGESTERONE_SIG)
    await save()
    expect(mockPush).toHaveBeenLastCalledWith(expect.stringContaining('editId=line-dhea'))

    // nextAfterReprice → same route, DHEA's props.
    view.rerender(tree(propsFor(LINES[1]!, CAPS_30('pkg-dhea-30', 15))))
    expect(screen.getByLabelText(/Directions|Sig/i)).toHaveValue(DHEA_SIG)
  })

  it('each line keeps its own sig, pharmacy and shipping after both are saved', async () => {
    const view = render(tree(propsFor(LINES[0]!, CAPS_30('pkg-prog-30', 18.5))))
    await save()
    view.rerender(tree(propsFor(LINES[1]!, CAPS_30('pkg-dhea-30', 15))))
    await save()

    const byId = new Map(latest.session!.prescriptions.map(rx => [rx.id, rx]))
    expect(byId.get('line-progesterone')!.sigText).toBe(PROGESTERONE_SIG)
    expect(byId.get('line-dhea')!.sigText).toBe(DHEA_SIG)
    for (const rx of latest.session!.prescriptions) {
      expect(rx.pharmacyId).toBe(PORTAL_PLUS)
      expect(rx.pharmacyName).toBe('Portal Plus Pharmacy')
    }

    // Review's shipping: Portal Plus once, $11.00 — not a nameless $0.00 per line.
    const shipping = computeBundleShipping(
      latest.session!.prescriptions.map(rx => ({ pharmacyId: rx.pharmacyId, shippingType: rx.rxDetails?.shippingType ?? null, wholesaleCents: rx.wholesaleCents })),
      [PORTAL_PLUS_RATES],
    )
    expect(shipping.byPharmacy).toEqual([expect.objectContaining({ pharmacyName: 'Portal Plus Pharmacy', feeCents: 1100, itemCount: 2 })])
  })
})
