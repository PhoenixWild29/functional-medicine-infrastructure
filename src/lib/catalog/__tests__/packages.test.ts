/**
 * @jest-environment node
 *
 * WO-101: catalog packages (vial sizes) — importer / exporter helpers.
 *
 *   - `packages` cell parsing, defaults, and loud failures on bad input
 *   - deterministic ids pkg:<pharmacy_formulation_id>:<label>, identical
 *     to the migration's md5(...)::uuid
 *   - rows without packages → one default package at today's price
 *   - import → export → import produces identical package rows, for the
 *     whole demo catalog CSV and for Strive's priced Semaglutide vials
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import Papa from 'papaparse'
import {
  catalogUid,
  defaultPackageLabel,
  defaultPackagePrice,
  exportPackageLines,
  formatPackagesCell,
  packageId,
  packageRowsFor,
  parsePackagesCell,
  pharmacyFormulationId,
  qtyAndUnitFromLabel,
  type PackageRow,
} from '../packages'

const STRIVE = 'a4000000-0000-0000-0000-000000000001'
const QUICK_RX = 'a4000000-0000-0000-0000-000000000002'
const STRIVE_SEMA_CELL = '1 mL vial@95.00*|2.5 mL vial@165.00|5 mL vial@285.00'

const MIGRATION = readFileSync(
  join(process.cwd(), 'supabase', 'migrations', '20260914000001_wo101_pharmacy_formulation_packages.sql'),
  'utf8',
)

describe('parsePackagesCell', () => {
  it('reads label@price with "*" marking the default', () => {
    expect(parsePackagesCell(STRIVE_SEMA_CELL)).toEqual([
      { label: '1 mL vial',   price: 95,  isDefault: true },
      { label: '2.5 mL vial', price: 165, isDefault: false },
      { label: '5 mL vial',   price: 285, isDefault: false },
    ])
  })

  it('makes the first package the default when none is marked', () => {
    expect(parsePackagesCell('3 mL vial@120|5 mL vial@150').map(p => p.isDefault)).toEqual([true, false])
  })

  it('empty or missing → no packages', () => {
    expect(parsePackagesCell('')).toEqual([])
    expect(parsePackagesCell(undefined)).toEqual([])
  })

  it.each([
    ['1 mL vial', /must be/],
    ['1 mL vial@abc', /invalid price/],
    ['1 mL vial@-5', /invalid price/],
    ['1 mL vial@95*|5 mL vial@150*', /more than one default/],
    ['1 mL vial@95|1 ML VIAL@96', /duplicate label/],
  ])('rejects %j', (cell, message) => {
    expect(() => parsePackagesCell(cell)).toThrow(message)
  })
})

describe('ids', () => {
  it('package ids are md5("pkg:<pf id>:<lower(label)>") as a UUID — the migration\'s md5(...)::uuid', () => {
    const pf = pharmacyFormulationId(STRIVE, 'Semaglutide Injectable 5 mg/mL')
    const hex = createHash('md5').update(`pkg:${pf}:2.5 ml vial`).digest('hex')
    expect(packageId(pf, ' 2.5 mL vial ')).toBe(
      `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
    )
    expect(MIGRATION).toContain("md5('pkg:' || pf.pharmacy_formulation_id::text || ':' || lower(src.label))::uuid")
    expect(MIGRATION).toContain("md5('pkg:' || s.pharmacy_formulation_id::text || ':' || lower(w.label))::uuid")
  })

  it('pharmacy formulation ids keep the importer\'s pf: derivation', () => {
    expect(pharmacyFormulationId(STRIVE, ' Semaglutide Injectable 5 mg/mL ')).toBe(
      catalogUid(`pf:${STRIVE}:semaglutide injectable 5 mg/ml`),
    )
  })
})

describe('rows without a packages column', () => {
  it('get one default package at today\'s price, labelled from the first available quantity', () => {
    const pf = pharmacyFormulationId(QUICK_RX, 'Semaglutide Injectable 5 mg/mL')
    expect(packageRowsFor(pf, '', { price: 95, availableQuantities: ['1 mL vial', '3 mL vial'] })).toEqual([{
      id:                      packageId(pf, '1 mL vial'),
      pharmacy_formulation_id: pf,
      package_label:           '1 mL vial',
      package_qty:             1,
      package_unit:            'mL',
      wholesale_price:         95,
      is_default:              true,
      active:                  true,
    }])
  })

  it('label/qty/unit follow the migration backfill rule', () => {
    expect(defaultPackageLabel(['5mL vial', '10mL vial'])).toBe('5mL vial')
    expect(defaultPackageLabel(['', '10mL vial'])).toBe('Standard')
    expect(defaultPackageLabel([])).toBe('Standard')
    expect(qtyAndUnitFromLabel('5mL vial')).toEqual({ qty: 5, unit: 'mL' })
    expect(qtyAndUnitFromLabel('2.5 ml vial')).toEqual({ qty: 2.5, unit: 'mL' })
    expect(qtyAndUnitFromLabel('30 count')).toEqual({ qty: 30, unit: 'count' })
    expect(qtyAndUnitFromLabel('Standard')).toEqual({ qty: 1, unit: 'unit' })
    // Same regexes and fallbacks in SQL.
    expect(MIGRATION).toContain("substring(src.label FROM '^\\s*(\\d+(?:\\.\\d+)?)')")
    expect(MIGRATION).toContain("substring(src.label FROM '^\\s*\\d+(?:\\.\\d+)?\\s*([A-Za-z]+)')")
    expect(MIGRATION).toContain("'Standard'")
  })

  it('the pharmacy formulation price is the default package price', () => {
    const pf = pharmacyFormulationId(STRIVE, 'Semaglutide Injectable 5 mg/mL')
    expect(defaultPackagePrice(packageRowsFor(pf, STRIVE_SEMA_CELL, { price: 999, availableQuantities: [] }))).toBe(95)
  })
})

describe('import → export round trip', () => {
  /** What the importer writes: rows per pharmacy × CSV row (scripts/import-catalog-v3.ts). */
  function importRows(csvRows: Array<Record<string, string>>, pharmacyIds: string[]) {
    const rows: PackageRow[] = []
    const pfIndex = new Map<string, { pharmacy_id: string; formulation_name: string }>()
    for (const r of csvRows) {
      for (const pid of pharmacyIds) {
        const pf = pharmacyFormulationId(pid, r['formulation_name']!)
        pfIndex.set(pf, { pharmacy_id: pid, formulation_name: r['formulation_name']!.trim() })
        const qty = (r['available_quantities'] ?? '').split('|').map(s => s.trim()).filter(Boolean)
        rows.push(...packageRowsFor(pf, r['packages'], { price: Number(r['wholesale_price_usd']), availableQuantities: qty }))
      }
    }
    return { rows, pfIndex }
  }

  /** Re-import an exported file: each line's packages cell for its pharmacy formulation. */
  function reimport(lines: ReturnType<typeof exportPackageLines>) {
    return lines.flatMap(l =>
      packageRowsFor(pharmacyFormulationId(l.pharmacy_id, l.formulation_name), l.packages, { price: 0, availableQuantities: [] }),
    )
  }

  const byId = (a: PackageRow, b: PackageRow) => a.id.localeCompare(b.id)

  it('the demo catalog CSV (no packages column) exports and re-imports to identical rows', () => {
    const csv = readFileSync(join(process.cwd(), 'docs', 'research', 'catalog-seed', 'compoundiq-catalog-seed-v1.csv'), 'utf8')
    const parsed = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true }).data
    const { rows, pfIndex } = importRows(parsed, [STRIVE, QUICK_RX])
    expect(rows.length).toBe(parsed.length * 2)

    const exported = exportPackageLines(rows, pfIndex)
    // Through CSV text and back, like the exporter file.
    const text = Papa.unparse(exported, { columns: ['pharmacy_id', 'formulation_name', 'packages'] })
    const fileLines = Papa.parse<{ pharmacy_id: string; formulation_name: string; packages: string }>(text, { header: true, skipEmptyLines: true }).data

    expect(reimport(fileLines).sort(byId)).toEqual([...rows].sort(byId))
  })

  it('priced packages (Strive Semaglutide 5 mg/mL) round-trip, and exporting twice is stable', () => {
    const { rows, pfIndex } = importRows([{
      formulation_name: 'Semaglutide Injectable 5 mg/mL',
      wholesale_price_usd: '95.00',
      available_quantities: '1 mL vial|2.5 mL vial|5 mL vial',
      packages: STRIVE_SEMA_CELL,
    }], [STRIVE])

    expect(rows.map(r => [r.package_label, r.package_qty, r.package_unit, r.wholesale_price, r.is_default])).toEqual([
      ['1 mL vial',   1,   'mL', 95,  true],
      ['2.5 mL vial', 2.5, 'mL', 165, false],
      ['5 mL vial',   5,   'mL', 285, false],
    ])

    const exported = exportPackageLines(rows, pfIndex)
    expect(exported).toEqual([{ pharmacy_id: STRIVE, formulation_name: 'Semaglutide Injectable 5 mg/mL', packages: STRIVE_SEMA_CELL }])
    const again = reimport(exported)
    expect(again).toEqual(rows)
    expect(exportPackageLines(again, pfIndex)).toEqual(exported)
  })

  it('the exporter writes active packages only, smallest first, whatever order rows arrive in', () => {
    const pf = pharmacyFormulationId(STRIVE, 'X')
    const rows = packageRowsFor(pf, STRIVE_SEMA_CELL, { price: 0, availableQuantities: [] })
    const shuffled = [rows[2]!, { ...rows[1]!, active: false }, rows[0]!]
    expect(formatPackagesCell(shuffled)).toBe('1 mL vial@95.00*|5 mL vial@285.00')
  })

  it('the migration seeds Strive with the same three vials and prices', () => {
    expect(MIGRATION).toMatch(/\('1 mL vial',\s+1\.0::numeric, NULL::numeric,\s+true\)/)
    expect(MIGRATION).toMatch(/\('2\.5 mL vial', 2\.5::numeric, 165\.00::numeric, false\)/)
    expect(MIGRATION).toMatch(/\('5 mL vial',\s+5\.0::numeric, 285\.00::numeric, false\)/)
  })
})
