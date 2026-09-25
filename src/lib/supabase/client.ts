'use client'

import { createBrowserClient as _createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/database.types'

// Client Component client — uses anon key with RLS enforcement.
// Safe to use in Client Components ('use client' files).
// Service role key NEVER used here — anon key only.
//
// Optional `extraHeaders` are sent on every request, like the server
// client's (lib/supabase/server.ts): the provider dashboard's clinic
// view sends `x-provider-view-mode: clinic` so its poll reads the same
// rows the page was rendered with. A client with extra headers is its
// own instance — the shared singleton never carries them.
export function createBrowserClient(options?: { extraHeaders?: Record<string, string> }) {
  if (options?.extraHeaders) {
    return _createBrowserClient<Database>(
      process.env['NEXT_PUBLIC_SUPABASE_URL']!,
      process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']!,
      { global: { headers: options.extraHeaders }, isSingleton: false },
    )
  }
  return _createBrowserClient<Database>(
    process.env['NEXT_PUBLIC_SUPABASE_URL']!,
    process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY']!
  )
}
