// ============================================================
// POST /api/onboarding/providers — onboarding step 2 (clinic admin)
// ============================================================
//
// Adds a provider to the clinic with their first state license, runs the
// Compliance C4 NPI check (checksum here; the NPPES registry check is
// stored and never blocks the save), and invites the provider by email to
// create their account (provider role, app_metadata). More licenses are
// added with PUT /api/providers/[providerId]/licenses, which the clinic
// admin may use for their own clinic's providers.
//
// The provider row has no login until the provider accepts the invite.

import { NextRequest, NextResponse } from 'next/server'
import { requireOnboardingAdmin, readJson, cleanEmail, setStep } from '@/lib/onboarding/access'
import { createInvite } from '@/lib/onboarding/invite-actions'
import { npiChecksumValid } from '@/lib/providers/npi'
import { runNpiCheck } from '@/lib/providers/verify-npi'
import { US_STATES } from '@/lib/providers/states'

const NAME_RE = /^[\p{L}][\p{L} .'-]{0,99}$/u
const LICENSE_NUMBER_RE = /^[A-Za-z0-9][A-Za-z0-9 ./-]{0,39}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function validDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const access = await requireOnboardingAdmin({ editable: true })
  if (!access.ok) return access.response
  const { user, clinicId, supabase } = access

  const body = await readJson(request)
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  const s = (k: string) => (typeof body[k] === 'string' ? (body[k] as string).trim() : '')
  const firstName = s('firstName')
  const lastName = s('lastName')
  const email = cleanEmail(body['email'])
  const npiNumber = s('npiNumber').replace(/\s/g, '')
  const licenseState = s('licenseState').toUpperCase()
  const licenseNumber = s('licenseNumber')
  const licenseExpiresOn = s('licenseExpiresOn')

  const errors: Record<string, string> = {}
  if (!NAME_RE.test(firstName)) errors['firstName'] = 'Enter the first name.'
  if (!NAME_RE.test(lastName)) errors['lastName'] = 'Enter the last name.'
  if (!email) errors['email'] = 'Enter the provider’s email address.'
  if (!/^\d{10}$/.test(npiNumber)) errors['npiNumber'] = 'An NPI is 10 digits.'
  else if (!npiChecksumValid(npiNumber)) errors['npiNumber'] = 'That is not a valid NPI (the check digit does not match).'
  if (!US_STATES.has(licenseState)) errors['licenseState'] = 'Choose the state the license is issued in.'
  if (!LICENSE_NUMBER_RE.test(licenseNumber)) errors['licenseNumber'] = 'Enter the license number (letters, digits, spaces, . / -).'
  if (!validDate(licenseExpiresOn)) errors['licenseExpiresOn'] = 'Enter the expiry date.'
  else if (licenseExpiresOn < new Date().toISOString().slice(0, 10)) errors['licenseExpiresOn'] = 'This license has already expired.'
  if (Object.keys(errors).length > 0) return NextResponse.json({ error: 'Check the highlighted fields.', errors }, { status: 400 })

  // NPI is unique among live providers (partial unique index).
  const { data: existing, error: dupErr } = await supabase
    .from('providers')
    .select('provider_id')
    .eq('npi_number', npiNumber)
    .is('deleted_at', null)
    .maybeSingle()
  if (dupErr) {
    console.error(`[onboarding/providers] NPI pre-check failed | clinic=${clinicId}: ${dupErr.message}`)
    return NextResponse.json({ error: 'The NPI could not be checked. Try again.' }, { status: 503 })
  }
  if (existing) return NextResponse.json({ error: 'This NPI is already registered to a provider.', errors: { npiNumber: 'This NPI is already registered.' } }, { status: 409 })

  const { data: provider, error: insErr } = await supabase
    .from('providers')
    .insert({
      clinic_id:         clinicId,
      user_id:           null,
      first_name:        firstName,
      last_name:         lastName,
      npi_number:        npiNumber,
      license_state:     licenseState,
      license_number:    licenseNumber,
      signature_on_file: false,
      is_active:         true,
    })
    .select('provider_id, first_name, last_name, npi_number')
    .single()
  if (insErr || !provider) {
    console.error(`[onboarding/providers] provider insert failed | clinic=${clinicId}: ${insErr?.message}`)
    return NextResponse.json({ error: 'The provider could not be added. Try again.' }, { status: 500 })
  }

  const now = new Date().toISOString()
  const { error: licErr } = await supabase
    .from('provider_state_licenses')
    .upsert({
      provider_id:    provider.provider_id,
      state:          licenseState,
      license_number: licenseNumber,
      expires_on:     licenseExpiresOn,
      verified_at:    now,
      verified_by:    user.id,
      source:         'manual',
    }, { onConflict: 'provider_id,state' })
  if (licErr) {
    console.error(`[onboarding/providers] license save failed | provider=${provider.provider_id}: ${licErr.message}`)
    const { error: rbErr } = await supabase.from('providers').delete().eq('provider_id', provider.provider_id)
    if (rbErr) console.error(`[onboarding/providers] orphan provider left | provider=${provider.provider_id}: ${rbErr.message}`)
    return NextResponse.json({ error: 'The license could not be saved, so the provider was not added. Try again.' }, { status: 500 })
  }

  // Compliance C4: registry check; never blocks the save.
  const npi = await runNpiCheck(supabase, provider, user.id)

  const invite = await createInvite(supabase, { kind: 'provider', clinicId, email: email!, providerId: provider.provider_id, createdBy: user.id, actorRole: 'clinic_admin' })
  await setStep(supabase, clinicId, 'providers', 'in_progress', user.id)
  if (!invite.ok) {
    return NextResponse.json({ providerId: provider.provider_id, npiStatus: npi.lookup.status, error: 'The provider was added, but their invite could not be created. Resend it from the list.' }, { status: 201 })
  }
  return NextResponse.json({ providerId: provider.provider_id, npiStatus: npi.lookup.status, link: invite.link, expiresAt: invite.expiresAt }, { status: 201 })
}
