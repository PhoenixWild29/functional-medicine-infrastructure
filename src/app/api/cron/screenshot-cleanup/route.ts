// ============================================================
// Screenshot Cleanup Cron — WO-20
// GET /api/cron/screenshot-cleanup
// Schedule: 0 * * * * (every hour)
// ============================================================
//
// REQ-PTA-005: Enforces the 72-hour auto-delete policy for screenshots
// stored in the adapter-screenshots Supabase Storage bucket.
//
// Supabase Storage does not natively support per-object TTL without
// enterprise configuration. This cron deletes objects older than
// SCREENSHOT_TTL_HOURS (72) by listing objects and filtering by
// last_accessed_at / created_at.
//
// HIPAA: Screenshots contain PHI (patient info visible on portal
// confirmation pages). The 72-hour retention limit ensures PHI is
// not retained indefinitely in secondary storage.
//
// Safe to re-run: Supabase Storage delete is idempotent for missing paths.
// Runs hourly to ensure timely deletion without over-sampling.

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
  const cutoff   = new Date(cutoffMs).toISOString()

  // ── List all objects in adapter-screenshots bucket ────────
  // Recursively lists the portal/ prefix where all screenshots are stored.
  const { data: objects, error: listError } = await supabase.storage
    .from(SCREENSHOT_BUCKET)
    .list('portal', {
      limit:  1000,
      offset: 0,
      sortBy: { column: 'created_at', order: 'asc' },
    })

  if (listError) {
    console.error('[screenshot-cleanup] failed to list objects:', listError.message)
    return NextResponse.json({ error: listError.message }, { status: 500 })
  }

  // Filter to objects older than the TTL cutoff
  const expired = (objects ?? []).filter(obj => {
    const createdAt = obj.created_at ?? obj.updated_at
    if (!createdAt) return false
    return new Date(createdAt).getTime() < cutoffMs
  })

  if (expired.length === 0) {
    const summary = { ran_at: new Date().toISOString(), deleted: 0, cutoff }
    console.info('[screenshot-cleanup] no expired screenshots', summary)
    return NextResponse.json({ status: 'ok', ...summary }, { status: 200 })
  }

  // ── Delete expired objects ─────────────────────────────────
  const pathsToDelete = expired.map(obj => `portal/${obj.name}`)

  const { error: deleteError } = await supabase.storage
    .from(SCREENSHOT_BUCKET)
    .remove(pathsToDelete)

  if (deleteError) {
    console.error('[screenshot-cleanup] delete failed:', deleteError.message)
    return NextResponse.json({ error: deleteError.message }, { status: 500 })
  }

  const summary = {
    ran_at:  new Date().toISOString(),
    deleted: pathsToDelete.length,
    cutoff,
  }

  console.info('[screenshot-cleanup] complete', summary)
  return NextResponse.json({ status: 'ok', ...summary }, { status: 200 })
}

// Return 405 for all non-GET methods
export function POST()   { return new NextResponse(null, { status: 405 }) }
export function PUT()    { return new NextResponse(null, { status: 405 }) }
export function PATCH()  { return new NextResponse(null, { status: 405 }) }
export function DELETE() { return new NextResponse(null, { status: 405 }) }
