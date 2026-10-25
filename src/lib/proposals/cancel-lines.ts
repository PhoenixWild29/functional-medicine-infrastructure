// ============================================================
// Cancel a plan's DRAFT lines (patient protocol choice)
// ============================================================
//
// Expiry, cancel and sign (the unchosen lines) all move a plan's drafts
// DRAFT -> CANCELLED. Each line goes through casTransition, so the state
// machine's rules hold here too (B-2026-10-25-08): the transition is
// legal, the actor's role may make it, and casTransition writes the
// order_status_history row. A line that already left DRAFT is a no-op.
// The batch keeps going after one line fails, and says so.

import { casTransition } from '@/lib/orders/cas-transition'
import type { ActorType } from '@/lib/orders/state-machine'

const CLINIC_ROLES: ReadonlySet<string> = new Set(['clinic_admin', 'provider', 'medical_assistant'])

/** A clinic user's app_role as a state-machine actor, or null when it is none. */
export function clinicActorRole(role: string | null | undefined): ActorType | null {
  return role && CLINIC_ROLES.has(role) ? role as ActorType : null
}

export type CancelLinesResult =
  | { ok: true; cancelledOrderIds: string[] }
  | { ok: false; cancelledOrderIds: string[]; error: string }

export async function cancelDraftLines(
  db: unknown,
  input: { orderIds: string[]; actor: string; actorRole: ActorType; metadata: Record<string, unknown> },
): Promise<CancelLinesResult> {
  const cancelledOrderIds: string[] = []
  const failures: string[] = []
  for (const orderId of input.orderIds) {
    try {
      const r = await casTransition({
        orderId,
        expectedStatus: 'DRAFT',
        newStatus:      'CANCELLED',
        actor:          input.actor,
        actorRole:      input.actorRole,
        metadata:       input.metadata,
        client:         db as never,
      })
      if (!r.wasAlreadyTransitioned) cancelledOrderIds.push(orderId)
    } catch (err) {
      failures.push(`${orderId}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return failures.length === 0
    ? { ok: true, cancelledOrderIds }
    : { ok: false, cancelledOrderIds, error: failures.join('; ') }
}
