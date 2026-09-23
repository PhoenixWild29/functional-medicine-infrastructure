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

export async function GET(request: NextRequest): Promise<NextResponse> {
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

  return NextResponse.json({ period, numbers, attention }, { headers: { 'Cache-Control': 'no-store' } })
}
