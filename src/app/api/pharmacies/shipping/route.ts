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
// Auth: verified user via getUser(); clinic staff only (provider, medical
// assistant, clinic admin); clinic_id from app_metadata. Every id is an id
// before the pharmacies are read (a bad id reaching Postgres was a 500).

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { loadShippingRates } from '@/lib/orders/apply-bundle-shipping'
import { getUserClinicId, getUserRole } from '@/lib/auth/claims'
import { parseInput, uuid } from '@/lib/api/input'
import { z } from 'zod'

const MAX_IDS = 25
const CLINIC_ROLES = new Set(['provider', 'medical_assistant', 'clinic_admin'])

export async function GET(request: NextRequest): Promise<NextResponse> {
  const supabaseAuth = await createServerClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const clinicId = getUserClinicId(user) ?? null
  if (!clinicId) {
    return NextResponse.json({ error: 'Session missing clinic_id' }, { status: 400 })
  }
  if (!CLINIC_ROLES.has(getUserRole(user) ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const ids = (new URL(request.url).searchParams.get('ids') ?? '')
    .split(',').map(s => s.trim()).filter(Boolean)
  if (ids.length === 0 || ids.length > MAX_IDS) {
    return NextResponse.json({ error: `ids must list 1–${MAX_IDS} pharmacy ids` }, { status: 400 })
  }
  const checked = parseInput(z.object({ ids: z.array(uuid()) }), { ids })
  if (!checked.ok) return checked.response

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
