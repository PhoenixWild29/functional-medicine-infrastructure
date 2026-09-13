// ============================================================
// WO-100 × WO-98: a provider may only act on drafts under their own name
// ============================================================
//
// One server-side check shared by every route that writes a draft line:
//   - POST   /api/orders            (create a draft / + Add prescription)
//   - PATCH  /api/orders/[orderId]  (edit a draft line)
//   - DELETE /api/orders/[orderId]  (remove a draft line)
//
// Rule: if the caller is a provider and the draft's provider is not the
// caller's own provider row, refuse with 403 — they must reassign the
// draft to themself with Sign as me first. A provider-role login that is
// not linked to a provider row is refused too (it could never sign).
// Medical assistants and clinic admins are not affected by this check;
// their own rules (e.g. WO-98's creator rule) still apply in the route.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { isProviderRole, resolveCurrentProvider } from '@/lib/auth/current-provider'
import {
  DRAFT_BELONGS_TO_OTHER_PROVIDER_CODE,
  DRAFT_BELONGS_TO_OTHER_PROVIDER_ERROR,
} from './draft-edit-access'

export const PROVIDER_NOT_LINKED_ERROR =
  'Provider account is not linked to a Supabase Auth user. Contact ops to complete provider onboarding before prescribing.'

export interface ProviderDraftGuardInput {
  /** session.user.user_metadata.app_role */
  appRole:         unknown
  /** session.user.id */
  userId:          string
  clinicId:        string
  /** The provider the draft is (or would be) assigned to. */
  draftProviderId: string | null | undefined
}

export type ProviderDraftGuardResult =
  | { ok: true }
  | {
      ok:     false
      status: 403
      reason: 'not_linked' | 'other_provider'
      body:   { error: string; code?: string }
    }

export async function checkProviderOwnsDraft(
  supabase: SupabaseClient<Database>,
  { appRole, userId, clinicId, draftProviderId }: ProviderDraftGuardInput,
): Promise<ProviderDraftGuardResult> {
  if (!isProviderRole(appRole)) return { ok: true }

  const me = await resolveCurrentProvider(supabase, { userId, clinicId })
  if (!me) {
    return { ok: false, status: 403, reason: 'not_linked', body: { error: PROVIDER_NOT_LINKED_ERROR } }
  }
  if (me.provider_id !== draftProviderId) {
    return {
      ok:     false,
      status: 403,
      reason: 'other_provider',
      body:   { error: DRAFT_BELONGS_TO_OTHER_PROVIDER_ERROR, code: DRAFT_BELONGS_TO_OTHER_PROVIDER_CODE },
    }
  }
  return { ok: true }
}
