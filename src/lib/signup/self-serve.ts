// ============================================================
// Self sign-up (/get-started): a solo provider, a clinic or a pharmacy
// ============================================================
//
// No invite. The visitor creates their own account and can look around at
// once; nothing can be ordered, signed or received until ops approves
// (lib/onboarding/approval-guard for clinics; an onboarding pharmacy is
// inactive, so it receives no orders and is not shown to prescribers).
//
//   solo_provider  a clinic (signup_kind solo_provider), a clinic_admin
//                  login that is also the clinic's provider
//                  (providers.user_id), their state licenses with expiry,
//                  DEA if they have one, and the NPPES check: the same
//                  provider path as the onboarding wizard
//                  (lib/onboarding/provider-record). The wizard's providers
//                  step is complete. Lands on /dashboard under the banner.
//   clinic         a clinic (signup_kind clinic) and its clinic_admin, then
//                  the existing clinic wizard (/onboarding).
//   pharmacy       an onboarding pharmacy, a pharmacy_admin and its
//                  application (signup_source self_serve), then the
//                  existing pharmacy wizard (/pharmacy/onboarding).
//
// Clinics start inactive and 'in_progress' with signup_source 'self_serve';
// the clinic or pharmacy event log gets 'self_signup'. Logins are made the
// same way as invited ones (lib/auth/create-login), email confirmed, so
// sign-in works at once. Ops confirms the email and phone with them before
// approving (the note beside Approve on the ops review pages).
//
// Abuse: the route rate limits per IP; a filled honeypot field is answered
// like a success and creates nothing; a duplicate email gets a neutral
// message. A failure part way removes what was made.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import type { NpiStatus } from '@/lib/providers/npi'
import { appMetadataFor } from '@/lib/auth/claims'
import { createLogin, removeLogin } from '@/lib/auth/create-login'
import { newPasswordProblem } from '@/lib/auth/password-policy'
import { cleanEmail, setStep } from '@/lib/onboarding/access'
import { recordOnboardingEvent } from '@/lib/onboarding/events'
import { DEA_RE, NAME_RE, addProviderRecord, licenseErrors, npiProblem, type LicenseInput } from '@/lib/onboarding/provider-record'
import { createApplication, createOnboardingPharmacy } from '@/lib/pharmacy-onboarding/invites'
import { recordOnboardingEvent as recordPharmacyEvent } from '@/lib/pharmacy-onboarding/events'

type Db = SupabaseClient<Database>

export const SIGNUP_KINDS = ['solo_provider', 'clinic', 'pharmacy'] as const
export type SignupKind = (typeof SIGNUP_KINDS)[number]

/** Says nothing about whether an account exists for the email. */
export const DUPLICATE_EMAIL_MESSAGE = 'We could not create an account with these details. If you already have an account, sign in instead.'
const FAILED = 'Your account could not be created. Nothing was saved. Try again.'
export const MAX_LICENSES = 10

export type SignupResult =
  | { ok: true; email: string; next: string; npiStatus?: NpiStatus; honeypot?: true }
  | { ok: false; status: number; error: string; errors?: Record<string, string>; code?: 'DUPLICATE_EMAIL' }

const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

function readLicenses(v: unknown): LicenseInput[] {
  if (!Array.isArray(v)) return []
  return v.slice(0, MAX_LICENSES + 1).map(l => {
    const r = (l && typeof l === 'object' ? l : {}) as Record<string, unknown>
    return { state: str(r['state'], 2).toUpperCase(), licenseNumber: str(r['licenseNumber'], 40), expiresOn: str(r['expiresOn'], 10) }
  })
}

export async function selfServeSignup(db: Db, body: Record<string, unknown>): Promise<SignupResult> {
  // Honeypot: a field people never see. Filled in, it is a bot: answered
  // like a success, nothing read or written.
  if (str(body['website'])) {
    console.warn('[signup] honeypot filled; nothing created')
    return { ok: true, honeypot: true, email: cleanEmail(body['email']) ?? '', next: '/login' }
  }

  const kind = body['kind']
  if (typeof kind !== 'string' || !(SIGNUP_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, status: 400, error: 'Choose what you are signing up as.' }
  }

  const firstName = str(body['firstName'], 100)
  const lastName = str(body['lastName'], 100)
  const email = cleanEmail(body['email'])
  const password = typeof body['password'] === 'string' ? body['password'] : ''
  const organizationName = str(body['organizationName'])

  const errors: Record<string, string> = {}
  if (!NAME_RE.test(firstName)) errors['firstName'] = 'Enter your first name.'
  if (!NAME_RE.test(lastName)) errors['lastName'] = 'Enter your last name.'
  if (!email) errors['email'] = 'Enter your email address.'
  // The shared policy (lib/auth/password-policy, review P4).
  const weak = newPasswordProblem(password, email)
  if (weak) errors['password'] = weak
  if (!organizationName) {
    errors['organizationName'] = kind === 'pharmacy' ? 'Enter the pharmacy name.' : 'Enter the name of your practice.'
  }

  // Solo provider: NPI, state licenses with expiry, DEA if they have one.
  const npiNumber = str(body['npiNumber'], 20).replace(/\s/g, '')
  const licenses = readLicenses(body['licenses'])
  const deaNumber = str(body['deaNumber'], 20).toUpperCase()
  if (kind === 'solo_provider') {
    const npiError = npiProblem(npiNumber)
    if (npiError) errors['npiNumber'] = npiError
    if (licenses.length === 0) errors['licenses'] = 'Add at least one state license.'
    else if (licenses.length > MAX_LICENSES) errors['licenses'] = `Add at most ${MAX_LICENSES} licenses here; add more later in Settings.`
    const seen = new Set<string>()
    licenses.slice(0, MAX_LICENSES).forEach((l, i) => {
      Object.assign(errors, licenseErrors(l, `licenses.${i}.`))
      if (l.state && seen.has(l.state) && !errors[`licenses.${i}.state`]) errors[`licenses.${i}.state`] = 'You already added this state.'
      seen.add(l.state)
    })
    if (deaNumber && !DEA_RE.test(deaNumber)) errors['deaNumber'] = 'A DEA number is 2 letters and 7 digits. Leave it empty if you do not have one.'
  }
  if (Object.keys(errors).length > 0) return { ok: false, status: 400, error: 'Check the highlighted fields.', errors }

  const fullName = `${firstName} ${lastName}`
  if (kind === 'pharmacy') return pharmacySignup(db, { email: email!, password, fullName, pharmacyName: organizationName })

  // Security review M3: no NPI check here. A pending sign-up holds no NPI
  // (its provider row is unclaimed), so it never blocks another, and an NPI
  // an approved clinic holds gets exactly the answer any NPI gets: nobody
  // can probe which NPIs are customers. Ops approval settles it
  // (lib/onboarding/npi-claims).
  return clinicSignup(db, {
    kind: kind as 'clinic' | 'solo_provider', email: email!, password, fullName, firstName, lastName, clinicName: organizationName,
    npiNumber, licenses, deaNumber: deaNumber || null,
  })
}

async function clinicSignup(db: Db, input: {
  kind: 'clinic' | 'solo_provider'; email: string; password: string; fullName: string; firstName: string; lastName: string
  clinicName: string; npiNumber: string; licenses: LicenseInput[]; deaNumber: string | null
}): Promise<SignupResult> {
  const { data: clinic, error: clinicErr } = await db
    .from('clinics')
    .insert({ name: input.clinicName, is_active: false, onboarding_status: 'in_progress', signup_source: 'self_serve', signup_kind: input.kind })
    .select('clinic_id')
    .single()
  if (clinicErr || !clinic) {
    console.error('[signup] clinic insert failed:', clinicErr?.message ?? 'no row')
    return { ok: false, status: 503, error: FAILED }
  }
  const clinicId = clinic.clinic_id
  const dropClinic = async () => {
    const { error } = await db.from('clinics').delete().eq('clinic_id', clinicId)
    if (error) console.error(`[signup] CRITICAL: clinic not removed after a failed sign-up | clinic=${clinicId}: ${error.message}`)
  }

  const login = await createLogin(db, {
    email: input.email, password: input.password, fullName: input.fullName,
    appMetadata: appMetadataFor({ role: 'clinic_admin', clinicId }),
  })
  if (!login.ok) {
    await dropClinic()
    if (login.reason === 'exists') return { ok: false, status: 409, code: 'DUPLICATE_EMAIL', error: DUPLICATE_EMAIL_MESSAGE }
    if (login.reason === 'weak_password') return { ok: false, status: 400, error: 'Check the highlighted fields.', errors: { password: 'That password is not strong enough. Try a longer one.' } }
    console.error(`[signup] login could not be created | clinic=${clinicId}: ${login.message}`)
    return { ok: false, status: 503, error: FAILED }
  }
  const userId = login.userId

  let npiStatus: NpiStatus | undefined
  if (input.kind === 'solo_provider') {
    const added = await addProviderRecord(db, {
      clinicId, userId, firstName: input.firstName, lastName: input.lastName, npiNumber: input.npiNumber,
      licenses: input.licenses, deaNumber: input.deaNumber, actorId: userId,
      // Not approved yet: the NPI is claimed at ops approval.
      npiClaimed: false,
    })
    if (!added.ok) {
      await removeLogin(db, userId, 'signup')
      await dropClinic()
      if (added.status === 409) return { ok: false, status: 409, error: added.error, ...(added.errors ? { errors: added.errors } : {}) }
      return { ok: false, status: 503, error: FAILED }
    }
    npiStatus = added.npiStatus
    // They are the clinic's provider: the wizard's providers step is done.
    await setStep(db, clinicId, 'providers', 'complete', userId)
  }

  await recordOnboardingEvent(db, { clinicId, event: 'self_signup', actorUserId: userId, actorRole: 'clinic_admin', note: input.kind })
  console.info(`[signup] self sign-up | kind=${input.kind} clinic=${clinicId}`)
  return input.kind === 'solo_provider'
    ? { ok: true, email: input.email, next: '/dashboard', npiStatus: npiStatus! }
    : { ok: true, email: input.email, next: '/onboarding' }
}

async function pharmacySignup(db: Db, input: { email: string; password: string; fullName: string; pharmacyName: string }): Promise<SignupResult> {
  // The pharmacy-onboarding library is typed loosely (it predates the types).
  const loose = db as unknown as SupabaseClient
  const pharmacy = await createOnboardingPharmacy(loose, { name: input.pharmacyName, email: input.email })
  if (!pharmacy.ok) return { ok: false, status: 503, error: FAILED }

  const login = await createLogin(db, {
    email: input.email, password: input.password, fullName: input.fullName,
    appMetadata: appMetadataFor({ role: 'pharmacy_admin', clinicId: null, pharmacyId: pharmacy.pharmacyId }),
  })
  if (!login.ok) {
    await pharmacy.drop()
    if (login.reason === 'exists') return { ok: false, status: 409, code: 'DUPLICATE_EMAIL', error: DUPLICATE_EMAIL_MESSAGE }
    if (login.reason === 'weak_password') return { ok: false, status: 400, error: 'Check the highlighted fields.', errors: { password: 'That password is not strong enough. Try a longer one.' } }
    console.error(`[signup] login could not be created | pharmacy=${pharmacy.pharmacyId}: ${login.message}`)
    return { ok: false, status: 503, error: FAILED }
  }

  const application = await createApplication(loose, { pharmacyId: pharmacy.pharmacyId, adminUserId: login.userId, inviteId: null, signupSource: 'self_serve' })
  if (!application.ok) {
    await removeLogin(db, login.userId, 'signup')
    await pharmacy.drop()
    return { ok: false, status: 503, error: FAILED }
  }

  await recordPharmacyEvent(loose, {
    actor: { userId: login.userId, role: 'pharmacy_admin' }, action: 'self_signup',
    pharmacyId: pharmacy.pharmacyId, applicationId: application.applicationId,
  })
  console.info(`[signup] self sign-up | kind=pharmacy pharmacy=${pharmacy.pharmacyId}`)
  return { ok: true, email: input.email, next: '/pharmacy/onboarding' }
}
