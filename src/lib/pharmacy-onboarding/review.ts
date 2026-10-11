// ============================================================
// Ops review of pharmacy onboarding applications
// ============================================================
//
// Service-role reads and writes; the routes check ops_admin first. Every
// ops action is audit-logged before it happens (no audit row, no action).
//
// A pharmacy reaches prescribers only through approveApplication, and only
// when every one of its licenses is verified under the C5 rules (document,
// unexpired, sterile scope recorded) and the current BAA is accepted. Until
// then it is inactive (and the database CHECK keeps an onboarding pharmacy
// inactive), so the builder and routing, which require is_active, never
// see it.

import type { SupabaseClient } from '@supabase/supabase-js'
import { AGREEMENT } from './agreement'
import { LICENSE_DOCUMENT_BUCKET, orderingView } from './application'
import { AUDIT_UNAVAILABLE, recordOnboardingEvent, type OnboardingActor } from './events'
import type { Fail } from './invites'

const SIGNED_URL_SECONDS = 15 * 60
const UNAVAILABLE = (what: string): Fail => ({ ok: false, status: 503, error: `${what} Nothing was changed. Try again.` })

interface AppRow {
  application_id:    string
  pharmacy_id:       string
  status:            string
  steps_completed:   string[] | null
  ordering_method:   string | null
  ordering_details:  Record<string, unknown> | null
  catalog_choice:    string | null
  catalog_rows:      unknown
  catalog_row_count: number | null
  catalog_warnings:  unknown
  review_note:       string | null
  submitted_at:      string | null
  reviewed_at:       string | null
  approved_at:       string | null
  updated_at:        string | null
  adapter_configured_at: string | null
}

interface LicenseRow {
  state_code:          string
  license_number:      string
  expiration_date:     string
  sterile_compounding: boolean | null
  verification_status: string
  verification_note:   string | null
  document_path:       string | null
  verified_at:         string | null
}

const APP_COLUMNS = 'application_id, pharmacy_id, status, steps_completed, ordering_method, ordering_details, catalog_choice, catalog_rows, catalog_row_count, catalog_warnings, review_note, submitted_at, reviewed_at, approved_at, updated_at, adapter_configured_at'

/** API and portal pharmacies need an adapter set up by ops (endpoints, selectors); fax does not. */
const needsAdapter = (method: string | null) => method === 'api' || method === 'portal'
const LICENSE_COLUMNS = 'state_code, license_number, expiration_date, sterile_compounding, verification_status, verification_note, document_path, verified_at'

const today = (now: Date) => now.toISOString().slice(0, 10)

async function readApplication(db: SupabaseClient, applicationId: string): Promise<{ ok: true; app: AppRow } | Fail> {
  const { data, error } = await db.from('pharmacy_onboarding_applications').select(APP_COLUMNS).eq('application_id', applicationId).maybeSingle()
  if (error) return UNAVAILABLE('The application could not be read.')
  if (!data) return { ok: false, status: 404, error: 'Application not found.' }
  return { ok: true, app: data as AppRow }
}

async function readLicenses(db: SupabaseClient, pharmacyId: string): Promise<LicenseRow[] | null> {
  const { data, error } = await db.from('pharmacy_state_licenses').select(LICENSE_COLUMNS).eq('pharmacy_id', pharmacyId).is('deleted_at', null).order('state_code', { ascending: true })
  return error ? null : (data ?? []) as LicenseRow[]
}

// ── Reading ──────────────────────────────────────────────────

export interface ApplicationListItem {
  applicationId: string
  pharmacyId:    string
  pharmacyName:  string
  status:        string
  submittedAt:   string | null
  updatedAt:     string | null
  licenses:      { total: number; verified: number; pending: number; rejected: number }
}

export async function listApplications(db: SupabaseClient): Promise<{ ok: true; applications: ApplicationListItem[] } | Fail> {
  const { data, error } = await db.from('pharmacy_onboarding_applications').select(APP_COLUMNS).order('updated_at', { ascending: false }).limit(200)
  if (error) return UNAVAILABLE('Applications could not be read.')
  const apps = (data ?? []) as AppRow[]
  const ids = apps.map(a => a.pharmacy_id)
  if (ids.length === 0) return { ok: true, applications: [] }
  const [pharmacies, licenses] = await Promise.all([
    db.from('pharmacies').select('pharmacy_id, name').in('pharmacy_id', ids),
    db.from('pharmacy_state_licenses').select('pharmacy_id, verification_status').in('pharmacy_id', ids).is('deleted_at', null),
  ])
  if (pharmacies.error || licenses.error) return UNAVAILABLE('Applications could not be read.')
  const names = new Map(((pharmacies.data ?? []) as Array<{ pharmacy_id: string; name: string }>).map(p => [p.pharmacy_id, p.name]))
  const lic = (licenses.data ?? []) as Array<{ pharmacy_id: string; verification_status: string }>
  return {
    ok: true,
    applications: apps.map(a => {
      const mine = lic.filter(l => l.pharmacy_id === a.pharmacy_id)
      const count = (s: string) => mine.filter(l => l.verification_status === s).length
      return {
        applicationId: a.application_id, pharmacyId: a.pharmacy_id, pharmacyName: names.get(a.pharmacy_id) ?? '',
        status: a.status, submittedAt: a.submitted_at, updatedAt: a.updated_at,
        licenses: { total: mine.length, verified: count('verified'), pending: count('pending'), rejected: count('rejected') },
      }
    }),
  }
}

export interface ApplicationReview {
  applicationId:  string
  pharmacyId:     string
  status:         string
  stepsCompleted: string[]
  submittedAt:    string | null
  reviewNote:     string | null
  pharmacy:       Record<string, unknown>
  licenses:       Array<{ state: string; licenseNumber: string; expiresOn: string; sterileCompounding: boolean | null; verificationStatus: string; verificationNote: string | null; verifiedAt: string | null; documentUrl: string | null }>
  ordering:       Record<string, unknown> | null
  adapter:        { required: boolean; configuredAt: string | null }
  acceptance:     { signerName: string; signerTitle: string; acceptedAt: string; templateVersion: string; textSha256: string; current: boolean } | null
  catalog:        { choice: string | null; rowCount: number | null; warnings: string[]; rows: unknown[] }
  events:         Array<{ action: string; actorRole: string; occurredAt: string; stateCode: string | null }>
}

const PHARMACY_COLUMNS = 'pharmacy_id, name, legal_name, dba_name, address_line1, address_line2, city, state, zip, phone, email, ncpdp_id, npi, dea_number, facility_type, integration_tier, fax_number, ship_carriers, ships_cold_chain, ship_to_states, order_cutoff_local, onboarding_status, is_active'

export async function getApplicationReview(db: SupabaseClient, applicationId: string): Promise<{ ok: true; review: ApplicationReview } | Fail> {
  const r = await readApplication(db, applicationId)
  if (!r.ok) return r
  const pharmacyId = r.app.pharmacy_id
  const [pharmacy, licenses, acceptance, events] = await Promise.all([
    db.from('pharmacies').select(PHARMACY_COLUMNS).eq('pharmacy_id', pharmacyId).maybeSingle(),
    readLicenses(db, pharmacyId),
    db.from('pharmacy_agreement_acceptances').select('signer_name, signer_title, accepted_at, template_version, text_sha256').eq('pharmacy_id', pharmacyId).order('accepted_at', { ascending: false }).limit(1),
    db.from('pharmacy_onboarding_events').select('action, actor_role, occurred_at, state_code').eq('pharmacy_id', pharmacyId).order('occurred_at', { ascending: false }).limit(50),
  ])
  if (pharmacy.error || !pharmacy.data || !licenses || acceptance.error || events.error) return UNAVAILABLE('The application could not be read.')

  const bucket = db.storage.from(LICENSE_DOCUMENT_BUCKET)
  const withUrls = await Promise.all(licenses.map(async l => {
    let documentUrl: string | null = null
    if (l.document_path) {
      const { data, error } = await bucket.createSignedUrl(l.document_path, SIGNED_URL_SECONDS)
      if (error) console.error('[pharmacy-onboarding] signed URL for a license document failed:', error.message)
      documentUrl = data?.signedUrl ?? null
    }
    return {
      state: l.state_code, licenseNumber: l.license_number, expiresOn: l.expiration_date, sterileCompounding: l.sterile_compounding,
      verificationStatus: l.verification_status, verificationNote: l.verification_note, verifiedAt: l.verified_at, documentUrl,
    }
  }))
  const a = ((acceptance.data ?? []) as Array<{ signer_name: string; signer_title: string; accepted_at: string; template_version: string; text_sha256: string }>)[0]

  return {
    ok: true,
    review: {
      applicationId, pharmacyId, status: r.app.status, stepsCompleted: r.app.steps_completed ?? [],
      submittedAt: r.app.submitted_at, reviewNote: r.app.review_note,
      pharmacy: pharmacy.data as Record<string, unknown>,
      licenses: withUrls,
      ordering: orderingView(r.app),
      adapter: { required: needsAdapter(r.app.ordering_method), configuredAt: r.app.adapter_configured_at ?? null },
      acceptance: a ? { signerName: a.signer_name, signerTitle: a.signer_title, acceptedAt: a.accepted_at, templateVersion: a.template_version, textSha256: a.text_sha256, current: a.template_version === AGREEMENT.version } : null,
      catalog: {
        choice: r.app.catalog_choice, rowCount: r.app.catalog_row_count,
        warnings: Array.isArray(r.app.catalog_warnings) ? (r.app.catalog_warnings as unknown[]).map(String) : [],
        rows: Array.isArray(r.app.catalog_rows) ? r.app.catalog_rows as unknown[] : [],
      },
      events: ((events.data ?? []) as Array<{ action: string; actor_role: string; occurred_at: string; state_code: string | null }>)
        .map(e => ({ action: e.action, actorRole: e.actor_role, occurredAt: e.occurred_at, stateCode: e.state_code })),
    },
  }
}

// ── Actions ──────────────────────────────────────────────────

async function submitted(db: SupabaseClient, applicationId: string): Promise<{ ok: true; app: AppRow } | Fail> {
  const r = await readApplication(db, applicationId)
  if (!r.ok) return r
  if (r.app.status !== 'submitted') {
    return { ok: false, status: 409, error: r.app.status === 'approved' ? 'This pharmacy is already approved.' : 'This application is not submitted for review.' }
  }
  return r
}

/** Why a license cannot be verified under C5, or null when it can. */
function c5Problem(l: LicenseRow, now: Date): string | null {
  if (!l.document_path) return `The ${l.state_code} license has no document to check.`
  if (l.expiration_date < today(now)) return `The ${l.state_code} license expired on ${l.expiration_date}.`
  if (l.sterile_compounding === null) return `The ${l.state_code} license has no sterile compounding scope recorded.`
  return null
}

export async function decideLicense(
  db: SupabaseClient,
  input: { actor: OnboardingActor; applicationId: string; state: string; decision: 'verify' | 'reject'; note: string | null },
  now: Date = new Date(),
): Promise<{ ok: true } | Fail> {
  const state = /^[A-Za-z]{2}$/.test(input.state) ? input.state.toUpperCase() : null
  if (!state) return { ok: false, status: 400, error: 'Unknown state.' }
  if (input.decision !== 'verify' && input.decision !== 'reject') return { ok: false, status: 400, error: 'Choose verify or reject.' }
  const note = (input.note ?? '').trim()
  if (input.decision === 'reject' && !note) return { ok: false, status: 400, error: 'Say why the license is rejected; the pharmacy sees this note.', errors: { note: 'Required to reject.' } }
  if (note.length > 1000) return { ok: false, status: 400, error: 'Keep the note under 1000 characters.' }

  const r = await submitted(db, input.applicationId)
  if (!r.ok) return r
  const licenses = await readLicenses(db, r.app.pharmacy_id)
  if (!licenses) return UNAVAILABLE('The license could not be read.')
  const license = licenses.find(l => l.state_code === state)
  if (!license) return { ok: false, status: 404, error: 'This pharmacy has no license for that state.' }
  if (input.decision === 'verify') {
    const problem = c5Problem(license, now)
    if (problem) return { ok: false, status: 422, error: problem }
  }

  const action = input.decision === 'verify' ? 'license_verified' : 'license_rejected'
  const audit = { actor: input.actor, action, pharmacyId: r.app.pharmacy_id, applicationId: r.app.application_id, stateCode: state }
  if (!await recordOnboardingEvent(db, audit)) return { ok: false, status: 503, error: AUDIT_UNAVAILABLE }

  const patch = input.decision === 'verify'
    ? { verification_status: 'verified', is_active: true, verified_at: now.toISOString(), verified_by: input.actor.userId, verification_note: note || null }
    : { verification_status: 'rejected', is_active: false, verified_at: null, verified_by: null, verification_note: note }
  const { error } = await db.from('pharmacy_state_licenses').update(patch).eq('pharmacy_id', r.app.pharmacy_id).eq('state_code', state)
  if (error) {
    await recordOnboardingEvent(db, { ...audit, action: `${action}_failed` })
    return UNAVAILABLE('The license decision could not be saved.')
  }
  return { ok: true }
}

export async function approveApplication(
  db: SupabaseClient,
  input: { actor: OnboardingActor; applicationId: string },
  now: Date = new Date(),
): Promise<{ ok: true } | Fail> {
  const r = await submitted(db, input.applicationId)
  if (!r.ok) return r
  const pharmacyId = r.app.pharmacy_id

  const [licenses, acceptance] = await Promise.all([
    readLicenses(db, pharmacyId),
    db.from('pharmacy_agreement_acceptances').select('acceptance_id').eq('pharmacy_id', pharmacyId).eq('template_version', AGREEMENT.version).limit(1),
  ])
  if (!licenses || acceptance.error) return UNAVAILABLE('The application could not be read.')
  if (licenses.length === 0) return { ok: false, status: 409, error: 'The pharmacy has no state license.' }
  const notVerified = licenses.filter(l => l.verification_status !== 'verified').map(l => l.state_code)
  if (notVerified.length > 0) return { ok: false, status: 409, error: `Verify every license first. Not verified: ${notVerified.join(', ')}.` }
  const expired = licenses.filter(l => l.expiration_date < today(now))
  if (expired.length > 0) return { ok: false, status: 409, error: `A license has expired since it was verified: ${expired.map(l => `${l.state_code} on ${l.expiration_date}`).join(', ')}.` }
  if ((acceptance.data ?? []).length === 0) return { ok: false, status: 409, error: 'The pharmacy has not accepted the current BAA.' }
  if (!r.app.ordering_method) return { ok: false, status: 409, error: 'The pharmacy has not said how it receives orders.' }
  if (needsAdapter(r.app.ordering_method) && !r.app.adapter_configured_at) {
    return { ok: false, status: 409, error: `Configure the ${r.app.ordering_method === 'api' ? 'API' : 'portal'} adapter and mark it configured before approving.` }
  }

  const audit = { actor: input.actor, action: 'application_approved', pharmacyId, applicationId: r.app.application_id }
  if (!await recordOnboardingEvent(db, audit)) return { ok: false, status: 503, error: AUDIT_UNAVAILABLE }

  // Now, and only now, the pharmacy becomes live.
  const { data: activated, error: activateError } = await db.from('pharmacies')
    .update({ is_active: true, onboarding_status: 'approved' })
    .eq('pharmacy_id', pharmacyId).eq('onboarding_status', 'onboarding')
    .select('pharmacy_id')
  if (activateError || (activated ?? []).length === 0) {
    await recordOnboardingEvent(db, { ...audit, action: 'application_approve_failed' })
    return UNAVAILABLE('The pharmacy could not be activated.')
  }
  const { error: appError } = await db.from('pharmacy_onboarding_applications')
    .update({ status: 'approved', approved_at: now.toISOString(), reviewed_at: now.toISOString(), reviewed_by: input.actor.userId })
    .eq('application_id', r.app.application_id)
  if (appError) {
    const { error: revertError } = await db.from('pharmacies').update({ is_active: false, onboarding_status: 'onboarding' }).eq('pharmacy_id', pharmacyId)
    if (revertError) console.error(`[pharmacy-onboarding] CRITICAL: pharmacy active but application not approved | pharmacy=${pharmacyId}:`, revertError.code ?? revertError.message)
    await recordOnboardingEvent(db, { ...audit, action: 'application_approve_failed' })
    return UNAVAILABLE('The approval could not be saved.')
  }
  return { ok: true }
}

/**
 * Ops marks (or unmarks) an API or portal pharmacy's adapter as configured.
 * Required before approval; a fax pharmacy has no adapter to mark.
 */
export async function markAdapterConfigured(
  db: SupabaseClient,
  input: { actor: OnboardingActor; applicationId: string; configured: boolean },
  now: Date = new Date(),
): Promise<{ ok: true } | Fail> {
  if (typeof input.configured !== 'boolean') return { ok: false, status: 400, error: 'Say whether the adapter is configured.' }
  const r = await submitted(db, input.applicationId)
  if (!r.ok) return r
  if (!needsAdapter(r.app.ordering_method)) return { ok: false, status: 409, error: 'This pharmacy receives orders by fax: it has no adapter to configure.' }

  const audit = { actor: input.actor, action: input.configured ? 'adapter_marked_configured' : 'adapter_marked_unconfigured', pharmacyId: r.app.pharmacy_id, applicationId: r.app.application_id, detail: { method: r.app.ordering_method } }
  if (!await recordOnboardingEvent(db, audit)) return { ok: false, status: 503, error: AUDIT_UNAVAILABLE }
  const patch = input.configured
    ? { adapter_configured_at: now.toISOString(), adapter_configured_by: input.actor.userId }
    : { adapter_configured_at: null, adapter_configured_by: null }
  const { error } = await db.from('pharmacy_onboarding_applications').update(patch).eq('application_id', r.app.application_id)
  if (error) {
    await recordOnboardingEvent(db, { ...audit, action: `${audit.action}_failed` })
    return UNAVAILABLE('The adapter mark could not be saved.')
  }
  return { ok: true }
}

export async function sendBackApplication(
  db: SupabaseClient,
  input: { actor: OnboardingActor; applicationId: string; note: unknown },
  now: Date = new Date(),
): Promise<{ ok: true } | Fail> {
  const note = typeof input.note === 'string' ? input.note.trim() : ''
  if (!note) return { ok: false, status: 400, error: 'Say what the pharmacy needs to change; they see this note.', errors: { note: 'Required.' } }
  if (note.length > 1000) return { ok: false, status: 400, error: 'Keep the note under 1000 characters.', errors: { note: 'Too long.' } }
  const r = await submitted(db, input.applicationId)
  if (!r.ok) return r

  // The note stays on the application; the audit row is the action only.
  const audit = { actor: input.actor, action: 'application_sent_back', pharmacyId: r.app.pharmacy_id, applicationId: r.app.application_id }
  if (!await recordOnboardingEvent(db, audit)) return { ok: false, status: 503, error: AUDIT_UNAVAILABLE }
  const { error } = await db.from('pharmacy_onboarding_applications')
    .update({ status: 'sent_back', review_note: note, reviewed_at: now.toISOString(), reviewed_by: input.actor.userId })
    .eq('application_id', r.app.application_id).eq('status', 'submitted')
  if (error) {
    await recordOnboardingEvent(db, { ...audit, action: 'application_send_back_failed' })
    return UNAVAILABLE('The application could not be sent back.')
  }
  return { ok: true }
}
