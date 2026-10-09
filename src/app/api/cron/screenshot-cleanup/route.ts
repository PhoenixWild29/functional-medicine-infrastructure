// ============================================================
// Screenshot Cleanup Cron — WO-20
// GET /api/cron/screenshot-cleanup
// Schedule: 0 * * * * (every hour)
// ============================================================
//
// REQ-PTA-005: Enforces the 72-hour auto-delete policy for screenshots
// stored in the adapter-screenshots Supabase Storage bucket.
//
// Supabase Storage does not support per-object TTL. This cron deletes
// objects older than SCREENSHOT_TTL_HOURS (72) by listing the two-level
// path hierarchy: portal/{orderId}/{submissionId}-{label}.png.
//
// BUG-06 fix: Supabase Storage .list() is NOT recursive. Calling
// .list('portal') returns directory entries (order-id subfolders), not
// files. We must iterate each subdirectory to get the actual objects.
//
// C10 fixes:
//   - list() returns a folder with id null (a file has an id). This cron
//     used to skip every entry with no id, i.e. every order folder, so it
//     never deleted anything. Folders are now the entries with id null.
//   - Folders and files are paged through (LIST_PAGE at a time), not just
//     the first 1000 folders and 100 files per folder.
//   - Deleting is a retention action: unless RETENTION_ENABLED is "true"
//     it reports what it would delete (dry_run, would_delete) and removes
//     nothing. With it on, files go in batches of REMOVE_BATCH.
//
// HIPAA: Screenshots contain PHI (patient info on portal pages).
// 72-hour retention ensures PHI is not retained in secondary storage.
//
// Safe to re-run: .remove() is idempotent for missing paths.

import { NextRequest, NextResponse } from 'next/server'
import { cronAuthFailure } from '@/lib/cron/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { SCREENSHOT_BUCKET, SCREENSHOT_TTL_HOURS } from '@/lib/playwright/config'
import { retentionEnabled } from '@/lib/retention/switch'

const LIST_PAGE = 1000
const REMOVE_BATCH = 1000
/** Supabase keeps an empty folder alive with this object; it is not a screenshot. */
const PLACEHOLDER = '.emptyFolderPlaceholder'

type Bucket = ReturnType<ReturnType<typeof createServiceClient>['storage']['from']>
type Entry = { name: string; id: string | null; created_at: string | null; updated_at: string | null }

/** Every entry under a prefix, a page at a time. */
async function listAll(bucket: Bucket, prefix: string): Promise<{ entries: Entry[]; error: string | null }> {
  const entries: Entry[] = []
  for (let offset = 0; ; offset += LIST_PAGE) {
    const { data, error } = await bucket.list(prefix, { limit: LIST_PAGE, offset })
    if (error) return { entries, error: error.message }
    const page = (data ?? []) as Entry[]
    entries.push(...page)
    if (page.length < LIST_PAGE) return { entries, error: null }
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const denied = cronAuthFailure(request, 'screenshot-cleanup')
  if (denied) return denied

  const supabase = createServiceClient()
  const bucket = supabase.storage.from(SCREENSHOT_BUCKET)
  const cutoffMs = Date.now() - SCREENSHOT_TTL_HOURS * 60 * 60 * 1000
  const dryRun = !retentionEnabled()

  // ── Step 1: the order folders under portal/ ─────────────────
  const top = await listAll(bucket, 'portal')
  if (top.error) {
    console.error('[screenshot-cleanup] failed to list portal/ subdirectories:', top.error)
    return NextResponse.json({ error: 'The screenshot folders could not be listed' }, { status: 500 })
  }
  const folders = top.entries.filter(e => e.id === null)

  // ── Step 2: the files in each folder, older than the cutoff ─
  const pathsToDelete: string[] = []
  let listErrors = 0
  for (const folder of folders) {
    const prefix = `portal/${folder.name}`
    const listed = await listAll(bucket, prefix)
    if (listed.error) {
      console.error(`[screenshot-cleanup] failed to list ${prefix}:`, listed.error)
      listErrors++
      continue
    }
    for (const file of listed.entries) {
      if (file.id === null || file.name === PLACEHOLDER) continue
      const createdAt = file.created_at ?? file.updated_at
      if (createdAt && new Date(createdAt).getTime() < cutoffMs) pathsToDelete.push(`${prefix}/${file.name}`)
    }
  }

  const base = {
    ran_at:      new Date().toISOString(),
    cutoff:      new Date(cutoffMs).toISOString(),
    folders:     folders.length,
    list_errors: listErrors,
    dry_run:     dryRun,
  }

  if (dryRun) {
    const summary = { ...base, would_delete: pathsToDelete.length, deleted: 0 }
    console.info('[screenshot-cleanup] dry run (RETENTION_ENABLED is not "true"): nothing removed', summary)
    return NextResponse.json({ status: 'ok', ...summary }, { status: 200 })
  }

  // ── Step 3: delete, a batch at a time ───────────────────────
  let deleted = 0
  for (let i = 0; i < pathsToDelete.length; i += REMOVE_BATCH) {
    const batch = pathsToDelete.slice(i, i + REMOVE_BATCH)
    const { error: deleteError } = await bucket.remove(batch)
    if (deleteError) {
      console.error('[screenshot-cleanup] delete failed:', deleteError.message)
      return NextResponse.json({ error: 'Screenshots could not be deleted', deleted }, { status: 500 })
    }
    deleted += batch.length
  }

  const summary = { ...base, would_delete: pathsToDelete.length, deleted }
  console.info('[screenshot-cleanup] complete', summary)
  return NextResponse.json({ status: 'ok', ...summary }, { status: 200 })
}

// Return 405 for all non-GET methods
export function POST()   { return new NextResponse(null, { status: 405 }) }
export function PUT()    { return new NextResponse(null, { status: 405 }) }
export function PATCH()  { return new NextResponse(null, { status: 405 }) }
export function DELETE() { return new NextResponse(null, { status: 405 }) }
