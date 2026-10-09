// ============================================================
// Pharmacy onboarding routes: who is asking, and the answer shape
// ============================================================
//
// getUser() (never getSession()), and role / pharmacy from app_metadata
// through claims.ts only. Middleware already keeps each role to its own
// paths; these checks hold even if a route is reached another way.

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getUserPharmacyId, getUserRole } from '@/lib/auth/claims'
import type { OnboardingActor } from './events'
import type { WizardCtx } from './application'

const NO_STORE = { 'Cache-Control': 'no-store' }

export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE })
}

/** A library result: ok answers 200 with the rest of it; a refusal keeps its status. */
export function respond(result: { ok: boolean; status?: number; error?: string } & Record<string, unknown>): NextResponse {
  const { ok, status, ...rest } = result
  if (ok) return json(rest)
  return json(rest, status ?? 500)
}

/** A write from another site (CSRF): refused. Same-origin and non-browser requests pass. */
export function crossSiteRefusal(request: { headers: { get(name: string): string | null } }): NextResponse | null {
  return request.headers.get('sec-fetch-site') === 'cross-site' ? json({ error: 'Forbidden' }, 403) : null
}

async function verifiedUser() {
  const supabase = await createServerClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  return error || !user ? null : user
}

export async function pharmacyAdmin(): Promise<{ ok: true; ctx: WizardCtx } | { ok: false; response: NextResponse }> {
  const user = await verifiedUser()
  if (!user) return { ok: false, response: json({ error: 'Unauthorized' }, 401) }
  const pharmacyId = getUserPharmacyId(user)
  if (getUserRole(user) !== 'pharmacy_admin' || !pharmacyId) return { ok: false, response: json({ error: 'Forbidden' }, 403) }
  return { ok: true, ctx: { pharmacyId, userId: user.id } }
}

export async function opsAdmin(): Promise<{ ok: true; actor: OnboardingActor } | { ok: false; response: NextResponse }> {
  const user = await verifiedUser()
  if (!user) return { ok: false, response: json({ error: 'Unauthorized' }, 401) }
  if (getUserRole(user) !== 'ops_admin') return { ok: false, response: json({ error: 'Forbidden' }, 403) }
  return { ok: true, actor: { userId: user.id, role: 'ops_admin' } }
}

/** The JSON body as an object; anything else reads as empty. */
export async function bodyOf(request: Request): Promise<Record<string, unknown>> {
  try {
    const b = await request.json()
    return b && typeof b === 'object' && !Array.isArray(b) ? b as Record<string, unknown> : {}
  } catch {
    return {}
  }
}
