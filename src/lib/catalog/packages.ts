// ============================================================
// WO-101: pharmacy formulation packages — catalog import / export
// ============================================================
//
// Pure functions shared by scripts/import-catalog-v3.ts (CSV → rows) and
// scripts/export-catalog-v3.ts (rows → CSV), so an import followed by an
// export produces the same package rows (acceptance criterion).
//
// CSV `packages` column (optional). Pipe-separated packages, each
// "<label>@<wholesale price>", with a trailing "*" on the default:
//
//   1 mL vial@95.00*|2.5 mL vial@165.00|5 mL vial@285.00
//
// No "*" → the first package listed is the default. A row with no
// packages column (or an empty cell) gets ONE default package at the
// row's wholesale_price_usd, labelled with its first available quantity —
// the same rule migration 20260914000001 applied to existing rows.
//
// Ids are deterministic and match the migration's SQL:
//   uid('pkg:' + pharmacy_formulation_id + ':' + lower(trim(label)))
// where uid() is the md5 → 8-4-4-4-12 hex used for every catalog id.
//
// Server / script only (node:crypto).

import { createHash } from 'node:crypto'

/** md5(key) formatted as a UUID — identical to Postgres md5(key)::uuid. */
export function catalogUid(key: string): string {
  const h = createHash('md5').update(key).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

/** pharmacy_formulations id — the importer's 'pf:' derivation (prod data was loaded with it). */
export function pharmacyFormulationId(pharmacyId: string, formulationName: string): string {
  return catalogUid('pf:' + pharmacyId + ':' + formulationName.trim().toLowerCase())
}

export function packageId(pharmacyFormulationId: string, label: string): string {
  return catalogUid('pkg:' + pharmacyFormulationId + ':' + label.trim().toLowerCase())
}

/** A pharmacy_formulation_packages row as the importer writes it. */
export interface PackageRow {
  id:                      string
  pharmacy_formulation_id: string
  package_label:           string
  package_qty:             number
  package_unit:            string
  wholesale_price:         number
  is_default:              boolean
  active:                  boolean
}

export interface PackageSpec {
  label:     string
  price:     number
  isDefault: boolean
}

/**
 * Amount + unit from a label: "2.5 mL vial" → 2.5 / "mL", "30 count" →
 * 30 / "count", "Standard" → 1 / "unit". Mirrors the migration backfill's
 * regexes exactly (leading number, then the first letter run; "ml" → "mL").
 */
export function qtyAndUnitFromLabel(label: string): { qty: number; unit: string } {
  const m = /^\s*(\d+(?:\.\d+)?)\s*([A-Za-z]+)?/.exec(label)
  if (!m) return { qty: 1, unit: 'unit' }
  const qty = parseFloat(m[1]!)
  const token = m[2] ?? ''
  const unit = token ? (token.toLowerCase() === 'ml' ? 'mL' : token) : 'unit'
  return { qty: Number.isFinite(qty) && qty > 0 ? qty : 1, unit }
}

/** The label a row with no packages column gets: its first available quantity, else "Standard". */
export function defaultPackageLabel(availableQuantities: ReadonlyArray<string> | null | undefined): string {
  // Only the FIRST entry, like the migration's available_quantities->>0.
  const first = availableQuantities?.[0]
  return typeof first === 'string' && first.trim() ? first.trim() : 'Standard'
}

function roundCents(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Parse a `packages` cell. Empty / missing → []. Throws on a malformed
 * entry (no "@", non-numeric or negative price, duplicate label, more
 * than one "*") so a bad catalog file fails the import loudly.
 */
export function parsePackagesCell(cell: string | null | undefined): PackageSpec[] {
  const raw = (cell ?? '').trim()
  if (!raw) return []
  const specs: PackageSpec[] = []
  const seen = new Set<string>()
  for (const part of raw.split('|').map(s => s.trim()).filter(Boolean)) {
    const at = part.lastIndexOf('@')
    if (at <= 0) throw new Error(`packages: "${part}" must be "<label>@<price>"`)
    const label = part.slice(0, at).trim()
    let priceText = part.slice(at + 1).trim()
    const isDefault = priceText.endsWith('*')
    if (isDefault) priceText = priceText.slice(0, -1).trim()
    const price = Number(priceText)
    if (!label) throw new Error(`packages: "${part}" has an empty label`)
    if (!priceText || !Number.isFinite(price) || price < 0) throw new Error(`packages: "${part}" has an invalid price`)
    const key = label.toLowerCase()
    if (seen.has(key)) throw new Error(`packages: duplicate label "${label}"`)
    seen.add(key)
    specs.push({ label, price: roundCents(price), isDefault })
  }
  const defaults = specs.filter(s => s.isDefault).length
  if (defaults > 1) throw new Error('packages: more than one default ("*")')
  if (defaults === 0 && specs.length > 0) specs[0]!.isDefault = true
  return specs
}

/** Stable order for rows and cells: smallest package first, then label. */
function comparePackages(a: { package_qty: number; package_label: string }, b: { package_qty: number; package_label: string }): number {
  return a.package_qty - b.package_qty || a.package_label.localeCompare(b.package_label)
}

/**
 * The package rows the importer upserts for one pharmacy formulation.
 * With a packages cell: one row per package. Without: one default row
 * at `fallback.price` labelled from `fallback.availableQuantities`.
 */
export function packageRowsFor(
  pharmacyFormulationId: string,
  cell: string | null | undefined,
  fallback: { price: number; availableQuantities: ReadonlyArray<string> | null | undefined },
): PackageRow[] {
  const specs = parsePackagesCell(cell)
  const list: PackageSpec[] = specs.length > 0
    ? specs
    : [{ label: defaultPackageLabel(fallback.availableQuantities), price: roundCents(fallback.price), isDefault: true }]
  return list
    .map(s => {
      const { qty, unit } = qtyAndUnitFromLabel(s.label)
      return {
        id:                      packageId(pharmacyFormulationId, s.label),
        pharmacy_formulation_id: pharmacyFormulationId,
        package_label:           s.label,
        package_qty:             qty,
        package_unit:            unit,
        wholesale_price:         s.price,
        is_default:              s.isDefault,
        active:                  true,
      }
    })
    .sort(comparePackages)
}

/** The wholesale price pharmacy_formulations.wholesale_price carries: the default package's. */
export function defaultPackagePrice(rows: ReadonlyArray<Pick<PackageRow, 'wholesale_price' | 'is_default'>>): number | null {
  return rows.find(r => r.is_default)?.wholesale_price ?? null
}

/**
 * Rows → `packages` cell (the exporter). Active packages only, smallest
 * first, default marked "*" — so parsing the cell back yields the same
 * rows. Prices always carry two decimals.
 */
export function formatPackagesCell(rows: ReadonlyArray<Pick<PackageRow, 'package_label' | 'package_qty' | 'wholesale_price' | 'is_default' | 'active'>>): string {
  return rows
    .filter(r => r.active)
    .map(r => ({ ...r, package_qty: Number(r.package_qty), wholesale_price: Number(r.wholesale_price) }))
    .sort(comparePackages)
    .map(r => `${r.package_label}@${r.wholesale_price.toFixed(2)}${r.is_default ? '*' : ''}`)
    .join('|')
}

/** One exported CSV line: which pharmacy formulation, and its packages cell. */
export interface PackageExportLine {
  pharmacy_id:      string
  formulation_name: string
  packages:         string
}

/**
 * Group package rows by pharmacy formulation and render each group's
 * `packages` cell (scripts/export-catalog-v3.ts). `pfIndex` maps a
 * pharmacy_formulation_id to its pharmacy and formulation name. Lines are
 * sorted by pharmacy then formulation so the file is stable.
 */
export function exportPackageLines(
  rows: ReadonlyArray<PackageRow>,
  pfIndex: ReadonlyMap<string, { pharmacy_id: string; formulation_name: string }>,
): PackageExportLine[] {
  const groups = new Map<string, PackageRow[]>()
  for (const r of rows) {
    const list = groups.get(r.pharmacy_formulation_id) ?? []
    list.push(r)
    groups.set(r.pharmacy_formulation_id, list)
  }
  const lines: PackageExportLine[] = []
  for (const [pfId, list] of groups) {
    const pf = pfIndex.get(pfId)
    if (!pf) continue
    const cell = formatPackagesCell(list)
    if (cell) lines.push({ pharmacy_id: pf.pharmacy_id, formulation_name: pf.formulation_name, packages: cell })
  }
  return lines.sort((a, b) => a.pharmacy_id.localeCompare(b.pharmacy_id) || a.formulation_name.localeCompare(b.formulation_name))
}
