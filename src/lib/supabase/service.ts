import { createClient } from '@supabase/supabase-js'
import { serverEnv } from '@/lib/env'
import type { Database } from '@/types/database.types'

// Service role client — BYPASSES RLS entirely.
// Use ONLY for:
//   - Webhook handlers (Stripe, Documo, Twilio, pharmacy)
//   - Cron jobs (sla-check, payment-expiry, adapter-health-check)
//   - Vault credential retrieval
//   - Admin operations that require cross-clinic access
//
// NEVER import this in Client Components, Server Components, or
// any code path reachable by the browser.
// NEVER expose the service role key to the client bundle.
export function createServiceClient() {
  return createClient<Database>(
    serverEnv.supabaseUrl(),
    serverEnv.supabaseServiceRoleKey(),
    {
      auth: {
        // Disable auto session refresh — service role has no session
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
}
