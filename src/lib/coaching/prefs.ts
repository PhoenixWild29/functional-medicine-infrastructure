// ============================================================
// Coaching preferences (user_metadata.coaching)
// ============================================================
//
// Whether the setup checklist is hidden or done for good, and whether the
// first-prescription tips were seen. Display preferences only, stored on
// the auth user's user_metadata (no table): never a role, clinic or
// pharmacy, which come only from app_metadata (src/lib/auth/claims.ts).
// Written with the admin API from POST /api/coaching/prefs, after
// getUser(), merged with the rest of the metadata.

export interface CoachingPrefs {
  checklistHidden: boolean
  checklistDone:   boolean
  rxTipsSeen:      boolean
}

export function coachingPrefs(user: { user_metadata?: unknown } | null | undefined): CoachingPrefs {
  const meta = user?.user_metadata
  const c = meta && typeof meta === 'object' ? (meta as Record<string, unknown>)['coaching'] : null
  const o = c && typeof c === 'object' ? c as Record<string, unknown> : {}
  return {
    checklistHidden: o['checklist_hidden'] === true,
    checklistDone:   o['checklist_done'] === true,
    rxTipsSeen:      o['rx_tips_seen'] === true,
  }
}

/** The user's metadata with the coaching preferences changed, everything else kept. */
export function withCoaching(meta: unknown, patch: Partial<CoachingPrefs>): Record<string, unknown> {
  const base = meta && typeof meta === 'object' ? { ...(meta as Record<string, unknown>) } : {}
  const next = { ...coachingPrefs({ user_metadata: base }), ...patch }
  return {
    ...base,
    coaching: { checklist_hidden: next.checklistHidden, checklist_done: next.checklistDone, rx_tips_seen: next.rxTipsSeen },
  }
}
