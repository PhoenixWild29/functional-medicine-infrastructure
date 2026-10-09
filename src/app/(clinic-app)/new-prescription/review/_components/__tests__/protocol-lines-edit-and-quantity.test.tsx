/**
 * Prod (bcd935e), 2026-10-05, dr.chen with patient Demo Alex. Three
 * protocol-line bugs, each reproduced here with the real Review card, the
 * real builder and the real price step (APIs mocked).
 *
 * 1. Edit on a protocol line at Review. Mold/MCAS Ketotifen, "Take 1
 *    capsule by mouth four times daily with meals and at bedtime", 8-week
 *    (56-day) protocol: Review sizes it 224 caps = 8 × 30 caps at $176,
 *    retail $30.80 × 8 = $246.40. Edit reopened the builder with the sig
 *    rewritten ("Take 1 capsule oral four times daily at bedtime") and no
 *    duration, so the price step sized 7 days / one 30-cap bottle at $22
 *    and kept $246.40 against it (high-markup warning). Edit must keep the
 *    line's own sig, the protocol length, the package and the retail, and
 *    saving with no changes must leave the line as Review had it.
 *
 * 2. Mold/MCAS LDN Oral Solution titrates 0.1 mL up to 0.5 mL ("Titrate
 *    up by 0.1mL every 3-4 days as tolerated up to 0.5mL"), but Review
 *    dispensed 5.6 mL (0.1 × 56). A titrating line is sized for its
 *    schedule over the protocol length: structured steps when the line
 *    has them; otherwise the schedule in its directions, with the
 *    assumption on screen.
 *
 * 3. Weight Loss BPC-157 Injectable 5mg (1 mg/mL, sold as a 5 mg vial),
 *    300 mcg daily × 84 days, read "dispense 25.2 mL (6 × 5 mg vials)".
 *    The vials are counted in mg, so the dispense is 25.2 mg — on Review,
 *    in the Rx details, and in what is stored for the Rx document and the
 *    pharmacy payload.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect } from 'react'
import { PrescriptionSessionProvider, usePrescriptionSession, type SessionPrescription } from '../../../_context/prescription-session'
import { BatchReviewForm, orderPostBody } from '../batch-review-form'
import { CascadingPrescriptionBuilder } from '../../../_components/cascading-prescription-builder'
import { MarginBuilderForm } from '../../../margin/_components/margin-builder-form'
import { editTargetFromParams } from '../../../_lib/edit-target'
import { isSigMode, parseTitrationSteps, type TitrationStep } from '@/lib/orders/titration'
import { formatDispenseWithPackage, type PackageOption } from '@/lib/orders/rx-details'
import { rxDetailPayloadFields } from '@/lib/adapters/transformers'
import type { RxFormulationDefaults } from '@/lib/orders/rx-defaults-loader'

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), refresh: jest.fn() }),
}))
jest.mock('@sentry/nextjs', () => ({ addBreadcrumb: jest.fn() }))
jest.mock('react-signature-canvas', () => {
  const React = jest.requireActual('react')
  return {
    __esModule: true,
    default: React.forwardRef(function FakeCanvas(_props: unknown, ref: React.Ref<unknown>) {
      React.useImperativeHandle(ref, () => ({ toData: () => [], getCanvas: () => ({ getBoundingClientRect: () => ({ width: 300 }) }), isEmpty: () => true, clear: () => {}, toDataURL: () => '' }))
      return React.createElement('canvas', { 'aria-label': 'Provider signature pad' })
    }),
  }
})
jest.mock('../../../_components/drug-interaction-alerts', () => ({ DrugInteractionAlerts: () => null }))

const STORAGE_KEY = 'compoundiq-rx-session'
const PATIENT = {
  patient_id: '11111111-1111-4111-8111-111111111111',
  first_name: 'Alex', last_name: 'Demo', date_of_birth: '1985-06-15', phone: '+15125550000', state: 'TX', sms_opt_in: true,
  allergies: [], nkda: true, allergies_updated_at: '2026-09-01T00:00:00Z',
}
const PROVIDER = { provider_id: '22222222-2222-4222-8222-222222222222', first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', signature_hash: null }
const PHARMACY = { pharmacyId: 'pharmacy-portal-plus', pharmacyName: 'Portal Plus Pharmacy' }
const RATES = { ...PHARMACY, standardCents: 1100, coldChainCents: 2500, freeShippingThresholdCents: null }
const MARKUP = 40

interface Med {
  id: string
  name: string
  form: string
  route: { name: string; abbreviation: string; sig_prefix: string }
  concentrationValue: number | null
  concentrationUnit: string | null
  packages: PackageOption[]
}

const ORAL = { name: 'Oral', abbreviation: 'PO', sig_prefix: 'Take' }
const SUBQ = { name: 'Subcutaneous', abbreviation: 'SC', sig_prefix: 'Inject' }

// Prod catalog (compoundiq-catalog-seed-v1.csv) at Portal Plus.
const KETO: Med = {
  id: 'f-keto', name: 'Ketotifen 1mg Capsule', form: 'Capsule', route: ORAL, concentrationValue: null, concentrationUnit: null,
  packages: [{ id: 'keto-30', label: '30 caps', qty: 30, unit: 'capsule', wholesalePrice: 22, isDefault: true }],
}
const LDN: Med = {
  id: 'f-ldn', name: 'LDN 1mg/mL Oral Solution', form: 'Oral Solution', route: ORAL, concentrationValue: 1, concentrationUnit: 'mg/mL',
  packages: [{ id: 'ldn-30', label: '30 mL bottle', qty: 30, unit: 'mL', wholesalePrice: 30, isDefault: true }],
}
const BPC: Med = {
  id: 'f-bpc', name: 'BPC-157 Injectable 5mg', form: 'Injectable Solution', route: SUBQ, concentrationValue: 1, concentrationUnit: 'mg/mL',
  packages: [{ id: 'bpc-5mg', label: '5 mg vial', qty: 5, unit: 'mg', wholesalePrice: 62, isDefault: true }],
}
const MEDS = new Map([KETO, LDN, BPC].map(m => [m.id, m]))

const MOLD_MCAS   = { id: 'proto-mold-mcas', name: 'Mold/MCAS Support', weeks: 8 }
const WEIGHT_LOSS = { id: 'proto-weight-loss', name: 'Weight Loss Protocol', weeks: 12 }

const KETO_SIG = 'Take 1 capsule by mouth four times daily with meals and at bedtime'
const LDN_SIG = 'Take 0.1mL by mouth at bedtime. Titrate up by 0.1mL every 3-4 days as tolerated up to 0.5mL (0.5mg)'
const BPC_SIG = 'Inject 300mcg subcutaneous once daily for GI support'

/** A session line exactly as the protocol panel builds it (seed-favorites-protocols.ts). */
function protocolLine(
  protocol: { id: string; name: string; weeks: number },
  med: Med,
  item: { dose: string; frequencyCode: string; sigText: string; quantity: string },
  i: number,
  extra: Partial<SessionPrescription> = {},
): SessionPrescription {
  const wholesaleCents = Math.round(med.packages.find(p => p.isDefault)!.wholesalePrice * 100)
  return {
    id: `${protocol.id}-${i}`,
    ...PHARMACY,
    itemId: null,
    formulationId: med.id,
    medicationName: med.name,
    form: med.form,
    dose: item.dose,
    wholesaleCents,
    deaSchedule: null,
    retailCents: Math.round(wholesaleCents * (1 + MARKUP / 100)),
    sigText: item.sigText,
    integrationTier: 'TIER_2_PORTAL',
    protocolId: protocol.id,
    protocolName: protocol.name,
    frequencyCode: item.frequencyCode,
    quantityLabel: item.quantity,
    protocolDurationDays: protocol.weeks * 7,
    ...extra,
  }
}

const KETO_LINE = protocolLine(MOLD_MCAS, KETO, { dose: '1 capsule', frequencyCode: 'QID', sigText: KETO_SIG, quantity: '360 capsules' }, 0)
const LDN_LINE  = protocolLine(MOLD_MCAS, LDN,  { dose: '0.1 mL', frequencyCode: 'QHS', sigText: LDN_SIG, quantity: '60mL' }, 1)
const BPC_LINE  = protocolLine(WEIGHT_LOSS, BPC, { dose: '300 mcg', frequencyCode: 'QD', sigText: BPC_SIG, quantity: '5mL vial' }, 1)

const RX_DEFAULTS = (formulationId: string) => ({
  formulationId,
  defaults: { default_syringe_option: null, default_shipping_type: 'standard', clinical_difference_options: [], requires_clinical_difference: false },
  deaSchedule: null,
  suggestedDiagnosis: null,
})

function builderFormulation(m: Med) {
  return {
    formulation_id: m.id, name: m.name, concentration: null,
    concentration_value: m.concentrationValue, concentration_unit: m.concentrationUnit,
    excipient_base: null, is_combination: false, total_ingredients: 1, description: null,
    dosage_forms: { name: m.form, is_sterile: m.form.includes('Injectable'), requires_injection_supplies: m.form.includes('Injectable') },
    routes_of_administration: m.route,
    formulation_ingredients: [],
  }
}

function mockFetch() {
  global.fetch = jest.fn(async (input: unknown) => {
    const u = new URL(String(input), 'https://app.test')
    const res = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response
    if (u.pathname === '/api/pharmacies/shipping') return res({ rates: [RATES], absorbShipping: false })
    if (u.pathname.startsWith('/api/favorites') || u.pathname.startsWith('/api/protocols')) return res({ data: [] })
    const level = u.searchParams.get('level')
    if (level === 'rx_defaults') {
      const ids = (u.searchParams.get('ids') ?? '').split(',')
      return res({ data: Object.fromEntries(ids.map(id => {
        const m = MEDS.get(id)!
        return [id, { ...RX_DEFAULTS(id), dispenseInputs: { concentrationValue: m.concentrationValue, concentrationUnit: m.concentrationUnit, dosageFormName: m.form } }]
      })) })
    }
    if (level === 'formulation') {
      const m = MEDS.get(u.searchParams.get('formulation_id') ?? '')!
      return res({ data: {
        formulation: builderFormulation(m),
        salt_form: { salt_form_id: `sf-${m.id}`, salt_name: 'Base', abbreviation: null },
        ingredient: { ingredient_id: `ing-${m.id}`, common_name: m.name, therapeutic_category: 'Other', dea_schedule: null, fda_alert_status: null, fda_alert_message: null, description: null, compounding_status: 'approved_drug_component' },
      } })
    }
    if (level === 'pharmacy_options') {
      const m = MEDS.get(u.searchParams.get('formulation_id') ?? '')!
      return res({ data: [{
        pharmacy_formulation_id: `pf-${m.id}`, wholesale_price: m.packages.find(p => p.isDefault)!.wholesalePrice, estimated_turnaround_days: 5,
        pharmacies: { pharmacy_id: PHARMACY.pharmacyId, name: PHARMACY.pharmacyName, slug: 'portal-plus', integration_tier: 'TIER_2_PORTAL', fax_number: null, supports_real_time_status: false },
        packages: m.packages,
      }] })
    }
    return res({ data: [] })
  }) as unknown as typeof fetch
}

/** The latest session, written after each render (never during it). */
const latest: { session: ReturnType<typeof usePrescriptionSession> | null } = { session: null }
function SessionProbe() {
  const current = usePrescriptionSession()
  useEffect(() => { latest.session = current })
  return null
}

function seed(lines: SessionPrescription[]) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ patient: PATIENT, provider: PROVIDER, prescriptions: lines, notices: [] }))
}

function renderReview(lines: SessionPrescription[]) {
  seed(lines)
  return render(
    <PrescriptionSessionProvider>
      <SessionProbe />
      <BatchReviewForm isProvider />
    </PrescriptionSessionProvider>,
  )
}

/** Wait until the line is resolved (rules) and sizing has finished. */
async function settled() {
  await waitFor(() => {
    expect(latest.session!.prescriptions.length).toBeGreaterThan(0)
    for (const rx of latest.session!.prescriptions) expect(rx.rxRules).toBeTruthy()
  }, { timeout: 8000 })
  await act(async () => { await new Promise(r => setTimeout(r, 50)) })
}

/** The props the margin page renders for a builder link (margin/page.tsx). */
function priceStepProps(href: string, m: Med): React.ComponentProps<typeof MarginBuilderForm> {
  const p = new URL(href, 'https://app.test').searchParams
  const durationRaw = p.get('durationDays')
  const sigMode = isSigMode(p.get('sigMode')) ? p.get('sigMode') as 'standard' | 'titration' | 'cycling' : 'standard'
  const steps: TitrationStep[] = sigMode === 'titration' ? parseTitrationSteps(JSON.parse(p.get('titrationSteps') ?? '[]')) : []
  return {
    pharmacyId: p.get('pharmacyId') ?? '',
    itemId: null,
    formulationId: p.get('formulation_id'),
    pharmacyName: PHARMACY.pharmacyName,
    medicationName: m.name,
    form: m.form,
    dose: p.get('dose') ?? '',
    wholesalePrice: m.packages.find(pk => pk.isDefault)!.wholesalePrice,
    deaSchedule: 0,
    defaultMarkupPct: MARKUP,
    presetSigText: (p.get('sigText') ?? '').trim() || undefined,
    presetFrequency: p.get('frequency') || undefined,
    presetQuantity: p.get('quantity') || undefined,
    presetRefills: parseInt(p.get('refills') ?? '0', 10),
    presetDose: p.get('dose') || undefined,
    presetDurationDays: durationRaw === null ? undefined : (parseInt(durationRaw, 10) > 0 ? parseInt(durationRaw, 10) : null),
    presetTiming: p.get('timing') || undefined,
    presetSigMode: sigMode,
    presetTitrationSteps: steps,
    presetCycle: null,
    packages: m.packages,
    shippingRates: RATES,
    absorbShipping: false,
    formulationDetails: { concentrationValue: m.concentrationValue, concentrationUnit: m.concentrationUnit, dosageFormName: m.form },
    rxDefaults: RX_DEFAULTS(m.id) as unknown as RxFormulationDefaults,
    editTarget: editTargetFromParams(p),
  }
}

/** Review → Edit → builder → Continue → price step → Save Changes, nothing changed. */
async function editAndSaveUnchanged(rxBefore: SessionPrescription, m: Med) {
  // Builder, reopened for this line.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  const builder = render(
    <QueryClientProvider client={queryClient}>
      <PrescriptionSessionProvider>
        <CascadingPrescriptionBuilder editTarget={{ kind: 'session', lineId: rxBefore.id }} />
      </PrescriptionSessionProvider>
    </QueryClientProvider>,
  )
  const cont = await screen.findByRole('button', { name: 'Continue — Set Retail Price' }, { timeout: 5000 })
  await waitFor(() => expect(cont).toBeEnabled(), { timeout: 5000 })
  mockPush.mockClear()
  fireEvent.click(cont)
  const href = mockPush.mock.calls.at(-1)![0] as string
  builder.unmount()

  // Price step for that link.
  const price = render(
    <PrescriptionSessionProvider>
      <SessionProbe />
      <MarginBuilderForm {...priceStepProps(href, m)} />
    </PrescriptionSessionProvider>,
  )
  return { href, price }
}

async function saveChanges() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Save Changes — Back to Review/ }))
  })
}

/** What Review shows and what POST /api/orders is sent, for one line. */
function asReviewed(rx: SessionPrescription) {
  return {
    body: orderPostBody(rx, PATIENT, PROVIDER, rx.rxDetails!),
    shown: {
      sigText: rx.sigText, dose: rx.dose, retailCents: rx.retailCents, wholesaleCents: rx.wholesaleCents,
      packageId: rx.packageId ?? null, packageLabel: rx.packageLabel ?? null, packageCount: rx.packageCount ?? null,
      quantityLabel: rx.quantityLabel ?? null, priceNote: rx.priceNote ?? null, sizingNote: (rx as SessionPrescription & { sizingNote?: string | null }).sizingNote ?? null,
      protocolId: rx.protocolId ?? null, protocolDurationDays: rx.protocolDurationDays ?? null,
      pharmacyName: rx.pharmacyName, integrationTier: rx.integrationTier,
    },
  }
}

jest.setTimeout(30_000)
beforeEach(() => {
  sessionStorage.clear()
  latest.session = null
  mockPush.mockReset()
  mockFetch()
})

// ── 1. Edit round trip ─────────────────────────────────────────

describe('bug 1: Edit on a protocol line keeps the line as Review showed it', () => {
  it('Ketotifen: the builder sends the line\'s own sig and the 56-day protocol length', async () => {
    const review = renderReview([KETO_LINE])
    await settled()
    await waitFor(() => expect(latest.session!.prescriptions[0]!.packageCount).toBe(8))
    const reviewed = latest.session!.prescriptions[0]!
    expect(reviewed.wholesaleCents).toBe(17600)   // 8 × $22
    expect(reviewed.retailCents).toBe(24640)      // $30.80 × 8
    review.unmount()

    const { href } = await editAndSaveUnchanged(reviewed, KETO)
    const p = new URL(href, 'https://app.test').searchParams
    expect(p.get('sigText')).toBe(KETO_SIG)
    expect(p.get('durationDays')).toBe('56')
  })

  it('Ketotifen: the price step shows 8 × 30 caps at $176.00 and $246.40 retail, with no high-markup warning', async () => {
    const review = renderReview([KETO_LINE])
    await settled()
    await waitFor(() => expect(latest.session!.prescriptions[0]!.packageCount).toBe(8))
    const reviewed = latest.session!.prescriptions[0]!
    review.unmount()

    await editAndSaveUnchanged(reviewed, KETO)
    expect(screen.getByLabelText(/Retail Price/)).toHaveValue(246.4)
    expect(screen.getByTestId('package-summary')).toHaveTextContent('8 × 30 caps')
    expect(screen.getByTestId('package-price')).toHaveTextContent('$176.00')
    expect(screen.getByTestId('days-supply-value')).toHaveTextContent('56')
    expect(screen.queryByText(/High markup warning/)).toBeNull()
    expect(screen.getByLabelText(/Directions|Sig/i)).toHaveValue(KETO_SIG)
  })

  it.each([
    ['Ketotifen (re-sized to 8 × 30 caps)', KETO_LINE, KETO],
    ['LDN (titrating, one bottle)', LDN_LINE, LDN],
    ['BPC-157 (mg vials)', BPC_LINE, BPC],
  ])('%s: saving with no changes leaves the line identical', async (_name, line, med) => {
    const review = renderReview([line])
    await settled()
    const before = asReviewed(latest.session!.prescriptions[0]!)
    review.unmount()

    await editAndSaveUnchanged(latest.session!.prescriptions[0]!, med)
    await saveChanges()
    expect(mockPush).toHaveBeenLastCalledWith('/new-prescription/review')
    const after = asReviewed(latest.session!.prescriptions[0]!)
    expect(after.shown).toEqual(before.shown)
    expect(after.body).toEqual(before.body)
  })
})

// ── 2. Titration quantity ──────────────────────────────────────

describe('bug 2: a titrating protocol line is sized for its titration over the protocol length', () => {
  it('LDN from its directions: 0.1 mL up 0.1 mL every 3 days to 0.5 mL, then 0.5 mL to day 56 = 25 mL, not 5.6 mL', async () => {
    renderReview([LDN_LINE])
    await settled()
    const rx = latest.session!.prescriptions[0]!
    expect(rx.rxDetails?.daysSupply).toBe(56)
    expect(rx.rxDetails?.dispenseQuantity).toBe(25)
    expect(rx.rxDetails?.dispenseUnit).toBe('mL')
    expect(screen.getByTestId(`rx-details-${rx.id}`)).toHaveTextContent('dispense 25 mL')
  })

  it('LDN: the provider sees the assumption the quantity was sized on', async () => {
    renderReview([LDN_LINE])
    await settled()
    const rx = latest.session!.prescriptions[0]!
    const note = screen.getByTestId(`sizing-note-${rx.id}`)
    expect(note).toHaveTextContent('0.1 mL, up 0.1 mL every 3 days to 0.5 mL, then 0.5 mL to day 56: 25 mL')
    expect(note).toHaveTextContent('Every 3-4 days is counted as every 3 days, so the patient does not run short')
  })

  it('structured titration steps win over the directions', async () => {
    const steps: TitrationStep[] = [
      { dose: '0.1', unit: 'mL', frequency: 'QHS', weeks: 1 },
      { dose: '0.2', unit: 'mL', frequency: 'QHS', weeks: 1 },
      { dose: '0.3', unit: 'mL', frequency: 'QHS', weeks: 1 },
      { dose: '0.5', unit: 'mL', frequency: 'QHS', weeks: 5 },
    ]
    renderReview([{ ...LDN_LINE, sigMode: 'titration', titrationSteps: steps }])
    await settled()
    const rx = latest.session!.prescriptions[0]!
    expect(rx.rxDetails?.daysSupply).toBe(56)
    expect(rx.rxDetails?.dispenseQuantity).toBe(21.7)   // 0.7 + 1.4 + 2.1 + 17.5
    expect(screen.queryByTestId(`sizing-note-${rx.id}`)).toBeNull()
  })

  it('a standard protocol line carries no sizing note', async () => {
    renderReview([KETO_LINE])
    await settled()
    expect(screen.queryByTestId(`sizing-note-${KETO_LINE.id}`)).toBeNull()
  })
})

// ── 3. Unit of a mg-measured vial ──────────────────────────────

describe('bug 3: BPC-157 sold in 5 mg vials is dispensed in mg', () => {
  it('Review: 25.2 mg (6 × 5 mg vials), never 25.2 mL', async () => {
    renderReview([BPC_LINE])
    await settled()
    await waitFor(() => expect(latest.session!.prescriptions[0]!.packageCount).toBe(6))
    const rx = latest.session!.prescriptions[0]!
    expect(rx.rxDetails?.daysSupply).toBe(84)
    expect(rx.rxDetails?.dispenseQuantity).toBe(25.2)
    expect(rx.rxDetails?.dispenseUnit).toBe('mg')
    expect(screen.getByTestId(`rx-details-${rx.id}`)).toHaveTextContent('dispense 25.2 mg (6 × 5 mg vials)')
    expect(screen.getByTestId(`rx-details-${rx.id}`)).not.toHaveTextContent('mL')
  })

  it('what is stored for the Rx document and the pharmacy payload is in mg', async () => {
    renderReview([BPC_LINE])
    await settled()
    await waitFor(() => expect(latest.session!.prescriptions[0]!.packageCount).toBe(6))
    const rx = latest.session!.prescriptions[0]!
    const body = orderPostBody(rx, PATIENT, PROVIDER, rx.rxDetails!)
    expect(body.rxDetails.dispenseUnit).toBe('mg')
    expect(body.rxDetails.dispenseQuantity).toBe(25.2)
    // The Rx PDF and the portal payload print the stored columns.
    expect(formatDispenseWithPackage(body.rxDetails.dispenseQuantity, body.rxDetails.dispenseUnit, rx.packageLabel, rx.packageCount))
      .toBe('25.2 mg (6 × 5 mg vials)')
    expect(rxDetailPayloadFields({ dispense_quantity: body.rxDetails.dispenseQuantity, dispense_unit: body.rxDetails.dispenseUnit }).dispenseUnit).toBe('mg')
  })

  it('the price step shows the dispense in mg too', async () => {
    const review = renderReview([BPC_LINE])
    await settled()
    await waitFor(() => expect(latest.session!.prescriptions[0]!.packageCount).toBe(6))
    const reviewed = latest.session!.prescriptions[0]!
    review.unmount()

    await editAndSaveUnchanged(reviewed, BPC)
    expect(screen.getByTestId('dispense-value')).toHaveTextContent('25.2 mg')
  })
})
