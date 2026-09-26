/**
 * @jest-environment node
 *
 * Catalog unit corrections (#181 prod audit, groups 1 and 4): the catalog
 * CSV the importer loads says the same thing the migration does, so a
 * re-import never brings an unsizable package or form back.
 *
 * Group 1: an injectable sold as "1 vial" has no amount to size against a
 * dispense in mL. Each is 1 mL at the formulation's catalog concentration
 * (decision 2026-09-26; catalog defaults to confirm with each pharmacy at
 * onboarding): Epitalon "10 mg vial", Tesamorelin "10 mg vial", Thymosin
 * Alpha-1 "5 mg vial".
 *
 * Group 4: six topicals filed as "Topical Gel" (dispensed in g) but sold
 * in mL move to "Topical Solution" (dispensed in mL).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import Papa from 'papaparse'
import { packageRowsFor } from '../packages'
import { dispenseUnitFor, parseQuantityLabel } from '@/lib/orders/rx-details'

interface Row { formulation_name: string; dosage_form: string; concentration_value: string; concentration_unit: string; available_quantities: string }

const rows = Papa.parse<Row>(
  readFileSync(join(process.cwd(), 'docs', 'research', 'catalog-seed', 'compoundiq-catalog-seed-v1.csv'), 'utf8'),
  { header: true, skipEmptyLines: true },
).data
const row = (name: string) => {
  const r = rows.find(x => x.formulation_name === name)
  if (!r) throw new Error(`CSV has no row "${name}"`)
  return r
}

describe('group 1: the "1 vial" peptides are sized vials', () => {
  it.each([
    ['Epitalon Injectable',         '10 mg vial', 10, '10'],
    ['Tesamorelin Injectable',      '10 mg vial', 10, '10'],
    ['Thymosin Alpha-1 Injectable', '5 mg vial',   5, '5'],
  ])('%s: %s — one 1 mL vial at the catalog concentration', (name, label, qty, conc) => {
    const r = row(name)
    expect(r.available_quantities).toBe(label)
    expect(r.concentration_value).toBe(conc)
    expect(r.concentration_unit).toBe('mg/mL')
    // What the importer writes for a row with no packages column.
    const [pkg] = packageRowsFor('pf-test', '', { price: 100, availableQuantities: [r.available_quantities] })
    expect(pkg).toEqual(expect.objectContaining({ package_label: label, package_qty: qty, package_unit: 'mg', is_default: true }))
  })

  it('no injectable in the CSV is sold as a bare container any more', () => {
    const containerOnly = rows.filter(r => /injectable/i.test(r.dosage_form))
      .flatMap(r => r.available_quantities.split('|').map(q => q.trim()))
      .filter(q => parseQuantityLabel(q, 'Injectable Solution')?.isContainer)
    expect(containerOnly).toEqual([])
  })
})

describe('group 4: the mL topicals are Topical Solution', () => {
  const SIX = [
    'Finasteride Topical Serum 0.25%',
    'GHK-Cu Topical Serum',
    'Hair Growth Combo Topical Solution',
    'Latanoprost Hair Growth Solution 0.03%',
    'Minoxidil Topical Solution 5%',
    'Triple Hair Growth Serum',
  ]

  it.each(SIX)('%s dispenses in mL, like the bottles it is sold in', name => {
    const r = row(name)
    expect(r.dosage_form).toBe('Topical Solution')
    expect(dispenseUnitFor(r.dosage_form, 'mL')).toBe('mL')
    expect(parseQuantityLabel(r.available_quantities.split('|')[0]!, r.dosage_form)?.unit).toBe('mL')
  })

  it('nothing else moved: every other topical keeps its form', () => {
    const topical = rows.filter(r => /^Topical /.test(r.dosage_form) && !SIX.includes(r.formulation_name))
    expect(topical.filter(r => r.dosage_form === 'Topical Solution')).toEqual([])
  })
})
