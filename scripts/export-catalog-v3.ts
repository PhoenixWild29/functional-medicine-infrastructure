/**
 * ============================================================
 * V3 Catalog Package Exporter — WO-101
 * ============================================================
 *
 * Writes every pharmacy formulation's active packages (vial sizes and
 * prices) as the `packages` cells scripts/import-catalog-v3.ts reads:
 *
 *   pharmacy_id,formulation_name,packages
 *   a4000000-…-000000000001,Semaglutide Injectable 5 mg/mL,1 mL vial@95.00*|2.5 mL vial@165.00|5 mL vial@285.00
 *
 * Import → export round-trips: formatting and parsing share
 * src/lib/catalog/packages.ts, and the rows the importer would write from
 * an exported cell are the rows that were exported
 * (src/lib/catalog/__tests__/packages.test.ts).
 *
 * Usage:
 *   npm run export:catalog-packages                     # → stdout
 *   npm run export:catalog-packages -- --out=packages.csv
 *
 * Read-only.
 */

import { writeFileSync } from 'node:fs'
import Papa from 'papaparse'
import { createServiceClient } from '@/lib/supabase/service'
import { exportPackageLines, type PackageRow } from '@/lib/catalog/packages'

const PAGE = 1000

async function main(): Promise<void> {
  const outArg = process.argv.find((a) => a.startsWith('--out='))?.split('=')[1]
  const supabase = createServiceClient()

  const pfIndex = new Map<string, { pharmacy_id: string; formulation_name: string }>()
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('pharmacy_formulations')
      .select('pharmacy_formulation_id, pharmacy_id, formulations(name)')
      .is('deleted_at', null)
      .order('pharmacy_formulation_id')
      .range(from, from + PAGE - 1)
    if (error) throw error
    for (const pf of data ?? []) {
      const f = pf.formulations as { name: string } | null
      if (f) pfIndex.set(pf.pharmacy_formulation_id, { pharmacy_id: pf.pharmacy_id, formulation_name: f.name })
    }
    if (!data || data.length < PAGE) break
  }

  const rows: PackageRow[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('pharmacy_formulation_packages')
      .select('id, pharmacy_formulation_id, package_label, package_qty, package_unit, wholesale_price, is_default, active')
      .eq('active', true)
      .order('id')
      .range(from, from + PAGE - 1)
    if (error) throw error
    for (const r of data ?? []) {
      rows.push({ ...r, package_qty: Number(r.package_qty), wholesale_price: Number(r.wholesale_price) })
    }
    if (!data || data.length < PAGE) break
  }

  const csv = Papa.unparse(exportPackageLines(rows, pfIndex), {
    columns: ['pharmacy_id', 'formulation_name', 'packages'],
  })
  if (outArg) {
    writeFileSync(outArg, csv + '\n', 'utf8')
    console.info(`[export-catalog] wrote ${outArg}`)
  } else {
    process.stdout.write(csv + '\n')
  }
}

main().catch((err: unknown) => {
  console.error('[export-catalog] FAILED:', err instanceof Error ? err.message : err)
  process.exit(1)
})
