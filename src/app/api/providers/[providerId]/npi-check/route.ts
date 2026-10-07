// ============================================================
// POST /api/providers/[providerId]/npi-check (Compliance C4)
// ============================================================
//
// The clinic admin re-runs a provider's NPI check against the NPPES
// registry. The result is stored whatever it is (an unreachable registry
// is 'unverified'); signing reads it.

import { NextRequest, NextResponse } from 'next/server'
import { clinicAdminForProvider } from '@/lib/providers/team-access'
import { runNpiCheck } from '@/lib/providers/verify-npi'

export async function POST(_request: NextRequest, { params }: { params: Promise<{ providerId: string }> }): Promise<NextResponse> {
  const { providerId } = await params
  const access = await clinicAdminForProvider(providerId)
  if (!access.ok) return access.response

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
