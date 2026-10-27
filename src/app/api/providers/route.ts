// ============================================================
// Provider Admin Route — POST /api/providers
// ============================================================
//
// Creates a provider record and a one-time provider invite (the Team
// invite flow, lib/onboarding/invite-actions). The provider opens the
// invite link, sets their own password, and the login is created and
// linked to this record then (providers.user_id, needed to sign: F-2).
//
// B10 (technical-safeguards-evidence-2026-10-25.md): this route used to
// create the login with a password the admin chose, and nothing forced a
// change. Now no login is created here and a password in the body is
// refused: nobody but the provider ever knows their password. The link is
// returned once, for the admin to copy; no email is sent.
//
// Auth model:
//   - clinic_admin: can create providers in THEIR OWN clinic only.
//     clinic_id comes from session metadata. Body.clinicId, if given,
//     must match — else 403.
//   - ops_admin: can create providers in ANY clinic. Body.clinicId is
//     required (no clinic_id claim on ops_admin sessions).
//   - All other roles (provider, medical_assistant): 403.
//
// Order: providers.insert, then the invite. If the invite cannot be made,
// the provider is still saved (201) and the admin resends the invite from
// Settings > Team > Pending invites, as the Team route does.
//
// Out of scope (deliberate):
//   - TOTP enrollment (provider self-enrolls on first login)
//   - Email delivery of the invite (the admin copies the link)
//   - signature_on_file (provider uploads on first EPCS sign)

import { NextRequest, NextResponse } from 'next/server'
import { refuseCrossSite } from '@/lib/security/same-origin'
import { createServerClient }  from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { npiChecksumValid } from '@/lib/providers/npi'
import { runNpiCheck } from '@/lib/providers/verify-npi'
import { getUserClinicId, getUserRole } from '@/lib/auth/claims'
import { createInvite } from '@/lib/onboarding/invite-actions'
import { withApiErrors } from '@/lib/api/with-api-errors'
import { MAX_NAME, UUID_RE } from '@/lib/api/input'

// ── Validation constants ────────────────────────────────────────────

// Any 8-4-4-4-12 hex id (lib/api/input): the seeded demo clinic ids are
// not RFC v4, so the v4-only pattern used before refused them.
const NPI_RE  = /^\d{10}$/
// B10: the provider sets their own password from the invite link.
const PASSWORD_REFUSED = 'password is not accepted: the provider sets their own password from the invite link'
// RFC 5321: an address is at most 254 characters.
const MAX_EMAIL_LENGTH = 254

// Mirrors the CHECK constraint in supabase/migrations/20260317000002_create_v1_tables.sql:31
const US_STATES = new Set<string>([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
  'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
  'DC','AS','GU','MP','PR','VI',
])

// ── Body shape ──────────────────────────────────────────────────────

interface CreateProviderBody {
  email:         string
  firstName:     string
  lastName:      string
  npiNumber:     string
  licenseState:  string
  licenseNumber: string
  deaNumber?:    string | null
  /** Required if caller is ops_admin; must equal session.clinic_id if caller is clinic_admin. */
  clinicId?:     string
}

// ── Route ───────────────────────────────────────────────────────────

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const crossSite = refuseCrossSite(request)
  if (crossSite) return crossSite
  // 1. Auth gate
  const supabaseAuth = await createServerClient()
  // getUser() verifies the token with Supabase; a cookie session alone is not trusted.
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const callerRole     = getUserRole(user)
  const callerClinicId = getUserClinicId(user) ?? null

  if (callerRole !== 'clinic_admin' && callerRole !== 'ops_admin') {
    return NextResponse.json({ error: 'Forbidden: only clinic_admin or ops_admin can create providers' }, { status: 403 })
  }

  // 2. Body parse + validate
  let body: CreateProviderBody
  try {
    body = await request.json() as CreateProviderBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  // JSON null, an array or a scalar is not a body (null was a thrown 500).
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const errs: string[] = []

  if (!body.email || typeof body.email !== 'string' || !body.email.includes('@')) {
    errs.push('email must be a valid email address')
  } else if (body.email.trim().length > MAX_EMAIL_LENGTH) {
    errs.push(`email must be at most ${MAX_EMAIL_LENGTH} characters`)
  }
  if ('password' in body) errs.push(PASSWORD_REFUSED)
  if (!body.firstName || typeof body.firstName !== 'string' || !body.firstName.trim()) {
    errs.push('firstName is required')
  } else if (body.firstName.trim().length > MAX_NAME) {
    errs.push(`firstName must be at most ${MAX_NAME} characters`)
  }
  if (!body.lastName || typeof body.lastName !== 'string' || !body.lastName.trim()) {
    errs.push('lastName is required')
  } else if (body.lastName.trim().length > MAX_NAME) {
    errs.push(`lastName must be at most ${MAX_NAME} characters`)
  }
  if (!body.npiNumber || typeof body.npiNumber !== 'string' || !NPI_RE.test(body.npiNumber)) {
    errs.push('npiNumber must be exactly 10 digits')
  } else if (!npiChecksumValid(body.npiNumber)) {
    // Compliance C4: the NPI check digit (Luhn with the 80840 prefix).
    errs.push('npiNumber is not a valid NPI (the check digit does not match)')
  }
  if (!body.licenseState || typeof body.licenseState !== 'string' || !US_STATES.has(body.licenseState)) {
    errs.push('licenseState must be a valid 2-letter US state/territory code')
  }
  if (!body.licenseNumber || typeof body.licenseNumber !== 'string' || !body.licenseNumber.trim()) {
    errs.push('licenseNumber is required')
  } else if (body.licenseNumber.trim().length > MAX_NAME) {
    errs.push(`licenseNumber must be at most ${MAX_NAME} characters`)
  }
  // Optional; a non-string was a thrown 500 at .trim().
  if (body.deaNumber != null && typeof body.deaNumber !== 'string') {
    errs.push('deaNumber must be text')
  } else if (typeof body.deaNumber === 'string' && body.deaNumber.trim().length > MAX_NAME) {
    errs.push(`deaNumber must be at most ${MAX_NAME} characters`)
  }

  if (errs.length > 0) {
    return NextResponse.json({ error: 'Validation failed', details: errs }, { status: 400 })
  }

  // 3. Resolve target clinic_id with cross-tenancy enforcement
  let targetClinicId: string
  if (callerRole === 'clinic_admin') {
    if (!callerClinicId) {
      return NextResponse.json({ error: 'Session missing clinic_id' }, { status: 400 })
    }
    if (body.clinicId && body.clinicId !== callerClinicId) {
      // Caller is clinic_admin trying to plant a provider in a different clinic.
      // Reject loudly — this is a tenancy-violation attempt.
      console.warn(`[providers POST] cross-tenancy attempt | caller=${user.id} caller_clinic=${callerClinicId} target_clinic=${body.clinicId}`)
      return NextResponse.json({ error: 'clinic_admin can only create providers in their own clinic' }, { status: 403 })
    }
    targetClinicId = callerClinicId
  } else {
    // ops_admin path
    if (!body.clinicId || typeof body.clinicId !== 'string' || !UUID_RE.test(body.clinicId)) {
      return NextResponse.json({ error: 'ops_admin must specify a valid clinicId in the request body' }, { status: 400 })
    }
    targetClinicId = body.clinicId
  }

  const supabase = createServiceClient()

  // 4a. Codex post-review sweep follow-up: verify target clinic exists BEFORE
  //     creating an auth user. Without this, an ops_admin passing a malformed
  //     or stale clinicId would (a) succeed at auth.admin.createUser, then
  //     (b) fail at providers.insert via FK violation, surfacing as a generic
  //     500 with an orphan auth user requiring rollback. Failing fast here
  //     means no auth user is created in the first place.
  const { data: targetClinic, error: clinicCheckErr } = await supabase
    .from('clinics')
    .select('clinic_id, is_active')
    .eq('clinic_id', targetClinicId)
    .is('deleted_at', null)
    .maybeSingle()

  if (clinicCheckErr) {
    console.error(`[providers POST] clinic pre-check failed:`, clinicCheckErr.message)
    return NextResponse.json({ error: 'Pre-check failed' }, { status: 500 })
  }
  if (!targetClinic) {
    return NextResponse.json({ error: `Clinic ${targetClinicId} not found or inactive` }, { status: 404 })
  }
  if (!targetClinic.is_active) {
    return NextResponse.json({ error: `Clinic ${targetClinicId} is not active; cannot create providers` }, { status: 409 })
  }

  // 4b. NPI is unique among live providers of approved clinics (claimed
  //     rows, partial unique index providers_npi_number_unique). Pending
  //     sign-ups may share an NPI unclaimed, so this is a list, not one row.
  const { data: existingNpiRows, error: npiCheckErr } = await supabase
    .from('providers')
    .select('provider_id')
    .eq('npi_number', body.npiNumber)
    .is('deleted_at', null)
    .neq('npi_claimed', false)
    .limit(1)
  const existingNpi = (existingNpiRows ?? [])[0] ?? null

  if (npiCheckErr) {
    console.error(`[providers POST] npi pre-check failed:`, npiCheckErr.message)
    return NextResponse.json({ error: 'Pre-check failed' }, { status: 500 })
  }
  if (existingNpi) {
    return NextResponse.json({ error: `NPI ${body.npiNumber} is already registered to another provider` }, { status: 409 })
  }

  const normalizedEmail = body.email.trim().toLowerCase()

  // 5. Insert the providers row. No login yet: user_id is set when the
  //    provider accepts the invite and sets their own password.
  const { data: provider, error: providerErr } = await supabase
    .from('providers')
    .insert({
      clinic_id:         targetClinicId,
      user_id:           null,
      first_name:        body.firstName.trim(),
      last_name:         body.lastName.trim(),
      npi_number:        body.npiNumber,
      license_state:     body.licenseState,
      license_number:    body.licenseNumber.trim(),
      dea_number:        body.deaNumber?.trim() || null,
      signature_on_file: false,
      is_active:         true,
    })
    .select('provider_id, clinic_id, user_id, first_name, last_name, npi_number, license_state, license_number, dea_number')
    .single()

  if (providerErr || !provider) {
    console.error(`[providers POST] providers.insert failed:`, providerErr?.message)
    return NextResponse.json({ error: 'Failed to create provider record' }, { status: 500 })
  }

  // 6. The provider invite: the one-time link the admin copies.
  const invite = await createInvite(supabase, {
    kind:       'provider',
    clinicId:   targetClinicId,
    email:      normalizedEmail,
    providerId: provider.provider_id,
    createdBy:  user.id,
    actorRole:  callerRole,
  })

  console.info(`[providers POST] created provider=${provider.provider_id} clinic=${targetClinicId} caller=${user.id} invite=${invite.ok ? invite.inviteId : 'failed'}`)

  // Compliance C4: check the NPI against the NPPES registry and store the
  // result. Never blocks the save: an unreachable registry is 'unverified'
  // and the provider cannot sign until a later check verifies it.
  const npiCheck = await runNpiCheck(supabase, provider, user.id)

  return NextResponse.json({
    npiStatus:     npiCheck.lookup.status,
    providerId:    provider.provider_id,
    userId:        provider.user_id,
    clinicId:      provider.clinic_id,
    firstName:     provider.first_name,
    lastName:      provider.last_name,
    npiNumber:     provider.npi_number,
    licenseState:  provider.license_state,
    licenseNumber: provider.license_number,
    deaNumber:     provider.dea_number,
    inviteLink:      invite.ok ? invite.link : null,
    inviteExpiresAt: invite.ok ? invite.expiresAt : null,
    ...(invite.ok ? {} : { error: 'The provider was added, but their invite could not be created. Resend it from Settings, Team, Pending invites.' }),
  }, { status: 201 })
}

// Other HTTP methods explicitly unsupported
export function GET()    { return new NextResponse(null, { status: 405 }) }
export function PUT()    { return new NextResponse(null, { status: 405 }) }
export function PATCH()  { return new NextResponse(null, { status: 405 }) }
export function DELETE() { return new NextResponse(null, { status: 405 }) }

export const POST = withApiErrors('/api/providers', postHandler)
