// ============================================================
// Clinic Settings — WO-30
// PATCH /api/clinic/settings
// ============================================================
//
// REQ-CAD-006: Clinic logo management (logo_url).
// REQ-CAD-007: Default markup percentage configuration.
//
// Request body (all fields optional, at least one required):
//   { default_markup_pct?: number, logo_url?: string | null }
//
// default_markup_pct: stored as NUMERIC(5,2) — e.g., 150.00 = 150%.
//   Must be a positive finite number if provided.
//   Used by the Margin Builder (REQ-DMB-003) as the default retail multiplier.
//
// logo_url: URL of the uploaded logo in Supabase Storage (or null to clear).
//   Upload is handled client-side; this endpoint only stores the URL.
//
// Auth: Requires active Clinic App session.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  // Auth gate
  const supabaseAuth = await createServerClient()
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const clinicId = typeof session.user.user_metadata['clinic_id'] === 'string'
    ? session.user.user_metadata['clinic_id'] as string
    : null

  if (!clinicId) {
    return NextResponse.json({ error: 'Session missing clinic_id' }, { status: 400 })
  }

  let body: {
    default_markup_pct?: number
    logo_url?: string | null
  }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const updates: Record<string, unknown> = {}

  // Validate and stage default_markup_pct
  if (body.default_markup_pct !== undefined) {
    const pct = body.default_markup_pct
    if (typeof pct !== 'number' || !isFinite(pct) || pct <= 0) {
      return NextResponse.json(
        { error: 'default_markup_pct must be a positive number' },
        { status: 400 }
      )
    }
    // BLK-02: cap at 999.99 — schema is NUMERIC(5,2) which stores up to 999.99
    if (pct > 999.99) {
      return NextResponse.json(
        { error: 'default_markup_pct must not exceed 999.99' },
        { status: 400 }
      )
    }
    updates['default_markup_pct'] = pct
  }

  // Validate and stage logo_url (null clears the logo)
  if ('logo_url' in body) {
    const url = body.logo_url
    if (url !== null) {
      if (typeof url !== 'string' || url.trim() === '') {
        return NextResponse.json({ error: 'logo_url must be a non-empty string or null' }, { status: 400 })
      }
      // Must be a valid https URL (Supabase Storage URLs are always https)
      try {
        const parsed = new URL(url)
        if (parsed.protocol !== 'https:') {
          return NextResponse.json({ error: 'logo_url must use https' }, { status: 400 })
        }
      } catch {
        return NextResponse.json({ error: 'logo_url must be a valid URL' }, { status: 400 })
      }
      updates['logo_url'] = url.trim()
    } else {
      updates['logo_url'] = null
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const supabase = createServiceClient()

  const { error: updateError } = await supabase
    .from('clinics')
    .update(updates)
    .eq('clinic_id', clinicId)
    .is('deleted_at', null)

  if (updateError) {
    console.error('[clinic/settings] update failed:', updateError.message)
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 })
  }

  console.info(`[clinic/settings] updated | clinic=${clinicId} | fields=${Object.keys(updates).join(',')}`)

  return NextResponse.json({ success: true })
}
