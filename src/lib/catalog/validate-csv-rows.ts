// ============================================================
// Catalog CSV rows: the one server-side validator
// ============================================================
//
// The catalog upload format (one row per medication: medication_name,
// form, dose, wholesale_price, regulatory_status, optional retail_price
// and requires_prior_auth), as POST /api/ops/catalog/upload has always
// validated it. Shared with pharmacy onboarding, which stages a
// pharmacy's CSV for ops to load. Row numbers count the header (row 1).

export const VALID_REGULATORY_STATUSES = ['ACTIVE', 'RECALLED', 'DISCONTINUED', 'SHORTAGE'] as const
export type RegulatoryStatus = (typeof VALID_REGULATORY_STATUSES)[number]

export interface ValidCatalogRow {
  medication_name:     string
  form:                string
  dose:                string
  wholesale_price:     number
  retail_price:        number | null
  regulatory_status:   RegulatoryStatus
  requires_prior_auth: boolean
}

export function validateCatalogRows(rows: ReadonlyArray<unknown>): { valid: ValidCatalogRow[]; warnings: string[] } {
  const warnings: string[] = []
  const valid: ValidCatalogRow[] = []

  for (let i = 0; i < rows.length; i++) {
    const row = (rows[i] ?? {}) as Record<string, unknown>
    const rowNum = i + 2  // 1-indexed, +1 for header row

    const name   = String(row['medication_name'] ?? '').trim()
    const form   = String(row['form']            ?? '').trim()
    const dose   = String(row['dose']            ?? '').trim()
    const status = String(row['regulatory_status'] ?? '').trim().toUpperCase()

    if (!name || !form || !dose) {
      warnings.push(`Row ${rowNum}: skipped — missing required field (medication_name, form, or dose)`)
      continue
    }

    const knownStatus = (VALID_REGULATORY_STATUSES as readonly string[]).includes(status)
    if (!knownStatus) {
      warnings.push(`Row ${rowNum}: invalid regulatory_status '${status}' — defaulting to ACTIVE`)
    }

    const wholesale = parseFloat(String(row['wholesale_price'] ?? ''))
    if (isNaN(wholesale) || wholesale < 0) {
      warnings.push(`Row ${rowNum}: skipped — invalid wholesale_price`)
      continue
    }

    const retail = row['retail_price'] != null
      ? parseFloat(String(row['retail_price']))
      : null
    const retailVal = retail !== null && !isNaN(retail) && retail >= 0 ? retail : null

    const priorAuth = row['requires_prior_auth']
    const requiresPriorAuth =
      typeof priorAuth === 'boolean' ? priorAuth
      : String(priorAuth ?? '').toLowerCase() === 'true' || String(priorAuth ?? '') === '1'

    valid.push({
      medication_name:     name,
      form,
      dose,
      wholesale_price:     wholesale,
      retail_price:        retailVal,
      regulatory_status:   knownStatus ? status as RegulatoryStatus : 'ACTIVE',
      requires_prior_auth: requiresPriorAuth,
    })
  }

  return { valid, warnings }
}
