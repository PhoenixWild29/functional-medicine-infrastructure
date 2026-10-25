// ============================================================
// Proposal Expiry Cron (patient protocol choice, PR 4)
// GET /api/cron/proposal-expiry
// Schedule: 20 * * * * (hourly, see vercel.json)
// ============================================================
//
// A proposal sent, or chosen but never signed, past expires_at (7 days
// from sending) expires; its DRAFT lines are cancelled (never signed) and
// its link dies (lib/proposals/expire). Safe to re-run. Counts only in
// the answer and the logs: no PHI.

import { NextRequest, NextResponse } from 'next/server'
import { cronAuthFailure } from '@/lib/cron/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { expireProposals } from '@/lib/proposals/expire'
import { withApiErrors } from '@/lib/api/with-api-errors'

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const denied = cronAuthFailure(request, 'proposal-expiry')
  if (denied) return denied
  try {
    const result = await expireProposals(createServiceClient(), new Date())
    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    console.error('[proposal-expiry] run failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Proposal expiry failed' }, { status: 500 })
  }
}

export const GET = withApiErrors('/api/cron/proposal-expiry', getHandler)
