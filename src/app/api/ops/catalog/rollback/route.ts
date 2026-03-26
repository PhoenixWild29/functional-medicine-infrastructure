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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function POST(request: NextRequest): Promise<NextResponse> {
  const supabaseAuth = await createServerClient()
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (session.user.user_metadata['app_role'] !== 'ops_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const pharmacyId      = body['pharmacyId']      as string | undefined
  const targetHistoryId = body['targetHistoryId'] as string | undefined

  if (!pharmacyId || !UUID_RE.test(pharmacyId)) {
    return NextResponse.json({ error: 'Invalid or missing pharmacyId' }, { status: 400 })
  }
  if (!targetHistoryId || !UUID_RE.test(targetHistoryId)) {
    return NextResponse.json({ error: 'Invalid or missing targetHistoryId' }, { status: 400 })
  }

  const actorEmail = session.user.email
    ? session.user.email
    : `[no-email, id=${session.user.id}]`
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
    return NextResponse.json({ error: 'Rollback failed — could not remove current catalog' }, { status: 500 })
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
    await supabase
      .from('catalog')
      .update({ is_active: true, deleted_at: null, updated_at: now })
      .eq('pharmacy_id', pharmacyId)
      .eq('deleted_at', now)  // Only the rows we just soft-deleted in this request

    if (restoreErr) {
      console.error(`[ops/catalog/rollback] restore failed | pharmacy=${pharmacyId}:`, restoreErr.message)
      return NextResponse.json({ error: 'Rollback failed — could not restore target catalog' }, { status: 500 })
    }

    return NextResponse.json({
      error: 'Target version has no items to restore — it may predate upload tracking',
    }, { status: 409 })
  }

  // BLK-06: Deactivate the currently active version (scoped to the one version that is active),
  // then activate the target version.
  await supabase
    .from('catalog_upload_history')
    .update({ is_active: false })
    .eq('pharmacy_id', pharmacyId)
    .eq('is_active', true)
    .neq('history_id', targetHistoryId)

  await supabase
    .from('catalog_upload_history')
    .update({ is_active: true })
    .eq('history_id', targetHistoryId)

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
