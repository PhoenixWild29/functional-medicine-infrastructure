// ============================================================
// GET /api/prescriber-check?states=TX,CA (Compliance C4)
// ============================================================
//
// For the Review page: may the signed-in provider sign for these shipping
// states? The same rule batch-sign enforces (a verified NPI, an unexpired
// license in each state), so Review can say why before the signature.
// A user who is not a provider signs nothing here: no problems apply.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { prescriberProblems, todayUtc } from '@/lib/providers/credentials'
import type { NpiStatus } from '@/lib/providers/npi'
import { getUserClinicId, getUserRole } from '@/lib/auth/claims'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function GET(request: NextRequest): Promise<NextResponse> {
  const supabaseAuth = await createServerClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const clinicId = getUserClinicId(user) ?? null
  if (getUserRole(user) !== 'provider' || !clinicId) {
    return NextResponse.json({ applies: false, problems: [] }, { headers: NO_STORE })
  }
  const states = (request.nextUrl.searchParams.get('states') ?? '')
    .split(',').map(s => s.trim().toUpperCase()).filter(s => /^[A-Z]{2}$/.test(s))

  const supabase = createServiceClient()
  const { data: provider, error: providerError } = await supabase
    .from('providers')
    .select('provider_id, first_name, last_name, npi_number')
    .eq('user_id', user.id)
    .eq('clinic_id', clinicId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .maybeSingle()
  if (providerError) {
    console.error('[prescriber-check] provider read failed:', providerError.message)
    return NextResponse.json({ error: 'Your provider record could not be read.' }, { status: 503, headers: NO_STORE })
  }
  if (!provider) {
    return NextResponse.json({
      applies: true,
      problems: [{ code: 'provider_unlinked', state: null, message: 'Your login is not linked to a provider in this clinic.' }],
    }, { headers: NO_STORE })
  }

  const [verificationRes, licensesRes] = await Promise.all([
    supabase.from('provider_npi_verifications').select('npi, status').eq('provider_id', provider.provider_id).maybeSingle(),
    supabase.from('provider_state_licenses').select('state, license_number, expires_on').eq('provider_id', provider.provider_id),
  ])
  if (verificationRes.error || licensesRes.error) {
    console.error('[prescriber-check] credentials read failed:', (verificationRes.error ?? licensesRes.error)?.message)
    return NextResponse.json({ error: 'Your license and NPI records could not be read.' }, { status: 503, headers: NO_STORE })
  }

  const problems = prescriberProblems({
    providerId:   provider.provider_id,
    firstName:    provider.first_name,
    lastName:     provider.last_name,
    npi:          provider.npi_number ?? '',
    verification: (verificationRes.data as { npi: string; status: NpiStatus } | null) ?? null,
    licenses:     ((licensesRes.data ?? []) as Array<{ state: string; license_number: string; expires_on: string }>)
      .map(l => ({ state: l.state, licenseNumber: l.license_number, expiresOn: l.expires_on })),
  }, states, todayUtc())
  return NextResponse.json({ applies: true, problems }, { headers: NO_STORE })
}
