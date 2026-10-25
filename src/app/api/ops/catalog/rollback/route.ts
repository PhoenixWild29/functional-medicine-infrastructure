// ============================================================
// Catalog Rollback — POST /api/ops/catalog/rollback
// ============================================================
//
// Reverts a pharmacy's catalog to a previous version by:
//   1. Soft-deleting the current active catalog
//   2. Re-activating the items stamped with the target history_id
//   3. Updating the active flag in upload history
//
// REQ-CTM-008: Catalog rollback capability
//
// Items are matched by upload_history_id FK (set during upload/sync).
// This is reliable compared to the old timestamp-window approach.
//
// Auth: ops_admin only.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient }  from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getUserRole } from '@/lib/auth/claims'
import { withApiErrors } from '@/lib/api/with-api-errors'
// Any 8-4-4-4-12 hex id: the seeded demo ids are not RFC v4.
import { UUID_RE } from '@/lib/api/input'
import { readObjectBody } from '@/app/api/ops/_lib/body'

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const supabaseAuth = await createServerClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (getUserRole(user) !== 'ops_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const parsed = await readObjectBody(request)
  if (!parsed.ok) return parsed.response
  const body = parsed.body

  const pharmacyId      = body['pharmacyId']
  const targetHistoryId = body['targetHistoryId']

  if (typeof pharmacyId !== 'string' || !UUID_RE.test(pharmacyId)) {
    return NextResponse.json({ error: 'Invalid or missing pharmacyId' }, { status: 400 })
  }
  if (typeof targetHistoryId !== 'string' || !UUID_RE.test(targetHistoryId)) {
    return NextResponse.json({ error: 'Invalid or missing targetHistoryId' }, { status: 400 })
  }

  const actorEmail = user.email
    ? user.email
    : `[no-email, id=${user.id}]`
  const supabase   = createServiceClient()
  const now        = new Date().toISOString()

  // Fetch target version to validate it belongs to this pharmacy
  const { data: targetVersion, error: versionErr } = await supabase
    .from('catalog_upload_history')
    .select('history_id, pharmacy_id, version_number, uploaded_at, is_active')
    .eq('history_id', targetHistoryId)
    .eq('pharmacy_id', pharmacyId)
    .maybeSingle()

  if (versionErr || !targetVersion) {
    return NextResponse.json({ error: 'Target version not found for this pharmacy' }, { status: 404 })
  }

  const tv = targetVersion as unknown as Record<string, unknown>

  // Soft-delete current active items
  const { error: deleteErr } = await supabase
    .from('catalog')
    .update({ is_active: false, deleted_at: now, updated_at: now })
    .eq('pharmacy_id', pharmacyId)
    .eq('is_active', true)
    .is('deleted_at', null)

  if (deleteErr) {
    console.error(`[ops/catalog/rollback] soft-delete failed | pharmacy=${pharmacyId}:`, deleteErr.message)
    return NextResponse.json({ error: 'Rollback failed: could not remove current catalog' }, { status: 500 })
  }

  // Restore items from the target version using upload_history_id FK (reliable, no timestamp window)
  const { data: restoredItems, error: restoreErr } = await supabase
    .from('catalog')
    .update({ is_active: true, deleted_at: null, updated_at: now })
    .eq('pharmacy_id', pharmacyId)
    .eq('upload_history_id', targetHistoryId)
    .eq('is_active', false)
    .select('item_id')

  // BLK-03: If restore fails or returns 0 rows, re-activate the items we just deleted
  // to preserve the current catalog state rather than leaving the pharmacy with nothing.
  if (restoreErr || (restoredItems?.length ?? 0) === 0) {
    const { error: undoErr } = await supabase
      .from('catalog')
      .update({ is_active: true, deleted_at: null, updated_at: now })
      .eq('pharmacy_id', pharmacyId)
      .eq('deleted_at', now)  // Only the rows we just soft-deleted in this request

    // The undo failed too: the pharmacy is left with no active catalog.
    if (undoErr) {
      console.error(`[ops/catalog/rollback] CRITICAL: undo failed, no active catalog | pharmacy=${pharmacyId}:`, undoErr.message)
      return NextResponse.json({ error: 'The previous catalog could not be put back, so this pharmacy has no active catalog. Roll back to a saved version, or contact engineering.' }, { status: 500 })
    }

    if (restoreErr) {
      console.error(`[ops/catalog/rollback] restore failed | pharmacy=${pharmacyId}:`, restoreErr.message)
      return NextResponse.json({ error: 'Rollback failed: could not restore target catalog' }, { status: 500 })
    }

    return NextResponse.json({
      error: 'Target version has no items to restore. It may predate upload tracking',
    }, { status: 409 })
  }

  // BLK-06: Deactivate the currently active version (scoped to the one version that is active),
  // then activate the target version.
  const { error: deactivateErr } = await supabase
    .from('catalog_upload_history')
    .update({ is_active: false })
    .eq('pharmacy_id', pharmacyId)
    .eq('is_active', true)
    .neq('history_id', targetHistoryId)

  const { error: activateErr } = deactivateErr
    ? { error: null }
    : await supabase
      .from('catalog_upload_history')
      .update({ is_active: true })
      .eq('history_id', targetHistoryId)

  // The items are back, but the version list would show the wrong one as
  // active: say so instead of reporting success.
  const flagsErr = deactivateErr ?? activateErr
  if (flagsErr) {
    console.error(`[ops/catalog/rollback] version flags not saved | pharmacy=${pharmacyId}:`, flagsErr.message)
    return NextResponse.json({
      error: `Catalog items were restored, but the active version could not be recorded. The version list may show v${tv['version_number']} as inactive. Run the rollback again.`,
    }, { status: 500 })
  }

  const restoredCount = restoredItems.length

  console.info(
    `[ops/catalog/rollback] rolled back | pharmacy=${pharmacyId} | target=v${tv['version_number']} | restored=${restoredCount} | by=${actorEmail}`
  )

  return NextResponse.json({
    ok:            true,
    targetVersion: tv['version_number'] as number,
    restoredCount,
  })
}

export function GET()    { return new NextResponse(null, { status: 405 }) }
export function PUT()    { return new NextResponse(null, { status: 405 }) }
export function PATCH()  { return new NextResponse(null, { status: 405 }) }
export function DELETE() { return new NextResponse(null, { status: 405 }) }

export const POST = withApiErrors('/api/ops/catalog/rollback', postHandler)
