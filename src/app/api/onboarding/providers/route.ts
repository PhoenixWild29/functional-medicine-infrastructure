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
import { NAME_RE, addProviderRecord, licenseErrors, npiProblem } from '@/lib/onboarding/provider-record'

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
  const license = { state: s('licenseState').toUpperCase(), licenseNumber: s('licenseNumber'), expiresOn: s('licenseExpiresOn') }

  const errors: Record<string, string> = {}
  if (!NAME_RE.test(firstName)) errors['firstName'] = 'Enter the first name.'
  if (!NAME_RE.test(lastName)) errors['lastName'] = 'Enter the last name.'
  if (!email) errors['email'] = 'Enter the provider’s email address.'
  const npiError = npiProblem(npiNumber)
  if (npiError) errors['npiNumber'] = npiError
  const licErrors = licenseErrors(license, '')
  if (licErrors['state']) errors['licenseState'] = licErrors['state']
  if (licErrors['licenseNumber']) errors['licenseNumber'] = licErrors['licenseNumber']
  if (licErrors['expiresOn']) errors['licenseExpiresOn'] = licErrors['expiresOn']
  if (Object.keys(errors).length > 0) return NextResponse.json({ error: 'Check the highlighted fields.', errors }, { status: 400 })

  // The provider, their license and the NPI check: the same path as a solo
  // provider's self sign-up (lib/onboarding/provider-record).
  const added = await addProviderRecord(supabase, {
    clinicId, userId: null, firstName, lastName, npiNumber, licenses: [license], actorId: user.id,
    // The wizard: the clinic is not approved yet, so it holds no NPI until
    // ops approves (security review M3).
    npiClaimed: false,
  })
  if (!added.ok) {
    return NextResponse.json({ error: added.error, ...(added.errors ? { errors: added.errors } : {}) }, { status: added.status })
  }
  const { provider, npiStatus } = added

  const invite = await createInvite(supabase, { kind: 'provider', clinicId, email: email!, providerId: provider.provider_id, createdBy: user.id, actorRole: 'clinic_admin' })
  await setStep(supabase, clinicId, 'providers', 'in_progress', user.id)
  if (!invite.ok) {
    return NextResponse.json({ providerId: provider.provider_id, npiStatus, error: 'The provider was added, but their invite could not be created. Resend it from the list.' }, { status: 201 })
  }
  return NextResponse.json({ providerId: provider.provider_id, npiStatus, link: invite.link, expiresAt: invite.expiresAt }, { status: 201 })
}
