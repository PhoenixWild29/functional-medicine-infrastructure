// GET    /api/integrations/keragon/connection: status and the recent sync log
// DELETE /api/integrations/keragon/connection: disconnect (the secret is deleted)
// Clinic admin of their own clinic only (lib/integrations/keragon/access).
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { crossSite, requireClinicAdmin } from '@/lib/integrations/keragon/access'
import { disconnect, loadConnection } from '@/lib/integrations/keragon/connection'
import { withApiErrors } from '@/lib/api/with-api-errors'

export const dynamic = 'force-dynamic'

async function getHandler() {
  const who = await requireClinicAdmin()
  if (!who.ok) return who.response
  const r = await loadConnection(who.db, who.clinicId)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ connection: r.connection, events: r.events })
}

async function deleteHandler(request: NextRequest) {
  const refused = crossSite(request)
  if (refused) return refused
  const who = await requireClinicAdmin()
  if (!who.ok) return who.response
  const r = await disconnect(who.db, { clinicId: who.clinicId, userId: who.user.id })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ connection: r.connection })
}

export const GET = withApiErrors('/api/integrations/keragon/connection', getHandler)
export const DELETE = withApiErrors('/api/integrations/keragon/connection', deleteHandler)
