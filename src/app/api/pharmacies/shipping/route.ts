// ============================================================
// WO-102: pharmacy shipping rates
// GET /api/pharmacies/shipping?ids=a,b,c
// ============================================================
//
// { rates: PharmacyShippingRates[], absorbShipping: boolean } for the
// Review page's shipping breakdown and multi-pharmacy notice. Rates live
// once on `pharmacies` (phase rule 4); absorbShipping is the caller's
// clinic setting (clinics.absorb_shipping).
//
// Auth: verified user via getUser(); clinic_id from that user.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { loadShippingRates } from '@/lib/orders/apply-bundle-shipping'

const MAX_IDS = 25

export async function GET(request: NextRequest): Promise<NextResponse> {
  const supabaseAuth = await createServerClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const clinicId = typeof user.user_metadata['clinic_id'] === 'string'
    ? user.user_metadata['clinic_id'] as string
    : null
  if (!clinicId) {
    return NextResponse.json({ error: 'Session missing clinic_id' }, { status: 400 })
  }

  const ids = (new URL(request.url).searchParams.get('ids') ?? '')
    .split(',').map(s => s.trim()).filter(Boolean)
  if (ids.length === 0 || ids.length > MAX_IDS) {
    return NextResponse.json({ error: `ids must list 1–${MAX_IDS} pharmacy ids` }, { status: 400 })
  }

  const supabase = createServiceClient()
  try {
    const [rates, clinic] = await Promise.all([
      loadShippingRates(supabase, ids),
      supabase.from('clinics').select('absorb_shipping').eq('clinic_id', clinicId).maybeSingle(),
    ])
    return NextResponse.json({
      rates:          [...rates.values()],
      absorbShipping: clinic.data?.absorb_shipping === true,
    }, { status: 200 })
  } catch (err) {
    console.error('[pharmacies/shipping]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Failed to load shipping rates' }, { status: 500 })
  }
}
