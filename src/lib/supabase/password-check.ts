// A throwaway Supabase client for checking a password (Settings > Account
// "Change password"): it never stores a session or a cookie, so signing
// in with it cannot replace the person's own session. The caller signs it
// out at once (scope "local") so the check leaves no session behind.

import { createClient } from '@supabase/supabase-js'

export function createPasswordCheckClient() {
  return createClient(process.env['NEXT_PUBLIC_SUPABASE_URL']!, process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}
