// POST /api/integrations/keragon/connection/secret
// Generate (first time, or after a disconnect) or rotate the clinic's
// shared secret. The secret is in this response only; it is stored in
// Vault and never shown again. Rotating stops the old secret at once.
// Clinic admin of their own clinic only.
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { crossSite, requireClinicAdmin } from '@/lib/integrations/keragon/access'
import { issueSecret } from '@/lib/integrations/keragon/connection'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const refused = crossSite(request)
  if (refused) return refused
  const who = await requireClinicAdmin()
  if (!who.ok) return who.response
  const r = await issueSecret(who.db, { clinicId: who.clinicId, userId: who.user.id })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json(
    { secret: r.secret, rotated: r.rotated, connection: r.connection },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
