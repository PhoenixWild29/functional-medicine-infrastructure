// ============================================================
// Order timeline actors — auth user id → display name
// ============================================================
//
// order_status_history.changed_by is an auth user id. The order drawer
// used to print it raw ("Draft edited · 3f2a…"). This resolves each id
// to something a person recognises:
//
//   1. a provider in the order's clinic (providers.user_id) → "First Last"
//   2. a staff login in the same clinic → user_metadata full_name / name
//      when present, else the login email (clinic staff accounts carry no
//      name field today, so for the POC MA / clinic admin this is the email)
//   3. anyone else (another clinic, ops, system, deleted user) → no name;
//      the caller falls back to the id
//
// Service-role reads, always scoped to the order's clinic — a name is
// never returned for a user outside it.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

export interface TimelineActor {
  name: string | null
  role: string | null
}

type ServiceClient = SupabaseClient<Database>

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function clean(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

export async function resolveTimelineActors(
  supabase: ServiceClient,
  clinicId: string,
  userIds: ReadonlyArray<string | null | undefined>,
): Promise<Record<string, TimelineActor>> {
  const ids = [...new Set(userIds.filter((id): id is string => typeof id === 'string' && UUID_RE.test(id)))]
  const out: Record<string, TimelineActor> = {}
  if (ids.length === 0) return out

  // 1. providers in this clinic
  const { data: providers, error } = await supabase
    .from('providers')
    .select('user_id, first_name, last_name')
    .eq('clinic_id', clinicId)
    .in('user_id', ids)
  if (error) {
    console.warn('[timeline-actors] provider lookup failed (non-fatal):', error.message)
  }
  for (const p of providers ?? []) {
    if (!p.user_id) continue
    const name = [clean(p.first_name), clean(p.last_name)].filter(Boolean).join(' ')
    out[p.user_id] = { name: name || null, role: 'provider' }
  }

  // 2. remaining ids: staff logins in the same clinic
  for (const id of ids) {
    if (out[id]) continue
    try {
      const { data, error: userError } = await supabase.auth.admin.getUserById(id)
      if (userError || !data?.user) continue
      const meta = (data.user.user_metadata ?? {}) as Record<string, unknown>
      if (clean(meta['clinic_id']) !== clinicId) continue
      out[id] = {
        name: clean(meta['full_name']) ?? clean(meta['name']) ?? clean(data.user.email),
        role: clean(meta['app_role']),
      }
    } catch (err) {
      console.warn('[timeline-actors] user lookup failed (non-fatal):', err instanceof Error ? err.message : err)
    }
  }
  return out
}

/** What the drawer prints for an actor: the name, else the raw id. */
export function actorDisplayName(actors: Record<string, TimelineActor> | null | undefined, userId: string | null | undefined): string | null {
  if (!userId) return null
  return actors?.[userId]?.name ?? userId
}
