'use client'

import { createBrowserClient as _createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/database.types'

// Client Component client — uses anon key with RLS enforcement.
// Safe to use in Client Components ('use client' files).
// Service role key NEVER used here — anon key only.
export function createBrowserClient() {
  return _createBrowserClient<Database>(
    process.env['NEXT_PUBLIC_SUPABASE_URL']!,
    process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']!
  )
}
