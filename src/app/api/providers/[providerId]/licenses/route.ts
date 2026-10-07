// ============================================================
// PUT /api/providers/[providerId]/licenses (Compliance C4)
// ============================================================
//
// The clinic admin adds or edits a provider's license in a state: one per
// provider per state, so a second PUT for the same state replaces it. The
// admin is recorded as who verified it, and when.

import { NextRequest, NextResponse } from 'next/server'
import { clinicAdminForProvider } from '@/lib/providers/team-access'
import { US_STATES } from '@/lib/providers/states'

const LICENSE_NUMBER_RE = /^[A-Za-z0-9][A-Za-z0-9 ./-]{0,39}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function validDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ providerId: string }> }): Promise<NextResponse> {
  const { providerId } = await params
  const access = await clinicAdminForProvider(providerId)
  if (!access.ok) return access.response

  let body: { state?: unknown; licenseNumber?: unknown; expiresOn?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const state = typeof body.state === 'string' ? body.state.trim().toUpperCase() : ''
  const licenseNumber = typeof body.licenseNumber === 'string' ? body.licenseNumber.trim() : ''
  const expiresOn = typeof body.expiresOn === 'string' ? body.expiresOn.trim() : ''
  const errors: string[] = []
  if (!US_STATES.has(state)) errors.push('Choose the state the license is issued in.')
  if (!LICENSE_NUMBER_RE.test(licenseNumber)) errors.push('Enter the license number (letters, digits, spaces, . / -, up to 40).')
  if (!validDate(expiresOn)) errors.push('Enter the expiry date as YYYY-MM-DD.')
  if (errors.length > 0) return NextResponse.json({ error: errors.join(' ') }, { status: 400 })

  const now = new Date().toISOString()
  const { error } = await access.supabase
    .from('provider_state_licenses')
    .upsert({
      provider_id:    access.provider.provider_id,
      state,
      license_number: licenseNumber,
      expires_on:     expiresOn,
      verified_at:    now,
      verified_by:    access.user.id,
      source:         'manual',
    }, { onConflict: 'provider_id,state' })
  if (error) {
    console.error(`[team] license save failed | provider=${access.provider.provider_id}: ${error.message}`)
    return NextResponse.json({ error: 'The license could not be saved. Try again.' }, { status: 500 })
  }
  console.info(`[team] license saved | provider=${access.provider.provider_id} state=${state}`)
  return NextResponse.json({ state, licenseNumber, expiresOn, verifiedAt: now })
}
