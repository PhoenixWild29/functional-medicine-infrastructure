// ============================================================
// Stripe reconciliation cron (Payment and Order Flow v1.1, step 3)
// GET /api/cron/reconcile-stripe
// Schedule: 0 6 * * * (daily, 06:00 UTC)
// ============================================================
//
// Reconciles the previous UTC day: the ledger's charge, refund and
// dispute lines against Stripe's balance transactions (read-only; see
// lib/payments/reconcile). One reconciliation_runs row per run; ops are
// alerted on a mismatch or an error, with IDs and amounts only.
//
// 200 matched or mismatch (recorded and alerted) · 500 the day could not
// be reconciled · 500 CRON_SECRET unset · 401 wrong header.

import { NextRequest, NextResponse } from 'next/server'
import { cronAuthFailure } from '@/lib/cron/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { createStripeClient } from '@/lib/stripe/client'
import { reconcileDay } from '@/lib/payments/reconcile'

export const dynamic = 'force-dynamic'

/** The UTC day before `now`, as YYYY-MM-DD. */
function previousUtcDay(now: Date): string {
  return new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10)
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const denied = cronAuthFailure(request, 'reconcile-stripe')
  if (denied) return denied

  const day = previousUtcDay(new Date())
  const result = await reconcileDay(createServiceClient(), createStripeClient(), day)
  return NextResponse.json({ day, ...result }, { status: result.status === 'error' ? 500 : 200 })
}

export function POST()   { return new NextResponse(null, { status: 405 }) }
export function PUT()    { return new NextResponse(null, { status: 405 }) }
export function PATCH()  { return new NextResponse(null, { status: 405 }) }
export function DELETE() { return new NextResponse(null, { status: 405 }) }
