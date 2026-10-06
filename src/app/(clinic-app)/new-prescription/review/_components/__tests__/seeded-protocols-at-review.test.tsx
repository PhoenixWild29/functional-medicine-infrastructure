/**
 * Prod, before the run-through: every line of all 3 seeded protocols was
 * blocked at Review with "Priced below cost … cannot be sent".
 *
 * A protocol line's retail is the clinic markup on the pharmacy's
 * DEFAULT package price. Review then sized the line (#181) from its
 * stored quantity — "90 caps" for Progesterone — took 3 × 30 caps at
 * $55.50 wholesale and kept the $25.90 retail meant for one 30-cap
 * bottle: below cost, blocked.
 *
 * Two rules:
 *   1. A protocol line with no duration of its own is sized for the
 *      protocol's length (12 weeks = 84 days), not its stored quantity.
 *      Weight Loss Semaglutide 0.25 mg weekly × 12 weeks = 0.6 mL, so one
 *      1 mL vial at $95; its $133 retail stands.
 *   2. When Review sizes a protocol line to another package or count, the
 *      retail scales with the wholesale so the markup stays the same —
 *      saved retail × new wholesale ÷ saved wholesale, to the cent — with
 *      the note "Price updated for [new package] (was $X for [old
 *      package])". A scaled line is never blocked as below cost.
 *
 * Each seeded protocol is loaded as the protocol panel loads it (clinic
 * markup 40%) and no line may be blocked.
 */

import { render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { PrescriptionSessionProvider, usePrescriptionSession, type SessionPrescription } from '../../../_context/prescription-session'
import { BatchReviewForm } from '../batch-review-form'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
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
jest.mock('../../../_components/epcs-totp-gate', () => ({ EpcsTotpGate: () => null }))

const PATIENT = {
  patient_id: 'a3000000-0000-0000-0000-000000000004',
  first_name: 'Maya', last_name: 'Thompson', date_of_birth: '1979-11-02', phone: '+12125550111', state: 'TX', sms_opt_in: true,
  allergies: [], nkda: true, allergies_updated_at: '2026-09-01T00:00:00Z',
}
const PROVIDER = { provider_id: 'a2000000-0000-0000-0000-000000000001', first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', signature_hash: null }

type Pkg = { id: string; label: string; qty: number; unit: string; wholesalePrice: number; isDefault: boolean }
interface Formulation {
  id: string
  name: string
  form: string
  concentrationValue: number | null
  concentrationUnit: string | null
  packages: Pkg[]
}

const pkg = (id: string, label: string, qty: number, unit: string, wholesalePrice: number, isDefault = false): Pkg =>
  ({ id, label, qty, unit, wholesalePrice, isDefault })

// The pharmacies' packages; the default is what /api/protocols prices.
const F: Record<string, Formulation> = {
  sema:   { id: 'f-sema', name: 'Semaglutide 5mg/mL Injectable', form: 'Injectable Solution', concentrationValue: 5, concentrationUnit: 'mg/mL',
            packages: [pkg('sema-1', '1 mL vial', 1, 'mL', 95, true), pkg('sema-2.5', '2.5 mL vial', 2.5, 'mL', 165), pkg('sema-5', '5 mL vial', 5, 'mL', 285)] },
  bpc:    { id: 'f-bpc', name: 'BPC-157 5mg/mL Injectable', form: 'Injectable Solution', concentrationValue: 5, concentrationUnit: 'mg/mL',
            packages: [pkg('bpc-5', '5 mL vial', 5, 'mL', 62, true)] },
  lipo:   { id: 'f-lipo', name: 'Lipo-Mino Injectable', form: 'Injectable Solution', concentrationValue: null, concentrationUnit: null,
            packages: [pkg('lipo-30', '30 mL vial', 30, 'mL', 45, true)] },
  keto:   { id: 'f-keto', name: 'Ketotifen 1mg Capsule', form: 'Capsule', concentrationValue: null, concentrationUnit: null,
            packages: [pkg('keto-60', '60 caps', 60, 'capsule', 40, true)] },
  ldn:    { id: 'f-ldn', name: 'LDN 1mg/mL Oral Solution', form: 'Oral Solution', concentrationValue: 1, concentrationUnit: 'mg/mL',
            packages: [pkg('ldn-30', '30 mL bottle', 30, 'mL', 30, true)] },
  thymo:  { id: 'f-thymo', name: 'Thymosin Alpha-1 5mg/mL Injectable', form: 'Injectable Solution', concentrationValue: 5, concentrationUnit: 'mg/mL',
            packages: [pkg('thymo-5', '5 mL vial', 5, 'mL', 70, true)] },
  biest:  { id: 'f-biest', name: 'Biest 80/20 Topical Cream 2.5mg/g', form: 'Cream', concentrationValue: null, concentrationUnit: null,
            packages: [pkg('biest-30', '30 g', 30, 'g', 38, true)] },
  prog:   { id: 'f-prog', name: 'Progesterone Capsule 100mg', form: 'Capsule', concentrationValue: null, concentrationUnit: null,
            packages: [pkg('prog-30', '30 caps', 30, 'capsule', 18.5, true)] },
  dhea:   { id: 'f-dhea', name: 'DHEA Capsule 10mg', form: 'Capsule', concentrationValue: null, concentrationUnit: null,
            packages: [pkg('dhea-30', '30 caps', 30, 'capsule', 15, true)] },
}
const BY_ID = new Map(Object.values(F).map(f => [f.id, f]))

const MARKUP = 40
const PHARMACY = { pharmacyId: 'pharmacy-portal-plus', pharmacyName: 'Portal Plus Pharmacy' }

interface Item {
  f: Formulation
  dose: string
  frequencyCode: string
  sigText: string
  quantity: string
  cycle?: { onDays: number; offDays: number; lengthDays: number }
}

/** A session line exactly as the protocol panel builds it. */
function protocolLine(protocol: { id: string; name: string; weeks: number }, item: Item, i: number): SessionPrescription {
  const wholesaleCents = Math.round((item.f.packages.find(p => p.isDefault)!.wholesalePrice) * 100)
  return {
    id: `${protocol.id}-${i}`,
    ...PHARMACY,
    itemId: null,
    formulationId: item.f.id,
    medicationName: item.f.name,
    form: item.f.form,
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
    ...(item.cycle ? { sigMode: 'cycling' as const, cycle: item.cycle } : {}),
  } as SessionPrescription
}

const WEIGHT_LOSS = { id: 'proto-weight-loss', name: 'Weight Loss Protocol', weeks: 12 }
const MOLD_MCAS   = { id: 'proto-mold-mcas', name: 'Mold/MCAS Support', weeks: 8 }
const BHRT        = { id: 'proto-bhrt', name: 'Menopause Foundation — BHRT', weeks: 12 }

// scripts/seed-favorites-protocols.ts and scripts/demo-expansion-seed.sql.
const SEEDED: Array<[typeof WEIGHT_LOSS, Item[]]> = [
  [WEIGHT_LOSS, [
    { f: F.sema!, dose: '0.25 mg', frequencyCode: 'QW', quantity: '5mL vial',
      sigText: 'Inject 5 units (0.05mL / 0.25mg) subcutaneous once weekly. Titrate up by 0.25mg every 4 weeks as tolerated up to 2.5mg' },
    { f: F.bpc!, dose: '300 mcg', frequencyCode: 'QD', quantity: '5mL vial', sigText: 'Inject 300mcg subcutaneous once daily for GI support' },
    { f: F.lipo!, dose: '1 mL', frequencyCode: 'QOD', quantity: '30mL vial', sigText: 'Inject 1mL intramuscularly every other day' },
  ]],
  [MOLD_MCAS, [
    { f: F.keto!, dose: '1 capsule', frequencyCode: 'QID', quantity: '360 capsules', sigText: 'Take 1 capsule by mouth four times daily with meals and at bedtime' },
    { f: F.ldn!, dose: '0.1 mL', frequencyCode: 'QHS', quantity: '60mL',
      sigText: 'Take 0.1mL by mouth at bedtime. Titrate up by 0.1mL every 3-4 days as tolerated up to 0.5mL (0.5mg)' },
    { f: F.thymo!, dose: '1 mg', frequencyCode: 'QD', quantity: '5mL vial',
      sigText: 'Inject 1mg subcutaneous daily, 5 days on / 2 days off, for 6 weeks then reassess', cycle: { onDays: 5, offDays: 2, lengthDays: 42 } },
  ]],
  [BHRT, [
    { f: F.biest!, dose: '0.5 mL', frequencyCode: 'QHS', quantity: '30 g', sigText: 'Apply 0.5mL topically to inner wrist nightly.' },
    { f: F.prog!, dose: '1 capsule', frequencyCode: 'QHS', quantity: '90 caps', sigText: 'Take one capsule by mouth at bedtime.' },
    { f: F.dhea!, dose: '1 capsule', frequencyCode: 'QAM', quantity: '90 caps', sigText: 'Take one capsule by mouth each morning with food.' },
  ]],
]

function mockFetch() {
  global.fetch = jest.fn(async (url: unknown) => {
    const u = new URL(String(url), 'https://app.test')
    const res = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response
    if (u.searchParams.get('level') === 'rx_defaults') {
      const ids = (u.searchParams.get('ids') ?? '').split(',')
      return res({ data: Object.fromEntries(ids.map(id => {
        const f = BY_ID.get(id)!
        return [id, {
          formulationId: id,
          defaults: { default_syringe_option: null, default_shipping_type: 'standard', clinical_difference_options: [], requires_clinical_difference: false },
          deaSchedule: null, suggestedDiagnosis: null,
          dispenseInputs: { concentrationValue: f.concentrationValue, concentrationUnit: f.concentrationUnit, dosageFormName: f.form },
        }]
      })) })
    }
    if (u.searchParams.get('level') === 'pharmacy_options') {
      const f = BY_ID.get(u.searchParams.get('formulation_id') ?? '')!
      return res({ data: [{
        pharmacy_formulation_id: `pf-${f.id}`, wholesale_price: f.packages.find(p => p.isDefault)!.wholesalePrice,
        pharmacies: { pharmacy_id: PHARMACY.pharmacyId, name: PHARMACY.pharmacyName, integration_tier: 'TIER_2_PORTAL' },
        packages: f.packages,
      }] })
    }
    if (u.pathname === '/api/pharmacies/shipping') {
      return res({ rates: [{ ...PHARMACY, standardCents: 1100, coldChainCents: 2500, freeShippingThresholdCents: null }], absorbShipping: false })
    }
    return res({})
  }) as unknown as typeof fetch
}

/** The latest session, written after each render (never during it). */
const latest: { session: ReturnType<typeof usePrescriptionSession> | null } = { session: null }
function SessionProbe() {
  const current = usePrescriptionSession()
  useEffect(() => { latest.session = current })
  return null
}

function renderReview(lines: SessionPrescription[]) {
  sessionStorage.setItem('compoundiq-rx-session', JSON.stringify({ patient: PATIENT, provider: PROVIDER, prescriptions: lines, notices: [] }))
  return render(
    <PrescriptionSessionProvider>
      <SessionProbe />
      <BatchReviewForm isProvider />
    </PrescriptionSessionProvider>,
  )
}

/** Wait until every line has been resolved (rules) and sized. */
async function settled(count: number) {
  await waitFor(() => {
    expect(latest.session!.prescriptions).toHaveLength(count)
    for (const rx of latest.session!.prescriptions) expect(rx.rxRules).toBeTruthy()
  }, { timeout: 8000 })
  // Sizing runs after resolution; let its fetches finish.
  await new Promise(r => setTimeout(r, 50))
}

const BLOCK_TESTIDS = ['below-cost-', 'package-unit-mismatch-', 'reprice-required-', 'cycle-pattern-required-']

jest.setTimeout(20_000)
beforeEach(() => {
  sessionStorage.clear()
  latest.session = null
  mockFetch()
})

describe.each(SEEDED)('seeded protocol %o at Review', (protocol, items) => {
  it('no line is blocked, and every line is priced at or above its wholesale', async () => {
    renderReview(items.map((item, i) => protocolLine(protocol, item, i)))
    await settled(items.length)
    for (const rx of latest.session!.prescriptions) {
      for (const prefix of BLOCK_TESTIDS) expect(screen.queryByTestId(`${prefix}${rx.id}`)).toBeNull()
      expect(rx.retailCents).toBeGreaterThanOrEqual(rx.wholesaleCents)
      expect(rx.repriceRequired).not.toBe(true)
      expect(rx.packageUnitMismatch ?? null).toBeNull()
    }
    expect(screen.queryByText(/Edit the flagged prescriptions above to enable sending/)).toBeNull()
  })
})

describe('rule 1: a protocol line with no duration is sized for the protocol length', () => {
  // Was "0.25 mg weekly × 12 weeks = 0.6 mL, one 1 mL vial": that sized a
  // titration at its starting dose for all 12 weeks (the LDN 5.6 mL bug,
  // 2026-10-05). Its directions titrate up 0.25 mg every 4 weeks, so the
  // 12 weeks are 4 × 0.25 + 4 × 0.5 + 4 × 0.75 mg = 6 mg = 1.2 mL.
  it('Weight Loss Semaglutide titrating from 0.25 mg weekly × 12 weeks = 1.2 mL: one 2.5 mL vial at $165, retail scaled', async () => {
    renderReview([protocolLine(WEIGHT_LOSS, SEEDED[0]![1][0]!, 0)])
    await settled(1)
    await waitFor(() => expect(latest.session!.prescriptions[0]!.packageId).toBe('sema-2.5'))
    const rx = latest.session!.prescriptions[0]!
    expect(rx.rxDetails?.daysSupply).toBe(84)
    expect(rx.rxDetails?.dispenseQuantity).toBeCloseTo(1.2)
    expect(rx.rxDetails?.dispenseUnit).toBe('mL')
    expect(rx.wholesaleCents).toBe(16500)
    expect(rx.retailCents).toBe(23100)   // $133 × 165 ÷ 95
    expect(rx.priceNote).toBe('Price updated for 2.5 mL vial (was $133.00 for 1 mL vial)')
  })

  it('BHRT Progesterone 1 capsule nightly × 84 days, not its stored "90 caps"', async () => {
    renderReview([protocolLine(BHRT, SEEDED[2]![1][1]!, 1)])
    await settled(1)
    const rx = latest.session!.prescriptions[0]!
    expect(rx.rxDetails?.daysSupply).toBe(84)
    expect(rx.rxDetails?.dispenseQuantity).toBe(84)
  })
})

describe('rule 2: a re-sized protocol line keeps its markup', () => {
  it('BHRT Progesterone: 3 × 30 caps at $55.50 → retail $25.90 × 55.50 ÷ 18.50 = $77.70, with the note', async () => {
    renderReview([protocolLine(BHRT, SEEDED[2]![1][1]!, 1)])
    await settled(1)
    await waitFor(() => expect(latest.session!.prescriptions[0]!.packageCount).toBe(3))
    const rx = latest.session!.prescriptions[0]!
    expect(rx.wholesaleCents).toBe(5550)
    expect(rx.retailCents).toBe(7770)
    expect(rx.priceNote).toBe('Price updated for 3 × 30 caps (was $25.90 for 30 caps)')
    expect(await screen.findByText('Price updated for 3 × 30 caps (was $25.90 for 30 caps)')).toBeInTheDocument()
    expect(screen.queryByTestId(`below-cost-${rx.id}`)).toBeNull()
    expect(screen.queryByTestId(`reprice-required-${rx.id}`)).toBeNull()
  })
})
