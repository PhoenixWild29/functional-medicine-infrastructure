// ============================================================
// Cron authentication: the one check every cron route runs first
// ============================================================
//
// Vercel calls each cron with "Authorization: Bearer <CRON_SECRET>".
//
//   - CRON_SECRET unset or blank: 500, logged. The job does not run. A
//     comparison with `Bearer ${process.env.CRON_SECRET}` would accept
//     the literal "Bearer undefined" from anyone.
//   - a wrong or missing header: 401.
//   - the right header: null, and the route runs its job.
//
// Usage, first line of GET:
//   const denied = cronAuthFailure(request, 'retention')
//   if (denied) return denied

import { NextResponse } from 'next/server'

export function cronAuthFailure(
  request: { headers: { get(name: string): string | null } },
  cronName: string,
): NextResponse | null {
  const secret = process.env['CRON_SECRET']?.trim()
  if (!secret) {
    console.error(`[${cronName}] CRON_SECRET is not set: refusing to run`)
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}
