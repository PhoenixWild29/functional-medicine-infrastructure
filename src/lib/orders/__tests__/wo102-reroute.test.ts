/**
 * @jest-environment node
 *
 * WO-102: the multi-pharmacy notice on Review, and the Stripe split.
 *
 *   - "2 pharmacies → 2 shipping charges ($X). Route all to Strive to save $Y"
 *   - offered only when every item is available at the target (offers come
 *     from pharmacy_options, already licensed in the patient's state)
 *   - a re-route that changes a medication price says so, with the net,
 *     before the provider clicks
 *   - never advertises a shipping saving a price increase wipes out
 */

import { multiPharmacyNotice, planReroute, type PharmacyOffer, type RerouteLine } from '../reroute'
import { ratesFromPharmacyRow, stripeSplit, type PharmacyShippingRates } from '../shipping'
import type { PackageOption } from '../rx-details'

const STRIVE = 'strive'
const QUICK_RX = 'quick-rx'

const RATES = new Map<string, PharmacyShippingRates>([
  [STRIVE,   ratesFromPharmacyRow({ pharmacy_id: STRIVE,   name: 'Strive Pharmacy',   shipping_fee_standard: 9,  shipping_fee_cold_chain: 22 })],
  [QUICK_RX, ratesFromPharmacyRow({ pharmacy_id: QUICK_RX, name: 'Quick Rx Pharmacy', shipping_fee_standard: 12, shipping_fee_cold_chain: 25 })],
])

const STRIVE_VIALS: PackageOption[] = [
  { id: 'pkg-1',   label: '1 mL vial',   qty: 1,   unit: 'mL', wholesalePrice: 95,  isDefault: true },
  { id: 'pkg-2.5', label: '2.5 mL vial', qty: 2.5, unit: 'mL', wholesalePrice: 165, isDefault: false },
  { id: 'pkg-5',   label: '5 mL vial',   qty: 5,   unit: 'mL', wholesalePrice: 285, isDefault: false },
]

function semaglutide(at: string, overrides: Partial<RerouteLine> = {}): RerouteLine {
  return {
    id: 'sema', medicationName: 'Semaglutide Injectable 5 mg/mL',
    pharmacyId: at, pharmacyName: at === STRIVE ? 'Strive Pharmacy' : 'Quick Rx Pharmacy',
    formulationId: 'f-sema', wholesaleCents: 9500, retailCents: 19000, shippingType: 'cold_chain',
    dispenseQuantity: 0.4, dispenseUnit: 'mL', dosageFormName: 'Injectable Solution',
    ...overrides,
  }
}
function bpc157(at: string, overrides: Partial<RerouteLine> = {}): RerouteLine {
  return {
    id: 'bpc', medicationName: 'BPC-157 Injectable',
    pharmacyId: at, pharmacyName: at === STRIVE ? 'Strive Pharmacy' : 'Quick Rx Pharmacy',
    formulationId: 'f-bpc', wholesaleCents: 6500, retailCents: 13000, shippingType: 'standard',
    ...overrides,
  }
}

const offer = (pharmacyId: string, wholesaleCents: number, packages: PackageOption[] = []): PharmacyOffer => ({
  pharmacyId, pharmacyName: pharmacyId === STRIVE ? 'Strive Pharmacy' : 'Quick Rx Pharmacy', integrationTier: null, wholesaleCents, packages,
})

describe('multiPharmacyNotice', () => {
  it('single pharmacy → no notice', () => {
    expect(multiPharmacyNotice([semaglutide(STRIVE), bpc157(STRIVE)], new Map(), RATES)).toBeNull()
  })

  it('spec scenario: Quick Rx (cold) + Strive (standard) = $34; route all to Strive saves $12 (Strive $22 once)', () => {
    const offers = new Map([
      ['sema', [offer(QUICK_RX, 9500), offer(STRIVE, 9500)]],
      ['bpc',  [offer(STRIVE, 6500)]],
    ])
    const n = multiPharmacyNotice([semaglutide(QUICK_RX), bpc157(STRIVE)], offers, RATES)!
    expect(n.message).toBe('2 pharmacies → 2 shipping charges ($34.00). Route all to Strive Pharmacy to save $12.00.')
    expect(n.offerReroute).toBe(true)
    expect(n.plan).toEqual(expect.objectContaining({
      targetPharmacyId: STRIVE, currentShippingCents: 3400, newShippingCents: 2200,
      shippingDeltaCents: -1200, medicationDeltaCents: 0, netDeltaCents: -1200,
    }))
  })

  it('not offered when an item is not available at the target (e.g. not licensed in the patient\'s state)', () => {
    // BPC-157 is only offered at Strive; Semaglutide is not offered at Strive.
    const offers = new Map([
      ['sema', [offer(QUICK_RX, 9500)]],
      ['bpc',  [offer(STRIVE, 6500)]],
    ])
    const n = multiPharmacyNotice([semaglutide(QUICK_RX), bpc157(STRIVE)], offers, RATES)!
    expect(n.message).toBe('2 pharmacies → 2 shipping charges ($34.00).')
    expect(n.offerReroute).toBe(false)
    expect(n.plan).toBeNull()
  })

  it('a re-route that changes a medication price names it and the net, and is offered only as a net saving', () => {
    // Strive sells Semaglutide for $100 (vs $95): retail keeps the markup, $190 → $200 (+$10); shipping saves $12 → net $2.
    const offers = new Map([
      ['sema', [offer(QUICK_RX, 9500), offer(STRIVE, 10000)]],
      ['bpc',  [offer(STRIVE, 6500)]],
    ])
    const n = multiPharmacyNotice([semaglutide(QUICK_RX), bpc157(STRIVE)], offers, RATES)!
    expect(n.message).toBe(
      '2 pharmacies → 2 shipping charges ($34.00). Route all to Strive Pharmacy: shipping saves $12.00, ' +
      'and medication prices rise $10.00 (Semaglutide Injectable 5 mg/mL $190.00 → $200.00). Net saving $2.00.',
    )
    expect(n.offerReroute).toBe(true)
  })

  it('never advertises a shipping saving that a larger price increase wipes out', () => {
    // 40 units weekly → 1.6 mL → Strive's 2.5 mL vial at $165 (vs $95): retail $190 → $330 (+$140) against $12 shipping.
    const offers = new Map([
      ['sema', [offer(QUICK_RX, 9500), offer(STRIVE, 9500, STRIVE_VIALS)]],
      ['bpc',  [offer(STRIVE, 6500)]],
    ])
    const n = multiPharmacyNotice([semaglutide(QUICK_RX, { dispenseQuantity: 1.6 }), bpc157(STRIVE)], offers, RATES)!
    expect(n.offerReroute).toBe(false)
    expect(n.message).toBe(
      '2 pharmacies → 2 shipping charges ($34.00). Routing all to Strive Pharmacy would save $12.00 on shipping, ' +
      'but medication prices would rise $140.00 (Semaglutide Injectable 5 mg/mL $190.00 → $330.00) — $128.00 more overall, so it is not suggested.',
    )
    expect(n.message).not.toMatch(/Route all to/)
  })

  it('picks the cheaper of the eligible pharmacies', () => {
    const offers = new Map([
      ['sema', [offer(QUICK_RX, 9500), offer(STRIVE, 9500)]],
      ['bpc',  [offer(STRIVE, 6500), offer(QUICK_RX, 6500)]],
    ])
    // All to Strive: $22 (save $12). All to Quick Rx: $25 (save $9).
    expect(multiPharmacyNotice([semaglutide(QUICK_RX), bpc157(STRIVE)], offers, RATES)!.plan!.targetPharmacyId).toBe(STRIVE)
  })

  it('legacy catalog items cannot be re-priced elsewhere', () => {
    const offers = new Map([['sema', [offer(STRIVE, 9500)]]])
    const legacy = bpc157(QUICK_RX, { formulationId: null })
    expect(planReroute([semaglutide(STRIVE), legacy], STRIVE, offers, RATES)).toBeNull()
  })
})

describe('planReroute — re-pricing a line at the target', () => {
  it('keeps the same package (label and count) when the target sells it', () => {
    const line = semaglutide(QUICK_RX, { packageId: 'q-5', packageLabel: '5 mL vial', packageCount: 2, wholesaleCents: 60000, retailCents: 120000 })
    const plan = planReroute([line, bpc157(STRIVE)], STRIVE, new Map([['sema', [offer(STRIVE, 9500, STRIVE_VIALS)]]]), RATES)!
    expect(plan.lines[0]).toEqual(expect.objectContaining({
      pharmacyId: STRIVE, packageId: 'pkg-5', packageLabel: '5 mL vial', packageCount: 2,
      wholesaleCents: 57000, retailCents: 114000, priceChangeCents: -6000,
    }))
  })

  it('otherwise sizes the target\'s package from the line\'s dispense quantity', () => {
    const plan = planReroute([semaglutide(QUICK_RX), bpc157(STRIVE)], STRIVE, new Map([['sema', [offer(STRIVE, 9500, STRIVE_VIALS)]]]), RATES)!
    expect(plan.lines[0]).toEqual(expect.objectContaining({ packageLabel: '1 mL vial', packageCount: 1, wholesaleCents: 9500, priceChangeCents: 0 }))
  })

  it('lines already at the target are unchanged', () => {
    const plan = planReroute([semaglutide(QUICK_RX), bpc157(STRIVE)], STRIVE, new Map([['sema', [offer(STRIVE, 9500)]]]), RATES)!
    expect(plan.lines[1]).toEqual(expect.objectContaining({ lineId: 'bpc', pharmacyId: STRIVE, priceChangeCents: 0, retailCents: 13000 }))
  })
})

describe('stripeSplit — payment intent amount = subtotal + shipping; fee never on shipping', () => {
  it('pass-through: amount includes shipping; application fee = wholesale + 15% margin + shipping at cost', () => {
    expect(stripeSplit({ retailCents: 19000, wholesaleCents: 9500, shippingCents: 2500 })).toEqual({
      amountCents:         21500,
      applicationFeeCents: 9500 + 1425 + 2500,
    })
  })

  it('the 15% is identical with and without shipping', () => {
    const a = stripeSplit({ retailCents: 19000, wholesaleCents: 9500, shippingCents: 0 })
    const b = stripeSplit({ retailCents: 19000, wholesaleCents: 9500, shippingCents: 2500 })
    expect(b.applicationFeeCents - a.applicationFeeCents).toBe(2500)
    expect(b.amountCents - a.amountCents).toBe(2500)
  })

  it('clinic absorbs: patient pays the subtotal, the shipping still reaches the pharmacy out of the clinic share', () => {
    expect(stripeSplit({ retailCents: 19000, wholesaleCents: 9500, shippingCents: 2500, absorbShipping: true })).toEqual({
      amountCents:         19000,
      applicationFeeCents: 13425,
    })
  })

  it('the application fee never exceeds the amount', () => {
    expect(stripeSplit({ retailCents: 10000, wholesaleCents: 9900, shippingCents: 2500, absorbShipping: true }).applicationFeeCents).toBe(10000)
  })
})
