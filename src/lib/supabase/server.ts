import {
  createServerComponentClient,
  createRouteHandlerClient as _createRouteHandlerClient,
} from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import type { Database } from '@/types/database.types'

// Server Component client — uses RLS based on the user's JWT session.
// Use in Server Components and Server Actions.
// Never use the service role key here.
export function createServerClient() {
  return createServerComponentClient<Database>({ cookies })
}

// Route Handler client — uses RLS based on the user's JWT session.
// Use in API route handlers that act on behalf of the authenticated user.
export function createRouteHandlerClient() {
  return _createRouteHandlerClient<Database>({ cookies })
}
