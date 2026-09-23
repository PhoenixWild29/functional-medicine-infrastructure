// ============================================================
// Which pharmacies the catalog importer attaches formulations to
// ============================================================
//
// Only live pharmacies (active, not deleted). The importer used to read
// every row in `pharmacies` and attach every formulation to each — on
// prod that included the soft-deleted E2E test pharmacies, which is how
// they came to be offered for Semaglutide.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { isLivePharmacy } from '@/lib/pharmacies/live'

export type AttachablePharmacies =
  | { ok: true; pharmacyIds: string[] }
  | { ok: false; error: string }

export async function listAttachablePharmacies(
  supabase: SupabaseClient<Database>,
  pharmacyArg?: string | null,
): Promise<AttachablePharmacies> {
  const { data, error } = await supabase
    .from('pharmacies')
    .select('pharmacy_id, name, is_active, deleted_at')
  if (error) return { ok: false, error: `pharmacies could not be read: ${error.message}` }

  const rows = data ?? []
  if (pharmacyArg) {
    const row = rows.find(p => p.pharmacy_id === pharmacyArg)
    if (!row) return { ok: false, error: `--pharmacy-id=${pharmacyArg}: no such pharmacy` }
    if (!isLivePharmacy(row)) {
      return { ok: false, error: `--pharmacy-id=${pharmacyArg} (${row.name}) is inactive or deleted; formulations are not attached to it` }
    }
    return { ok: true, pharmacyIds: [pharmacyArg] }
  }
  return { ok: true, pharmacyIds: rows.filter(isLivePharmacy).map(p => p.pharmacy_id) }
}
