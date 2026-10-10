// ============================================================
// Onboarding audit log (clinic_onboarding_events, append-only)
// ============================================================
//
// Every invite action, submission and ops review is recorded: who (user
// id and role), what, which invite, and the note ops wrote when sending a
// clinic back. No patient data. A failed write is logged loudly but does
// not undo the action it records (the action already happened).

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

export type OnboardingEvent =
  | 'invite_created' | 'invite_revoked' | 'invite_resent' | 'invite_accepted'
  | 'submitted' | 'approved' | 'sent_back'

export async function recordOnboardingEvent(
  supabase: SupabaseClient<Database>,
  e: { clinicId: string; event: OnboardingEvent; actorUserId: string | null; actorRole: string | null; inviteId?: string | null; note?: string | null },
): Promise<void> {
  const { error } = await supabase.from('clinic_onboarding_events').insert({
    clinic_id:     e.clinicId,
    event:         e.event,
    actor_user_id: e.actorUserId,
    actor_role:    e.actorRole,
    invite_id:     e.inviteId ?? null,
    note:          e.note ?? null,
  })
  if (error) {
    console.error(`[onboarding] audit event could not be recorded | clinic=${e.clinicId} event=${e.event}: ${error.message}`)
  }
}
