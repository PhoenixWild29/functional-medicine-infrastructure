// ============================================================
// Practice dashboard data — GET /api/practice (WO-107)
// ============================================================
//
// ?period=today|7d|30d|mtd|custom (&from=YYYY-MM-DD&to=YYYY-MM-DD)
//
// 200 { period, numbers: Section, attention: Section }
//   Section = { ok: true, data } | { ok: false, error }
//   A section that could not be read says so — the page shows it with
//   Retry, never as a zero or an empty table.
// 401 / 403 / 503 — see lib/practice/access. The clinic comes from the
//   session, never from the request.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { practiceAccess } from '@/lib/practice/access'
import { periodBounds } from '@/lib/practice/metrics'
import { loadPracticeNumbers } from '@/lib/practice/load'
import { loadAttention } from '@/lib/practice/attention'
import { logPhiAccessMany } from '@/lib/audit/phi-access'
import { withApiErrors } from '@/lib/api/with-api-errors'

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const supabaseAuth = await createServerClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  const supabase = createServiceClient()

  const access = await practiceAccess(supabase, user)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const url = new URL(request.url)
  const period = periodBounds(url.searchParams.get('period'), new Date(), {
    from: url.searchParams.get('from'),
    to:   url.searchParams.get('to'),
  })

  const [numbers, attention] = await Promise.all([
    loadPracticeNumbers(supabase, access.clinicId, period),
    loadAttention(supabase, { clinicId: access.clinicId, viewerIsProvider: access.role === 'provider' })
      .then(data => ({ ok: true as const, data }))
      .catch((err: unknown) => {
        console.error('[practice] needs-attention failed:', err instanceof Error ? err.message : err)
        return { ok: false as const, error: 'The needs-attention queue could not be loaded.' }
      }),
  ])

  // Compliance C2 (B14): the needs-attention queue names patients. One row
  // per distinct patient it names (the numbers name none). A read: the
  // dashboard is served even when the rows could not be written.
  // Review L7: an error that names a patient (a draft check that could not
  // run) counts too.
  const queuePatientIds = attention.ok
    ? [...new Set([...attention.data.items, ...attention.data.errors].flatMap(i => (i.patientId ? [i.patientId] : [])))]
    : []
  await logPhiAccessMany({
    user, clinicId: access.clinicId, action: 'view', resource: 'practice_dashboard', route: '/api/practice',
    headers: request.headers ?? null,
  }, queuePatientIds, { dedupeMinutes: 15 })
  return NextResponse.json({ period, numbers, attention }, { headers: { 'Cache-Control': 'no-store' } })
}

export const GET = withApiErrors('/api/practice', getHandler)
