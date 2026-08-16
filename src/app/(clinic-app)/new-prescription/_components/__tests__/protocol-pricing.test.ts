/**
 * @jest-environment node
 *
 * Unit tests for the WO-85 protocol pricing fix.
 *
 * Before this fix, loadProtocolToSession() stubbed wholesaleCents and
 * retailCents at 0 ("Will be set when provider reviews") — but the
 * review page has no price-editing UI, so $0.00 flowed straight into
 * signable orders. These tests lock in the two replacement behaviors:
 *
 * 1. Real pricing math: wholesale dollars → cents, retail derived from
 *    the clinic's default markup percentage.
 * 2. Block-on-missing-price: any item without a live price or with an
 *    inactive formulation blocks the entire protocol load.
 */

import { computeItemPricing, findUnavailableItems, findUnlicensedItems } from '../protocol-pricing'

describe('computeItemPricing — wholesale → retail with clinic markup', () => {
  it('converts wholesale dollars to cents and applies the default markup', () => {
    // $45.00 wholesale at 100% markup → $90.00 retail
    expect(computeItemPricing(45, 100)).toEqual({
      wholesaleCents: 4500,
      retailCents: 9000,
    })
  })

  it('rounds fractional cents on both wholesale and retail', () => {
    // $19.99 wholesale at 33% markup → 1999 × 1.33 = 2658.67 → 2659
    expect(computeItemPricing(19.99, 33)).toEqual({
      wholesaleCents: 1999,
      retailCents: 2659,
    })
  })

  it('handles floating-point dollar inputs without drift', () => {
    expect(computeItemPricing(0.1 + 0.2, 0).wholesaleCents).toBe(30)
  })

  it('falls back to 0% markup when the clinic has no default configured', () => {
    // Retail equals wholesale — never $0.00
    expect(computeItemPricing(45, null)).toEqual({
      wholesaleCents: 4500,
      retailCents: 4500,
    })
  })

  it('never produces a $0.00 price for a non-zero wholesale', () => {
    const { wholesaleCents, retailCents } = computeItemPricing(0.01, null)
    expect(wholesaleCents).toBeGreaterThan(0)
    expect(retailCents).toBeGreaterThan(0)
  })
})

describe('findUnavailableItems — block-on-missing-price', () => {
  const live = {
    name: 'Sermorelin 3mg',
    pharmacyName: 'Beaker Pharmacy',
    wholesalePrice: 45,
    formulationActive: true,
  }

  it('returns empty when every item has a live price and active formulation', () => {
    expect(findUnavailableItems([live, { ...live, name: 'NAD+ 500mg' }])).toEqual([])
  })

  it('flags items with a null wholesale price (pharmacy no longer offers it)', () => {
    const result = findUnavailableItems([
      live,
      { ...live, name: 'BPC-157 5mg', wholesalePrice: null },
    ])
    expect(result).toEqual(['BPC-157 5mg is not available at Beaker Pharmacy'])
  })

  it('flags items whose formulation is inactive even if a price row lingers', () => {
    const result = findUnavailableItems([{ ...live, formulationActive: false }])
    expect(result).toEqual(['Sermorelin 3mg is not available at Beaker Pharmacy'])
  })

  it('lists every unavailable item so the provider sees the full picture', () => {
    const result = findUnavailableItems([
      { ...live, name: 'A', wholesalePrice: null },
      live,
      { ...live, name: 'B', formulationActive: false },
    ])
    expect(result).toHaveLength(2)
    expect(result[0]).toContain('A is not available')
    expect(result[1]).toContain('B is not available')
  })
})

describe('findUnlicensedItems — skip pinned pharmacies unlicensed in patient state', () => {
  const licensed = {
    name: 'Biest 80/20 Topical Cream 2.5mg/g',
    pharmacyName: 'Strive Pharmacy',
    pharmacyLicensed: true as boolean | null,
  }

  it('returns empty when every pinned pharmacy is licensed in the state', () => {
    expect(findUnlicensedItems([licensed, { ...licensed, name: 'DHEA 10mg' }], 'CA')).toEqual([])
  })

  it('names the medication, pharmacy, AND state for each unlicensed item', () => {
    const result = findUnlicensedItems([
      licensed,
      { name: 'Progesterone Capsule 100mg', pharmacyName: 'Portal Plus Pharmacy', pharmacyLicensed: false },
    ], 'CA')
    expect(result).toEqual([
      'Progesterone Capsule 100mg — Portal Plus Pharmacy is not licensed in CA',
    ])
  })

  it('treats unknown licensure (null) as loadable — matches the builder with no patient state', () => {
    expect(findUnlicensedItems([{ ...licensed, pharmacyLicensed: null }], 'CA')).toEqual([])
  })

  it('returns empty when the patient has no shipping state on file', () => {
    expect(findUnlicensedItems([{ ...licensed, pharmacyLicensed: false }], null)).toEqual([])
  })

  it('lists every unlicensed item so the provider sees the full picture', () => {
    const result = findUnlicensedItems([
      { ...licensed, name: 'A', pharmacyLicensed: false },
      licensed,
      { ...licensed, name: 'B', pharmacyName: 'Hybrid Labs Pharmacy', pharmacyLicensed: false },
    ], 'NY')
    expect(result).toHaveLength(2)
    expect(result[0]).toBe('A — Strive Pharmacy is not licensed in NY')
    expect(result[1]).toBe('B — Hybrid Labs Pharmacy is not licensed in NY')
  })
})
