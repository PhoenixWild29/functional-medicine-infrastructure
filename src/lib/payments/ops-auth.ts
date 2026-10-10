// The payables routes are ops_admin only. getUser() verifies the session
// with Supabase Auth; the role is read from app_metadata (claims.ts).

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getUserRole } from '@/lib/auth/claims'

export async function requireOpsAdmin(): Promise<{ userId: string; denied: null } | { userId: null; denied: NextResponse }> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { userId: null, denied: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (getUserRole(user) !== 'ops_admin') return { userId: null, denied: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { userId: user.id, denied: null }
}
