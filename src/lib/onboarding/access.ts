// ============================================================
// Who may act in clinic onboarding
// ============================================================
//
// Every caller is verified with getUser() (never getSession()); role and
// clinic come only from app_metadata (src/lib/auth/claims).
//
//   requireOpsAdmin()        ops_admin: invites, review, approval
//   requireOnboardingAdmin() the clinic admin of their own clinic; with
//                            { editable: true }, only while onboarding is
//                            open (in progress or sent back), so a
//                            submitted or approved clinic is 409
//
// Writes use the service role, after these checks.

import { NextResponse } from 'next/server'
import type { User } from '@supabase/supabase-js'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getUserClinicId, getUserRole } from '@/lib/auth/claims'
import { isEditable } from './steps'

type Service = ReturnType<typeof createServiceClient>

export type OpsAccess =
  | { ok: true; user: User; supabase: Service }
  | { ok: false; response: NextResponse }

export async function requireOpsAdmin(): Promise<OpsAccess> {
  const supabaseAuth = await createServerClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (getUserRole(user) !== 'ops_admin') {
    return { ok: false, response: NextResponse.json({ error: 'Only CompoundIQ ops can manage clinic onboarding.' }, { status: 403 }) }
  }
  return { ok: true, user, supabase: createServiceClient() }
}

export interface OnboardingClinic {
  clinic_id:         string
  name:              string
  onboarding_status: string
}

export type AdminAccess =
  | { ok: true; user: User; clinicId: string; clinic: OnboardingClinic; supabase: Service }
  | { ok: false; response: NextResponse }

export async function requireOnboardingAdmin(opts: { editable?: boolean } = {}): Promise<AdminAccess> {
  const supabaseAuth = await createServerClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const clinicId = getUserClinicId(user)
  if (getUserRole(user) !== 'clinic_admin' || !clinicId) {
    return { ok: false, response: NextResponse.json({ error: 'Only the clinic admin can complete onboarding.' }, { status: 403 }) }
  }

  const supabase = createServiceClient()
  const { data: clinic, error } = await supabase
    .from('clinics')
    .select('clinic_id, name, onboarding_status')
    .eq('clinic_id', clinicId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) {
    console.error(`[onboarding] clinic read failed | clinic=${clinicId}: ${error.message}`)
    return { ok: false, response: NextResponse.json({ error: 'Your clinic could not be read. Try again.' }, { status: 503 }) }
  }
  if (!clinic) return { ok: false, response: NextResponse.json({ error: 'Clinic not found' }, { status: 404 }) }

  if (opts.editable && !isEditable(clinic.onboarding_status)) {
    const message = clinic.onboarding_status === 'approved'
      ? 'Your clinic is approved; onboarding is closed.'
      : 'Your onboarding has been submitted for review and cannot be changed until CompoundIQ responds.'
    return { ok: false, response: NextResponse.json({ error: message }, { status: 409 }) }
  }
  return { ok: true, user, clinicId, clinic: clinic as OnboardingClinic, supabase }
}

/** Mark one wizard step's status (service role, after an access check). */
export async function setStep(
  supabase: Service,
  clinicId: string,
  step: string,
  status: 'not_started' | 'in_progress' | 'complete',
  userId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from('clinic_onboarding_steps')
    .upsert({ clinic_id: clinicId, step, status, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: 'clinic_id,step' })
  if (error) {
    console.error(`[onboarding] step could not be saved | clinic=${clinicId} step=${step}: ${error.message}`)
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

/** A JSON body, or null when it is not valid JSON. */
export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json() as unknown
    return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}
  } catch {
    return null
  }
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/** A normalised email, or null. */
export function cleanEmail(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const e = v.trim().toLowerCase()
  return e.length <= 254 && EMAIL_RE.test(e) ? e : null
}
