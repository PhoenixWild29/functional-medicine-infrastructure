// ============================================================
// POST /api/providers/[providerId]/npi-check (Compliance C4)
// ============================================================
//
// The clinic admin re-runs a provider's NPI check against the NPPES
// registry. The result is stored whatever it is (an unreachable registry
// is 'unverified'); signing reads it.
//
// A demo record (source demo_seed) is never re-checked: the demo NPIs are
// fictional, so the registry would answer not_found and that provider
// could no longer sign. 409, nothing called or written.

import { NextRequest, NextResponse } from 'next/server'
import { clinicAdminForProvider } from '@/lib/providers/team-access'
import { runNpiCheck } from '@/lib/providers/verify-npi'
import { DEMO_RECORD_NOTE } from '@/lib/providers/credentials'

export async function POST(_request: NextRequest, { params }: { params: Promise<{ providerId: string }> }): Promise<NextResponse> {
  const { providerId } = await params
  const access = await clinicAdminForProvider(providerId)
  if (!access.ok) return access.response

  const { data: existing, error: readError } = await access.supabase
    .from('provider_npi_verifications')
    .select('source')
    .eq('provider_id', providerId)
    .maybeSingle()
  if (readError) {
    console.error('[npi-check] verification read failed:', readError.message)
    return NextResponse.json({ error: 'The NPI record could not be read. Try again.' }, { status: 500 })
  }
  if ((existing as { source?: string } | null)?.source === 'demo_seed') {
    return NextResponse.json({ error: DEMO_RECORD_NOTE }, { status: 409 })
  }

  const result = await runNpiCheck(access.supabase, access.provider, access.user.id)
  if (!result.ok) return NextResponse.json({ error: result.error, status: result.lookup.status }, { status: 500 })
  return NextResponse.json({
    status:       result.lookup.status,
    nameMatch:    result.lookup.nameMatch,
    taxonomyDesc: result.lookup.taxonomyDesc,
    reason:       result.lookup.reason,
    checkedAt:    result.checkedAt,
  })
}
