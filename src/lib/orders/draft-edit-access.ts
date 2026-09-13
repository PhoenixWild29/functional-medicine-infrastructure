// ============================================================
// WO-98 × WO-100: who may edit / add lines to a draft right now
// ============================================================
//
// Rule: a provider who is not the draft's provider must reassign the
// draft to themself with "Sign as me" before editing it or adding lines.
// The order-creation API already refuses (403) a provider creating an
// order under another provider's id; this keeps the UI from offering
// Edit / + Add prescription actions that would dead-end on that 403.
//
// MA and clinic admin behaviour is unchanged: they choose the provider
// and may edit drafts per WO-98's server-side rules.

export interface DraftViewer {
  /** app_role === 'provider' */
  isProvider: boolean
  /** The signed-in provider's own provider_id; null when not a provider or not linked. */
  providerId: string | null
}

export type DraftEditMode = 'edit' | 'sign-as-me'

/**
 * 'sign-as-me' when the viewer is a provider and the draft is assigned to
 * someone else (or the provider login is not linked to a provider row, in
 * which case the Sign as me page explains the problem). Otherwise 'edit'.
 */
export function draftEditMode(viewer: DraftViewer | null | undefined, draftProviderId: string | null | undefined): DraftEditMode {
  if (!viewer?.isProvider) return 'edit'
  if (!draftProviderId) return 'edit'
  return viewer.providerId === draftProviderId ? 'edit' : 'sign-as-me'
}

/** API error copy for a provider creating/adding to a draft that is not theirs. */
export const DRAFT_BELONGS_TO_OTHER_PROVIDER_ERROR =
  'This draft belongs to another provider. Reassign it to yourself with Sign as me before adding or editing prescriptions.'

export const DRAFT_BELONGS_TO_OTHER_PROVIDER_CODE = 'DRAFT_BELONGS_TO_OTHER_PROVIDER'
