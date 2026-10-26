// ============================================================
// POST /api/team/providers: add a provider (Settings > Team)
// ============================================================
//
// The clinic admin of an approved clinic adds a provider: name, email,
// NPI and one or more state licenses. The provider record is made the way
// the onboarding wizard makes it (lib/onboarding/provider-record: NPI
// unique, licenses, the NPPES registry check, which never blocks the
// save), then a provider invite (#215). The link comes back once, to copy;
// no email is sent. The provider's login is created when they accept.

import { NextResponse, type NextRequest } from 'next/server'
import { requireTeamAdmin } from '@/lib/team/access'
import { emailAlreadyOnTeam } from '@/lib/team/team'
import { cleanEmail, readJson } from '@/lib/onboarding/access'
import { createInvite } from '@/lib/onboarding/invite-actions'
import { DEA_RE, NAME_RE, addProviderRecord, licenseErrors, npiProblem, type LicenseInput } from '@/lib/onboarding/provider-record'

const MAX_LICENSES = 20

export async function POST(request: NextRequest): Promise<NextResponse> {
  const access = await requireTeamAdmin(request)
  if (!access.ok) return access.response
  const { user, clinicId, supabase } = access

  const body = await readJson(request)
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  const s = (k: string) => (typeof body[k] === 'string' ? (body[k] as string).trim() : '')
  const firstName = s('firstName')
  const lastName = s('lastName')
  const email = cleanEmail(body['email'])
  const npiNumber = s('npiNumber').replace(/\s/g, '')
  const deaRaw = s('deaNumber').toUpperCase()
  const rawLicenses = Array.isArray(body['licenses']) ? body['licenses'] : []
  const licenses: LicenseInput[] = rawLicenses.slice(0, MAX_LICENSES).map(l => {
    const o = (l && typeof l === 'object' ? l : {}) as Record<string, unknown>
    const str = (k: string) => (typeof o[k] === 'string' ? (o[k] as string).trim() : '')
    return { state: str('state').toUpperCase(), licenseNumber: str('licenseNumber'), expiresOn: str('expiresOn') }
  })

  const errors: Record<string, string> = {}
  if (!NAME_RE.test(firstName)) errors['firstName'] = 'Enter the first name.'
  if (!NAME_RE.test(lastName)) errors['lastName'] = 'Enter the last name.'
  if (!email) errors['email'] = 'Enter the provider’s email address.'
  const npiError = npiProblem(npiNumber)
  if (npiError) errors['npiNumber'] = npiError
  if (deaRaw && !DEA_RE.test(deaRaw)) errors['deaNumber'] = 'A DEA number is two letters and seven digits.'
  if (licenses.length === 0) errors['licenses'] = 'Add at least one state license.'
  if (rawLicenses.length > MAX_LICENSES) errors['licenses'] = `Add at most ${MAX_LICENSES} licenses here; add more on the provider afterwards.`
  const seen = new Set<string>()
  licenses.forEach((l, i) => {
    Object.assign(errors, licenseErrors(l, `licenses.${i}.`))
    if (seen.has(l.state) && !errors[`licenses.${i}.state`]) errors[`licenses.${i}.state`] = 'This state is listed twice.'
    seen.add(l.state)
  })
  if (Object.keys(errors).length > 0) return NextResponse.json({ error: 'Check the highlighted fields.', errors }, { status: 400 })

  const taken = await emailAlreadyOnTeam(supabase, clinicId, email!)
  if (taken === null) return NextResponse.json({ error: 'The team could not be checked. Try again.' }, { status: 503 })
  if (taken) {
    return NextResponse.json({ error: 'Someone on your team already has this email, or an invite is waiting for it.', errors: { email: 'Already on your team or invited.' } }, { status: 409 })
  }

  const added = await addProviderRecord(supabase, {
    clinicId, userId: null, firstName, lastName, npiNumber, licenses, deaNumber: deaRaw || null, actorId: user.id,
    // An approved clinic: the provider holds the NPI now (checked first).
    npiClaimed: true,
  })
  if (!added.ok) {
    return NextResponse.json({ error: added.error, ...(added.errors ? { errors: added.errors } : {}) }, { status: added.status })
  }
  const { provider, npiStatus } = added

  const invite = await createInvite(supabase, { kind: 'provider', clinicId, email: email!, providerId: provider.provider_id, createdBy: user.id, actorRole: 'clinic_admin' })
  if (!invite.ok) {
    return NextResponse.json({ providerId: provider.provider_id, npiStatus, error: 'The provider was added, but their invite could not be created. Resend it from Pending invites.' }, { status: 201 })
  }
  console.info(`[team] provider added | clinic=${clinicId} provider=${provider.provider_id} invite=${invite.inviteId}`)
  return NextResponse.json({ providerId: provider.provider_id, npiStatus, inviteId: invite.inviteId, link: invite.link, expiresAt: invite.expiresAt }, { status: 201 })
}
