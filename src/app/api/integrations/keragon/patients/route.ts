// POST /api/integrations/keragon/patients
// Inbound patients from a clinic's EHR, through Keragon. Server to server:
// no session; every request is authenticated by its HMAC signature with
// the clinic's shared secret (lib/integrations/keragon/webhook.ts,
// docs/integrations/keragon.md).
//   200 applied / skipped / flagged   401 bad, stale or unknown
//   409 replayed event id              422 invalid payload   503 retry
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { handleKeragonWebhook } from '@/lib/integrations/keragon/webhook'
import { withApiErrors } from '@/lib/api/with-api-errors'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function postHandler(request: NextRequest) {
  // The raw body, exactly as sent: the signature covers these bytes.
  const rawBody = await request.text()
  const result = await handleKeragonWebhook(createServiceClient(), { headers: request.headers, rawBody })
  return NextResponse.json(result.body, { status: result.status })
}

export const POST = withApiErrors('/api/integrations/keragon/patients', postHandler)
