'use client'

import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import type { Database } from '@/types/database.types'

// Client Component client — uses anon key with RLS enforcement.
// Safe to use in Client Components ('use client' files).
// Service role key NEVER used here — anon key only.
export function createBrowserClient() {
  return createClientComponentClient<Database>()
}
