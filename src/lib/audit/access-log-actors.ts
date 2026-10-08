// ============================================================
// Access log actors: actor_user_id -> who acted (server-side)
// ============================================================
//
// The clinic admin's access log says who viewed or changed patient data,
// not only the role. phi_access_log stores the actor's auth user id (and
// only a hash of their email), so the person is resolved here, with the
// service role, for logins in the admin's own clinic:
//
//   - name: the provider row (providers.user_id), else user_metadata
//     full_name, then name; null when none is recorded. An email is never
//     used as the name.
//   - email: the login's email, shown as an email beside the name.
//   - CompoundIQ ops staff work across clinics: "CompoundIQ ops", no email.
//   - anyone else (another clinic, a deleted login): not identified.
//
// A lookup that fails is not fatal; that actor is just not identified.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

export interface AccessLogActor {
  name:  string | null
  email: string | null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function clean(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

export async function resolveAccessLogActors(
  supabase: SupabaseClient<Database>,
  clinicId: string,
  userIds: ReadonlyArray<string | null | undefined>,
): Promise<Record<string, AccessLogActor>> {
  const ids = [...new Set(userIds.filter((id): id is string => typeof id === 'string' && UUID_RE.test(id)))]
  const out: Record<string, AccessLogActor> = {}
  if (ids.length === 0) return out

  const providerNames = new Map<string, string>()
  const { data: providers, error } = await supabase
    .from('providers')
    .select('user_id, first_name, last_name')
    .eq('clinic_id', clinicId)
    .in('user_id', ids)
  if (error) console.warn('[access-log] provider names could not be read (non-fatal):', error.message)
  for (const p of providers ?? []) {
    const name = [clean(p.first_name), clean(p.last_name)].filter(Boolean).join(' ')
    if (p.user_id && name) providerNames.set(p.user_id, name)
  }

  await Promise.all(ids.map(async id => {
    try {
      const { data, error: userError } = await supabase.auth.admin.getUserById(id)
      if (userError || !data?.user) return
      const meta = (data.user.user_metadata ?? {}) as Record<string, unknown>
      if (clean(meta['app_role']) === 'ops_admin') {
        out[id] = { name: 'CompoundIQ ops', email: null }
        return
      }
      if (clean(meta['clinic_id']) !== clinicId) return
      out[id] = {
        name:  providerNames.get(id) ?? clean(meta['full_name']) ?? clean(meta['name']),
        email: clean(data.user.email),
      }
    } catch (err) {
      console.warn('[access-log] user lookup failed (non-fatal):', err instanceof Error ? err.message : err)
    }
  }))
  return out
}
