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
// HIPAA: Screenshots contain PHI (patient info on portal pages).
// 72-hour retention ensures PHI is not retained in secondary storage.
//
// Safe to re-run: .remove() is idempotent for missing paths.

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { SCREENSHOT_BUCKET, SCREENSHOT_TTL_HOURS } from '@/lib/playwright/config'

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Verify Vercel cron secret
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const cutoffMs = Date.now() - SCREENSHOT_TTL_HOURS * 60 * 60 * 1000

  // ── Step 1: List order-level subdirectories under portal/ ─
  const { data: subdirs, error: listError } = await supabase.storage
    .from(SCREENSHOT_BUCKET)
    .list('portal', { limit: 1000, offset: 0 })

  if (listError) {
    console.error('[screenshot-cleanup] failed to list portal/ subdirectories:', listError.message)
    return NextResponse.json({ error: listError.message }, { status: 500 })
  }

  if (!subdirs || subdirs.length === 0) {
    const summary = { ran_at: new Date().toISOString(), deleted: 0, cutoff: new Date(cutoffMs).toISOString() }
    console.info('[screenshot-cleanup] no subdirectories found', summary)
    return NextResponse.json({ status: 'ok', ...summary }, { status: 200 })
  }

  // ── Step 2: For each subdirectory, list actual files ──────
  const pathsToDelete: string[] = []
  let listErrors = 0

  for (const subdir of subdirs) {
    // Supabase returns a placeholder file for empty folders — skip non-directories
    if (!subdir.id || subdir.id === '') continue

    const prefix = `portal/${subdir.name}`

    const { data: files, error: filesError } = await supabase.storage
      .from(SCREENSHOT_BUCKET)
      .list(prefix, { limit: 100, offset: 0 })

    if (filesError) {
      console.error(`[screenshot-cleanup] failed to list ${prefix}:`, filesError.message)
      listErrors++
      continue
    }

    for (const file of files ?? []) {
      const createdAt = file.created_at ?? file.updated_at
      if (!createdAt) continue

      if (new Date(createdAt).getTime() < cutoffMs) {
        pathsToDelete.push(`${prefix}/${file.name}`)
      }
    }
  }

  if (pathsToDelete.length === 0) {
    const summary = {
      ran_at:      new Date().toISOString(),
      deleted:     0,
      cutoff:      new Date(cutoffMs).toISOString(),
      list_errors: listErrors,
    }
    console.info('[screenshot-cleanup] no expired screenshots', summary)
    return NextResponse.json({ status: 'ok', ...summary }, { status: 200 })
  }

  // ── Step 3: Delete expired files in a single batch ────────
  const { error: deleteError } = await supabase.storage
    .from(SCREENSHOT_BUCKET)
    .remove(pathsToDelete)

  if (deleteError) {
    console.error('[screenshot-cleanup] delete failed:', deleteError.message)
    return NextResponse.json({ error: deleteError.message }, { status: 500 })
  }

  const summary = {
    ran_at:      new Date().toISOString(),
    deleted:     pathsToDelete.length,
    cutoff:      new Date(cutoffMs).toISOString(),
    list_errors: listErrors,
  }

  console.info('[screenshot-cleanup] complete', summary)
  return NextResponse.json({ status: 'ok', ...summary }, { status: 200 })
}

// Return 405 for all non-GET methods
export function POST()   { return new NextResponse(null, { status: 405 }) }
export function PUT()    { return new NextResponse(null, { status: 405 }) }
export function PATCH()  { return new NextResponse(null, { status: 405 }) }
export function DELETE() { return new NextResponse(null, { status: 405 }) }
