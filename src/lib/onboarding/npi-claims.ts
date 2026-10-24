// ============================================================
// Who holds an NPI (security review D-2026-10-24-05, M3)
// ============================================================
//
// An NPI belongs to the live provider of an APPROVED clinic: that row is
// claimed (providers.npi_claimed), and the unique index
// providers_npi_number_unique covers claimed rows only (migration
// 20261024000005). A clinic ops has not approved holds no NPI: its
// providers are unclaimed, so a stranger's sign-up with a real
// prescriber's NPI blocks nobody, and the sign-up form says nothing about
// which NPIs are customers. Pending rows lose to approved ones:
//   - ops review shows, per provider, whether an approved clinic already
//     holds the NPI (then Approve is refused) and how many other pending
//     sign-ups name it;
//   - approval claims the clinic's providers; a claim the unique index
//     refuses is the same refusal (a race).
//
// Service role, behind the ops_admin gate. Ops-only words: nothing here
// reaches the person who signed up.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

type Db = SupabaseClient<Database>

export const NPI_REGISTERED_ELSEWHERE = 'NPI_REGISTERED_ELSEWHERE'

export interface NpiConflict {
  /** A live provider of another, approved clinic holds this NPI. */
  approvedElsewhere: boolean
  /** Other clinics' pending (unclaimed) providers naming this NPI. */
  pendingElsewhere:  number
}

export function npiRegisteredElsewhereWarning(name: string): string {
  return `${name}’s NPI is already registered to a provider at an approved clinic. Approve is refused until this is resolved with the provider.`
}

export function npiPendingElsewhereNote(n: number): string {
  return `NPI also claimed by ${n} other pending sign-up${n === 1 ? '' : 's'}.`
}

export function npiRegisteredElsewhereMessage(names: ReadonlyArray<string>): string {
  return names.length > 0
    ? names.map(npiRegisteredElsewhereWarning).join(' ')
    : 'A provider’s NPI is already registered to a provider at an approved clinic. Approve is refused until this is resolved with the provider.'
}

/**
 * For each of this clinic's providers, who else names the NPI. Throws when
 * the read fails: ops never approve from a partial review.
 */
export async function npiConflicts(
  db: Db,
  clinicId: string,
  providers: ReadonlyArray<{ providerId: string; npi: string | null }>,
): Promise<Map<string, NpiConflict>> {
  const out = new Map<string, NpiConflict>()
  const npis = [...new Set(providers.map(p => p.npi).filter((n): n is string => !!n))]
  for (const p of providers) out.set(p.providerId, { approvedElsewhere: false, pendingElsewhere: 0 })
  if (npis.length === 0) return out
  const { data, error } = await db.from('providers')
    .select('provider_id, clinic_id, npi_number, npi_claimed')
    .in('npi_number', npis)
    .is('deleted_at', null)
  if (error) throw new Error(`NPI holders could not be read: ${error.message}`)
  const others = ((data ?? []) as Array<{ provider_id: string; clinic_id: string; npi_number: string; npi_claimed: boolean | null }>)
    .filter(r => r.clinic_id !== clinicId)
  for (const p of providers) {
    if (!p.npi) continue
    const same = others.filter(r => r.npi_number === p.npi)
    out.set(p.providerId, {
      // NOT NULL DEFAULT true: a row without the flag (older readers) holds it.
      approvedElsewhere: same.some(r => r.npi_claimed !== false),
      pendingElsewhere:  same.filter(r => r.npi_claimed === false).length,
    })
  }
  return out
}

/**
 * At approval: the clinic's live providers take their NPIs. 'conflict' when
 * an approved clinic already holds one (checked first, and the unique
 * index refuses it in a race); nothing is claimed then.
 */
export async function claimClinicNpis(db: Db, clinicId: string): Promise<'ok' | 'conflict' | 'error'> {
  const { data: mine, error: readErr } = await db.from('providers')
    .select('provider_id, npi_number')
    .eq('clinic_id', clinicId)
    .is('deleted_at', null)
  if (readErr) {
    console.error(`[npi-claims] providers could not be read | clinic=${clinicId}: ${readErr.message}`)
    return 'error'
  }
  const rows = (mine ?? []) as Array<{ provider_id: string; npi_number: string | null }>
  let conflicts: Map<string, NpiConflict>
  try {
    conflicts = await npiConflicts(db, clinicId, rows.map(r => ({ providerId: r.provider_id, npi: r.npi_number })))
  } catch (err) {
    console.error(`[npi-claims] NPI holders could not be read | clinic=${clinicId}:`, err instanceof Error ? err.message : err)
    return 'error'
  }
  if ([...conflicts.values()].some(c => c.approvedElsewhere)) return 'conflict'

  const { error } = await db.from('providers')
    .update({ npi_claimed: true })
    .eq('clinic_id', clinicId)
    .is('deleted_at', null)
  if (error?.code === '23505') return 'conflict'
  if (error) {
    console.error(`[npi-claims] NPIs could not be claimed | clinic=${clinicId}: ${error.message}`)
    return 'error'
  }
  return 'ok'
}

/** Undo claimClinicNpis when the approval itself did not happen. Never throws. */
export async function releaseClinicNpis(db: Db, clinicId: string): Promise<void> {
  const { error } = await db.from('providers').update({ npi_claimed: false }).eq('clinic_id', clinicId).is('deleted_at', null)
  if (error) console.error(`[npi-claims] CRITICAL: NPIs left claimed after a failed approval | clinic=${clinicId}: ${error.message}`)
}
