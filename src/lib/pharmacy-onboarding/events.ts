// ============================================================
// Pharmacy onboarding audit log (pharmacy_onboarding_events)
// ============================================================
//
// Append-only (migration 20261014000001). Ops actions are recorded BEFORE
// they happen: an action whose audit row cannot be written does not
// happen (the caller answers 503). If the action then fails, a
// "<action>_failed" row follows, best effort. Codes and ids only: never
// free text (a send-back note lives on the application), never PHI.

import type { SupabaseClient } from '@supabase/supabase-js'

export interface OnboardingActor {
  userId: string | null
  role:   string
}

export interface OnboardingEvent {
  actor:          OnboardingActor
  action:         string
  inviteId?:      string | null
  pharmacyId?:    string | null
  applicationId?: string | null
  stateCode?:     string | null
  detail?:        Record<string, string | number | boolean | null>
}

const ACTION_RE = /^[a-z_]{1,60}$/

export async function recordOnboardingEvent(db: SupabaseClient, e: OnboardingEvent): Promise<boolean> {
  if (!ACTION_RE.test(e.action)) throw new Error(`onboarding event action must be a code: ${e.action}`)
  const { error } = await db.from('pharmacy_onboarding_events').insert({
    actor_user_id:  e.actor.userId,
    actor_role:     e.actor.role,
    action:         e.action,
    invite_id:      e.inviteId ?? null,
    pharmacy_id:    e.pharmacyId ?? null,
    application_id: e.applicationId ?? null,
    state_code:     e.stateCode ?? null,
    detail:         e.detail ?? {},
  })
  if (error) {
    console.error(`[pharmacy-onboarding] audit row (${e.action}) could not be written:`, error.code ?? error.message)
    return false
  }
  return true
}

/** The answer when an ops action's audit row could not be written. */
export const AUDIT_UNAVAILABLE = 'The action could not be recorded in the audit log, so it was not done. Try again.'
