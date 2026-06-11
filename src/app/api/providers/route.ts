// ============================================================
// Provider Admin Route — POST /api/providers
// ============================================================
//
// Creates a provider record AND links it to a Supabase Auth identity
// atomically. This is the production-grade replacement for the
// seed-script convention (linkProviderToAuthUser from scripts/seed-poc.ts)
// used during POC. Required for any real clinic onboarding because:
//
//   - Real providers cannot be added by re-running the seed script
//   - F-2 (sign-and-send signer enforcement) requires providers.user_id
//     to be set or the provider cannot sign prescriptions
//
// Auth model:
//   - clinic_admin: can create providers in THEIR OWN clinic only.
//     clinic_id comes from session metadata. Body.clinicId, if given,
//     must match — else 403.
//   - ops_admin: can create providers in ANY clinic. Body.clinicId is
//     required (no clinic_id claim on ops_admin sessions).
//   - All other roles (provider, medical_assistant): 403.
//
// Atomicity:
//   Two-step (auth.admin.createUser then providers.insert). If the
//   providers insert fails, the just-created auth user is rolled back
//   to avoid orphan auth identities. A rollback failure is logged as
//   CRITICAL — it's a rare double-fault that needs human cleanup, not
//   a request to retry.
//
// Out of scope (deliberate):
//   - TOTP enrollment (provider self-enrolls on first login)
//   - Invite-flow email delivery (POC: caller supplies initial password)
//   - signature_on_file (provider uploads on first EPCS sign)

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient }  from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

// ── Validation constants ────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const NPI_RE  = /^\d{10}$/
const MIN_PASSWORD_LENGTH = 12

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
  password:      string
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

export async function POST(request: NextRequest): Promise<NextResponse> {
  // 1. Auth gate
  const supabaseAuth = await createServerClient()
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const callerRole     = session.user.user_metadata['app_role']  as string | undefined
  const callerClinicId = typeof session.user.user_metadata['clinic_id'] === 'string'
    ? (session.user.user_metadata['clinic_id'] as string)
    : null

  if (callerRole !== 'clinic_admin' && callerRole !== 'ops_admin') {
    return NextResponse.json({ error: 'Forbidden — only clinic_admin or ops_admin can create providers' }, { status: 403 })
  }

  // 2. Body parse + validate
  let body: CreateProviderBody
  try {
    body = await request.json() as CreateProviderBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const errs: string[] = []

  if (!body.email || typeof body.email !== 'string' || !body.email.includes('@')) {
    errs.push('email must be a valid email address')
  }
  if (!body.password || typeof body.password !== 'string' || body.password.length < MIN_PASSWORD_LENGTH) {
    errs.push(`password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  }
  if (!body.firstName || typeof body.firstName !== 'string' || !body.firstName.trim()) {
    errs.push('firstName is required')
  }
  if (!body.lastName || typeof body.lastName !== 'string' || !body.lastName.trim()) {
    errs.push('lastName is required')
  }
  if (!body.npiNumber || !NPI_RE.test(body.npiNumber)) {
    errs.push('npiNumber must be exactly 10 digits')
  }
  if (!body.licenseState || !US_STATES.has(body.licenseState)) {
    errs.push('licenseState must be a valid 2-letter US state/territory code')
  }
  if (!body.licenseNumber || typeof body.licenseNumber !== 'string' || !body.licenseNumber.trim()) {
    errs.push('licenseNumber is required')
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
      console.warn(`[providers POST] cross-tenancy attempt | caller=${session.user.id} caller_clinic=${callerClinicId} target_clinic=${body.clinicId}`)
      return NextResponse.json({ error: 'clinic_admin can only create providers in their own clinic' }, { status: 403 })
    }
    targetClinicId = callerClinicId
  } else {
    // ops_admin path
    if (!body.clinicId || !UUID_RE.test(body.clinicId)) {
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

  // 4b. NPI is globally unique among non-deleted providers (partial unique index).
  const { data: existingNpi, error: npiCheckErr } = await supabase
    .from('providers')
    .select('provider_id')
    .eq('npi_number', body.npiNumber)
    .is('deleted_at', null)
    .maybeSingle()

  if (npiCheckErr) {
    console.error(`[providers POST] npi pre-check failed:`, npiCheckErr.message)
    return NextResponse.json({ error: 'Pre-check failed' }, { status: 500 })
  }
  if (existingNpi) {
    return NextResponse.json({ error: `NPI ${body.npiNumber} is already registered to another provider` }, { status: 409 })
  }

  // 5. Create auth user
  const normalizedEmail = body.email.trim().toLowerCase()
  const { data: createdUser, error: createUserErr } = await supabase.auth.admin.createUser({
    email:         normalizedEmail,
    password:      body.password,
    email_confirm: true,
    user_metadata: { app_role: 'provider', clinic_id: targetClinicId },
  })

  if (createUserErr || !createdUser?.user) {
    const msg = createUserErr?.message ?? 'unknown'
    // Supabase returns variants of "already" for email-already-exists.
    if (/already/i.test(msg)) {
      return NextResponse.json({ error: 'Email is already registered with another account' }, { status: 409 })
    }
    console.error(`[providers POST] auth.admin.createUser failed:`, msg)
    return NextResponse.json({ error: 'Failed to create auth user' }, { status: 500 })
  }

  const authUserId = createdUser.user.id

  // 6. Insert providers row (linked via user_id, set by F-1)
  const { data: provider, error: providerErr } = await supabase
    .from('providers')
    .insert({
      clinic_id:         targetClinicId,
      user_id:           authUserId,
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
    // Rollback the auth user so we don't leave an orphan identity.
    console.error(`[providers POST] providers.insert failed (rolling back auth user ${authUserId}):`, providerErr?.message)
    const { error: rollbackErr } = await supabase.auth.admin.deleteUser(authUserId)
    if (rollbackErr) {
      console.error(`[providers POST] CRITICAL: rollback of auth user ${authUserId} failed:`, rollbackErr.message,
        '— orphan auth identity left in the system, needs manual cleanup')
    }
    return NextResponse.json({ error: 'Failed to create provider record' }, { status: 500 })
  }

  console.info(`[providers POST] created provider=${provider.provider_id} user_id=${authUserId} clinic=${targetClinicId} caller=${session.user.id}`)

  return NextResponse.json({
    providerId:    provider.provider_id,
    userId:        provider.user_id,
    clinicId:      provider.clinic_id,
    firstName:     provider.first_name,
    lastName:      provider.last_name,
    npiNumber:     provider.npi_number,
    licenseState:  provider.license_state,
    licenseNumber: provider.license_number,
    deaNumber:     provider.dea_number,
  }, { status: 201 })
}

// Other HTTP methods explicitly unsupported
export function GET()    { return new NextResponse(null, { status: 405 }) }
export function PUT()    { return new NextResponse(null, { status: 405 }) }
export function PATCH()  { return new NextResponse(null, { status: 405 }) }
export function DELETE() { return new NextResponse(null, { status: 405 }) }
