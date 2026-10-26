// ============================================================
// Ops inbound fax PDF: GET /api/ops/fax/[faxId]/pdf
// ============================================================
//
// Issue Log 72. Inbound faxes live only in Documo: the fax.received webhook
// stores the Documo fax id in inbound_fax_queue, never the file. This route
// fetches the PDF from Documo on demand by that id and streams it back, so
// ops can open a fax from the triage queue.
//
// ops_admin only (app_metadata via getUser), same-origin, 60 views per 10
// minutes per user. One phi_access_log row per view (who, which fax, its
// order when matched; nothing from the fax). Never cached. A missing or
// expired fax is a plain 404; Documo down is a plain 502.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient }  from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getUserRole }         from '@/lib/auth/claims'
import { downloadFaxPdf }      from '@/lib/documo/client'
import { logPhiAccess }        from '@/lib/audit/phi-access'
import { faxViewLimiter }      from '@/lib/fax/view-rate-limit'
import { refuseCrossSite } from '@/lib/security/same-origin'

const ROUTE = '/api/ops/fax/[faxId]/pdf'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NOT_AVAILABLE = 'This fax is no longer available.'
const FETCH_FAILED = 'The fax could not be fetched right now. Try again in a few minutes.'

function json(body: unknown, status: number, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } })
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ faxId: string }> },
): Promise<NextResponse> {
  const crossSite = refuseCrossSite(request, 'Forbidden', { 'Cache-Control': 'no-store' })
  if (crossSite) return crossSite

  const supabaseAuth = await createServerClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return json({ error: 'Unauthorized' }, 401)
  if (getUserRole(user) !== 'ops_admin') return json({ error: 'Forbidden' }, 403)

  const { faxId } = await params
  if (!UUID_RE.test(faxId)) return json({ error: 'Invalid fax id' }, 400)

  const limit = faxViewLimiter.check(user.id)
  if (!limit.allowed) {
    return json({ error: 'Too many faxes opened. Try again in a few minutes.' }, 429, { 'Retry-After': String(limit.retryAfterSeconds) })
  }

  const { data: fax, error } = await createServiceClient()
    .from('inbound_fax_queue')
    .select('fax_id, documo_fax_id, matched_order_id')
    .eq('fax_id', faxId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) {
    console.error(`[ops/fax/pdf] queue read failed | code=${(error as { code?: string }).code ?? 'unknown'}`)
    return json({ error: 'The fax queue could not be read right now. Try again in a few minutes.' }, 503)
  }
  if (!fax?.documo_fax_id) return json({ error: NOT_AVAILABLE }, 404)

  let result: Awaited<ReturnType<typeof downloadFaxPdf>>
  try {
    result = await downloadFaxPdf(fax.documo_fax_id)
  } catch (err) {
    console.error(`[ops/fax/pdf] Documo download threw | ${err instanceof Error ? err.name : 'error'}`)
    result = { ok: false, reason: 'failed' }
  }
  if (!result.ok) {
    return result.reason === 'not_found' ? json({ error: NOT_AVAILABLE }, 404) : json({ error: FETCH_FAILED }, 502)
  }

  await logPhiAccess({
    user, action: 'view', resource: 'inbound_fax', route: ROUTE,
    faxId: fax.fax_id, orderId: fax.matched_order_id ?? null, headers: request.headers,
  })

  return new NextResponse(result.bytes, {
    status: 200,
    headers: {
      'Content-Type':           'application/pdf',
      'Cache-Control':          'no-store',
      'Content-Disposition':    `inline; filename="fax-${faxId.slice(0, 8)}.pdf"`,
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
