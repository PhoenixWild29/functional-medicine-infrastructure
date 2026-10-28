// The signed-in user for this request, read once and shared.
//
// React cache() dedupes per request, so repeated calls in one render make a
// single auth call. Pages under (ops-dashboard) must not open their own
// Supabase auth client in the page body (see ops-page-no-inline-auth.test.ts);
// /ops/fax reads its PHI access log actor here instead.
//
// getUser(), never getSession(): src/proxy.ts owns token rotation, and a
// Server Component cannot persist a rotated pair. Never redirects and never
// throws: a failure is simply no user, and the caller decides what that means.

import { cache } from 'react'
import type { User } from '@supabase/supabase-js'
import { createServerClient } from '@/lib/supabase/server'

export const getRequestUser = cache(async (): Promise<User | null> => {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    return user ?? null
  } catch {
    return null
  }
})
