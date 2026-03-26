// ============================================================
// Adapter Action — POST /api/ops/adapters/[pharmacyId]/action
// ============================================================
//
// Quick actions per pharmacy for ops intervention.
//
// Actions:
//   disable_adapter     — Set pharmacies.is_active = false (REQ-AHM-006)
//   enable_adapter      — Set pharmacies.is_active = true
//   force_tier4         — Override pharmacies.integration_tier = TIER_4_FAX (REQ-AHM-006)
//   close_circuit       — Reset circuit_breaker_state: CLOSED, failure_count = 0 (REQ-AHM-006)
//
// Auth: ops_admin only.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient }  from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

// BLK-02: UUID v4 pattern for pharmacyId validation
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

interface Params { params: Promise<{ pharmacyId: string }> }

export async function POST(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const { pharmacyId } = await params
  const supabaseAuth = await createServerClient()
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (session.user.user_metadata['app_role'] !== 'ops_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // BLK-02: Validate pharmacyId is a UUID before touching the DB
  if (!pharmacyId || !UUID_RE.test(pharmacyId)) {
    return NextResponse.json({ error: 'Invalid pharmacyId' }, { status: 400 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const action = body['action'] as string | undefined
  if (!action) {
    return NextResponse.json({ error: 'Missing action' }, { status: 400 })
  }

  // NB-07: distinguish no-email sessions in audit logs
  const actorEmail = session.user.email
    ? session.user.email
    : `[no-email, id=${session.user.id}]`
  const supabase   = createServiceClient()

  // Verify pharmacy exists
  const { data: pharmacy, error: fetchErr } = await supabase
    .from('pharmacies')
    .select('pharmacy_id, name, integration_tier, is_active')
    .eq('pharmacy_id', pharmacyId)
    .is('deleted_at', null)
    .maybeSingle()

  if (fetchErr) {
    console.error(`[ops/adapters/action] pharmacy fetch error | pharmacy=${pharmacyId}:`, fetchErr.message)
    return NextResponse.json({ error: 'Pharmacy lookup failed' }, { status: 500 })
  }
  if (!pharmacy) {
    return NextResponse.json({ error: 'Pharmacy not found' }, { status: 404 })
  }

  switch (action) {

    // ── Disable Adapter ───────────────────────────────────────
    case 'disable_adapter': {
      const { error } = await supabase
        .from('pharmacies')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('pharmacy_id', pharmacyId)
        .is('deleted_at', null)  // BLK-03: guard against soft-deleted pharmacy
      if (error) {
        console.error(`[ops/adapters/action] disable failed | pharmacy=${pharmacyId}:`, error.message)
        return NextResponse.json({ error: 'Disable failed' }, { status: 500 })
      }
      console.info(`[ops/adapters/action] disabled | pharmacy=${pharmacyId} | by=${actorEmail}`)
      return NextResponse.json({ ok: true })
    }

    // ── Enable Adapter ────────────────────────────────────────
    case 'enable_adapter': {
      const { error } = await supabase
        .from('pharmacies')
        .update({ is_active: true, updated_at: new Date().toISOString() })
        .eq('pharmacy_id', pharmacyId)
        .is('deleted_at', null)  // BLK-03: guard against soft-deleted pharmacy
      if (error) {
        console.error(`[ops/adapters/action] enable failed | pharmacy=${pharmacyId}:`, error.message)
        return NextResponse.json({ error: 'Enable failed' }, { status: 500 })
      }
      console.info(`[ops/adapters/action] enabled | pharmacy=${pharmacyId} | by=${actorEmail}`)
      return NextResponse.json({ ok: true })
    }

    // ── Force Tier 4 Fallback ─────────────────────────────────
    // Advisory override — adapter engine reads this on next submission.
    // Original tier is logged via console for manual revert if needed.
    case 'force_tier4': {
      const previousTier = pharmacy.integration_tier
      const { error } = await supabase
        .from('pharmacies')
        .update({ integration_tier: 'TIER_4_FAX', updated_at: new Date().toISOString() })
        .eq('pharmacy_id', pharmacyId)
      if (error) {
        console.error(`[ops/adapters/action] force_tier4 failed | pharmacy=${pharmacyId}:`, error.message)
        return NextResponse.json({ error: 'Force Tier 4 failed' }, { status: 500 })
      }
      console.info(
        `[ops/adapters/action] force_tier4 | pharmacy=${pharmacyId} | prev=${previousTier} | by=${actorEmail}`,
        '— manually revert via Catalog Management when resolved'
      )
      return NextResponse.json({ ok: true, previousTier })
    }

    // ── Close Circuit Breaker ─────────────────────────────────
    case 'close_circuit': {
      const { error } = await supabase
        .from('circuit_breaker_state')
        .upsert({
          pharmacy_id:   pharmacyId,
          state:         'CLOSED',
          failure_count: 0,
          cooldown_until: null,
          updated_at:    new Date().toISOString(),
        }, { onConflict: 'pharmacy_id' })
      if (error) {
        console.error(`[ops/adapters/action] close_circuit failed | pharmacy=${pharmacyId}:`, error.message)
        return NextResponse.json({ error: 'Close circuit failed' }, { status: 500 })
      }
      console.info(`[ops/adapters/action] close_circuit | pharmacy=${pharmacyId} | by=${actorEmail}`)
      return NextResponse.json({ ok: true })
    }

    default:
      // BLK-01: do not echo user-supplied action string; log server-side only
      console.warn(`[ops/adapters/action] unknown action | pharmacy=${pharmacyId} | action=${action} | by=${actorEmail}`)
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }
}

export function GET()    { return new NextResponse(null, { status: 405 }) }
export function PUT()    { return new NextResponse(null, { status: 405 }) }
export function PATCH()  { return new NextResponse(null, { status: 405 }) }
export function DELETE() { return new NextResponse(null, { status: 405 }) }
