// ============================================================
// The pharmacy's onboarding wizard, server side
// ============================================================
//
// Service-role reads and writes, always scoped to ctx.pharmacyId, which
// the route takes from the caller's verified claims (getUser(),
// claims.ts), never from the request body. The application can be edited
// while it is in progress or sent back.
//
// Nothing here makes a pharmacy reachable: it stays inactive
// (onboarding_status 'onboarding', enforced by CHECK) and its licenses
// stay pending and inactive until ops verifies and approves
// (lib/pharmacy-onboarding/review).

import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { validateCatalogRows } from '@/lib/catalog/validate-csv-rows'
import { AGREEMENT, agreementTextSha256 } from './agreement'
import { recordOnboardingEvent } from './events'
import type { Fail } from './invites'
import { ONBOARDING_STEPS, SAVED_STEPS, withStep, withoutStep, type SavedStepKey } from './steps'
import {
  validateAcceptance, validateDetails, validateFacility, validateLicense, validateOrdering, validateShipping,
  type OrderingMethod,
} from './validate'

export const LICENSE_DOCUMENT_BUCKET = 'pharmacy-license-documents'
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024
export const DOCUMENT_TYPES: Readonly<Record<string, string>> = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg' }
export const MAX_CATALOG_ROWS = 5000
const EDITABLE = new Set(['in_progress', 'sent_back'])

export interface WizardCtx { pharmacyId: string; userId: string }

interface AppRow {
  application_id:    string
  pharmacy_id:       string
  status:            string
  steps_completed:   string[] | null
  ordering_method:   OrderingMethod | null
  ordering_details:  Record<string, unknown> | null
  catalog_choice:    string | null
  catalog_row_count: number | null
  catalog_warnings:  unknown
  review_note:       string | null
  submitted_at:      string | null
}

const APP_COLUMNS = 'application_id, pharmacy_id, status, steps_completed, ordering_method, ordering_details, catalog_choice, catalog_row_count, catalog_warnings, review_note, submitted_at'
const UNAVAILABLE = (what: string): Fail => ({ ok: false, status: 503, error: `${what} Nothing was changed. Try again.` })
const invalid = (errors: Record<string, string>): Fail => ({ ok: false, status: 400, error: 'Check the highlighted fields.', errors })

async function readApplication(db: SupabaseClient, pharmacyId: string): Promise<{ ok: true; app: AppRow } | Fail> {
  const { data, error } = await db.from('pharmacy_onboarding_applications').select(APP_COLUMNS).eq('pharmacy_id', pharmacyId).maybeSingle()
  if (error) return UNAVAILABLE('Your application could not be read.')
  if (!data) return { ok: false, status: 404, error: 'No onboarding application was found for your pharmacy.' }
  return { ok: true, app: data as AppRow }
}

async function editable(db: SupabaseClient, pharmacyId: string): Promise<{ ok: true; app: AppRow } | Fail> {
  const r = await readApplication(db, pharmacyId)
  if (!r.ok) return r
  if (!EDITABLE.has(r.app.status)) {
    return { ok: false, status: 409, error: r.app.status === 'approved' ? 'Your pharmacy is approved. Contact CompoundIQ to change these details.' : 'Your application was submitted and is with CompoundIQ for review. It can be changed again if it is sent back.' }
  }
  return r
}

async function setSteps(db: SupabaseClient, app: AppRow, next: SavedStepKey[]): Promise<boolean> {
  const current = app.steps_completed ?? []
  if (next.length === current.length && next.every(s => current.includes(s))) return true
  const { error } = await db.from('pharmacy_onboarding_applications').update({ steps_completed: next }).eq('application_id', app.application_id)
  if (error) {
    console.error('[pharmacy-onboarding] progress could not be saved:', error.code ?? error.message)
    return false
  }
  app.steps_completed = next
  return true
}

async function updatePharmacy(db: SupabaseClient, pharmacyId: string, patch: Record<string, unknown>): Promise<boolean> {
  const { error } = await db.from('pharmacies').update(patch).eq('pharmacy_id', pharmacyId).eq('onboarding_status', 'onboarding')
  if (error) {
    console.error('[pharmacy-onboarding] pharmacy could not be updated:', error.code ?? error.message)
    return false
  }
  return true
}

/** Save a pharmacies-column step: validated value, then the step. */
async function savePharmacyStep(
  db: SupabaseClient, ctx: WizardCtx, step: SavedStepKey, patch: Record<string, unknown>,
): Promise<{ ok: true } | Fail> {
  const r = await editable(db, ctx.pharmacyId)
  if (!r.ok) return r
  if (!await updatePharmacy(db, ctx.pharmacyId, patch)) return UNAVAILABLE('Your details could not be saved.')
  if (!await setSteps(db, r.app, withStep(r.app.steps_completed ?? [], step))) return UNAVAILABLE('Your progress could not be saved.')
  return { ok: true }
}

// ── a, b, e. Details, facility, shipping ─────────────────────

export async function saveDetails(db: SupabaseClient, ctx: WizardCtx, input: Record<string, unknown>): Promise<{ ok: true } | Fail> {
  const v = validateDetails(input)
  if (!v.ok) return invalid(v.errors)
  return savePharmacyStep(db, ctx, 'details', { ...v.value })
}

export async function saveFacility(db: SupabaseClient, ctx: WizardCtx, input: Record<string, unknown>): Promise<{ ok: true } | Fail> {
  const v = validateFacility(input)
  if (!v.ok) return invalid(v.errors)
  return savePharmacyStep(db, ctx, 'facility', { ...v.value })
}

export async function saveShipping(db: SupabaseClient, ctx: WizardCtx, input: Record<string, unknown>): Promise<{ ok: true } | Fail> {
  const v = validateShipping(input)
  if (!v.ok) return invalid(v.errors)
  return savePharmacyStep(db, ctx, 'shipping', { ...v.value })
}

// ── c. State licenses ────────────────────────────────────────

interface LicenseRow {
  state_code:          string
  license_number:      string
  expiration_date:     string
  sterile_compounding: boolean | null
  verification_status: string
  verification_note:   string | null
  document_path:       string | null
}

async function readLicenses(db: SupabaseClient, pharmacyId: string): Promise<LicenseRow[] | null> {
  const { data, error } = await db.from('pharmacy_state_licenses')
    .select('state_code, license_number, expiration_date, sterile_compounding, verification_status, verification_note, document_path')
    .eq('pharmacy_id', pharmacyId).is('deleted_at', null).order('state_code', { ascending: true })
  if (error) {
    console.error('[pharmacy-onboarding] licenses could not be read:', error.code ?? error.message)
    return null
  }
  return (data ?? []) as LicenseRow[]
}

/** The licenses step is done: at least one license, and each has its document. */
async function syncLicensesStep(db: SupabaseClient, app: AppRow): Promise<boolean> {
  const licenses = await readLicenses(db, app.pharmacy_id)
  if (!licenses) return false
  const done = licenses.length > 0 && licenses.every(l => !!l.document_path)
  const steps = app.steps_completed ?? []
  return setSteps(db, app, done ? withStep(steps, 'licenses') : withoutStep(steps, 'licenses'))
}

export async function saveLicense(db: SupabaseClient, ctx: WizardCtx, input: Record<string, unknown>, now: Date = new Date()): Promise<{ ok: true } | Fail> {
  const v = validateLicense(input, now)
  if (!v.ok) return invalid(v.errors)
  const r = await editable(db, ctx.pharmacyId)
  if (!r.ok) return r
  // Pending and inactive until ops verifies (CHECK chk_psl_unverified_inactive).
  const { error } = await db.from('pharmacy_state_licenses').upsert({
    pharmacy_id: ctx.pharmacyId,
    ...v.value,
    is_active: false,
    deleted_at: null,
    verification_status: 'pending',
    verified_at: null,
    verified_by: null,
  }, { onConflict: 'pharmacy_id,state_code' })
  if (error) {
    console.error('[pharmacy-onboarding] license could not be saved:', error.code ?? error.message)
    return UNAVAILABLE('The license could not be saved.')
  }
  await recordOnboardingEvent(db, { actor: { userId: ctx.userId, role: 'pharmacy_admin' }, action: 'license_saved', pharmacyId: ctx.pharmacyId, applicationId: r.app.application_id, stateCode: v.value.state_code })
  if (!await syncLicensesStep(db, r.app)) return UNAVAILABLE('Your progress could not be saved.')
  return { ok: true }
}

const stateCode = (raw: string): string | null => (/^[A-Za-z]{2}$/.test(raw) ? raw.toUpperCase() : null)

export async function deleteLicense(db: SupabaseClient, ctx: WizardCtx, rawState: string): Promise<{ ok: true } | Fail> {
  const state = stateCode(rawState)
  if (!state) return { ok: false, status: 400, error: 'Unknown state.' }
  const r = await editable(db, ctx.pharmacyId)
  if (!r.ok) return r
  const licenses = await readLicenses(db, ctx.pharmacyId)
  if (!licenses) return UNAVAILABLE('The license could not be read.')
  const license = licenses.find(l => l.state_code === state)
  if (!license) return { ok: false, status: 404, error: 'There is no license for that state.' }

  const { error } = await db.from('pharmacy_state_licenses').delete().eq('pharmacy_id', ctx.pharmacyId).eq('state_code', state)
  if (error) return UNAVAILABLE('The license could not be removed.')
  if (license.document_path) {
    const { error: removeError } = await db.storage.from(LICENSE_DOCUMENT_BUCKET).remove([license.document_path])
    if (removeError) console.error('[pharmacy-onboarding] license document left in storage after its license was removed:', removeError.message)
  }
  await recordOnboardingEvent(db, { actor: { userId: ctx.userId, role: 'pharmacy_admin' }, action: 'license_removed', pharmacyId: ctx.pharmacyId, applicationId: r.app.application_id, stateCode: state })
  if (!await syncLicensesStep(db, r.app)) return UNAVAILABLE('Your progress could not be saved.')
  return { ok: true }
}

export interface UploadedFile { name: string; type: string; size: number; bytes: Uint8Array }

export async function attachLicenseDocument(db: SupabaseClient, ctx: WizardCtx, rawState: string, file: UploadedFile): Promise<{ ok: true } | Fail> {
  const state = stateCode(rawState)
  if (!state) return { ok: false, status: 400, error: 'Unknown state.' }
  const ext = DOCUMENT_TYPES[file.type]
  if (!ext) return { ok: false, status: 400, error: 'Upload the license as a PDF, PNG or JPEG.' }
  if (file.size <= 0 || file.size > MAX_DOCUMENT_BYTES) return { ok: false, status: 400, error: 'The file must be under 10 MB.' }

  const r = await editable(db, ctx.pharmacyId)
  if (!r.ok) return r
  const licenses = await readLicenses(db, ctx.pharmacyId)
  if (!licenses) return UNAVAILABLE('The license could not be read.')
  const license = licenses.find(l => l.state_code === state)
  if (!license) return { ok: false, status: 404, error: 'Add the license details for that state first.' }

  const path = `${ctx.pharmacyId}/${state}/${randomUUID()}.${ext}`
  const bucket = db.storage.from(LICENSE_DOCUMENT_BUCKET)
  const { error: uploadError } = await bucket.upload(path, file.bytes, { contentType: file.type, upsert: false })
  if (uploadError) {
    console.error('[pharmacy-onboarding] license document upload failed:', uploadError.message)
    return UNAVAILABLE('The document could not be uploaded.')
  }
  // A new document means ops looks at the license again.
  const { error } = await db.from('pharmacy_state_licenses')
    .update({ document_path: path, verification_status: 'pending', is_active: false, verified_at: null, verified_by: null })
    .eq('pharmacy_id', ctx.pharmacyId).eq('state_code', state)
  if (error) {
    const { error: cleanupError } = await bucket.remove([path])
    if (cleanupError) console.error('[pharmacy-onboarding] orphaned license document after a failed save:', cleanupError.message)
    return UNAVAILABLE('The document could not be saved.')
  }
  if (license.document_path) {
    const { error: oldError } = await bucket.remove([license.document_path])
    if (oldError) console.error('[pharmacy-onboarding] replaced license document left in storage:', oldError.message)
  }
  await recordOnboardingEvent(db, { actor: { userId: ctx.userId, role: 'pharmacy_admin' }, action: 'license_document_uploaded', pharmacyId: ctx.pharmacyId, applicationId: r.app.application_id, stateCode: state })
  if (!await syncLicensesStep(db, r.app)) return UNAVAILABLE('Your progress could not be saved.')
  return { ok: true }
}

// ── d. How orders reach the pharmacy ─────────────────────────

type VaultIds = Record<string, string>

async function deleteVaultSecrets(db: SupabaseClient, ids: string[]): Promise<void> {
  for (const id of ids) {
    const { error } = await db.rpc('delete_vault_secret', { p_secret_id: id })
    if (error) console.error('[pharmacy-onboarding] a replaced Vault secret could not be deleted:', error.message)
  }
}

export async function saveOrdering(db: SupabaseClient, ctx: WizardCtx, input: Record<string, unknown>): Promise<{ ok: true } | Fail> {
  const r = await editable(db, ctx.pharmacyId)
  if (!r.ok) return r
  const method = typeof input['method'] === 'string' ? input['method'] : ''
  const sameMethod = r.app.ordering_method === method
  const saved: VaultIds = sameMethod ? ((r.app.ordering_details?.['vault'] as VaultIds | undefined) ?? {}) : {}
  const v = validateOrdering(input, { hasSavedSecrets: Object.keys(saved).length > 0 })
  if (!v.ok) return invalid(v.errors)

  // Secrets go to Vault only: rotate a saved one, create a new one.
  const vault: VaultIds = { ...saved }
  const created: string[] = []
  for (const [key, secret] of Object.entries(v.value.secrets)) {
    if (vault[key]) {
      const { error } = await db.rpc('rotate_vault_secret', { p_secret_id: vault[key], p_new_secret: secret })
      if (error) {
        await deleteVaultSecrets(db, created)
        return UNAVAILABLE('The credentials could not be stored securely.')
      }
    } else {
      const { data, error } = await db.rpc('create_vault_secret', { p_name: `pharmacy_${ctx.pharmacyId}_${key}`, p_secret: secret })
      if (error || typeof data !== 'string') {
        await deleteVaultSecrets(db, created)
        return UNAVAILABLE('The credentials could not be stored securely.')
      }
      vault[key] = data
      created.push(data)
    }
  }

  const details = Object.keys(vault).length > 0 ? { ...v.value.details, vault } : { ...v.value.details }
  const { error: appError } = await db.from('pharmacy_onboarding_applications')
    .update({ ordering_method: v.value.method, ordering_details: details })
    .eq('application_id', r.app.application_id)
  if (appError) {
    await deleteVaultSecrets(db, created)
    return UNAVAILABLE('How you receive orders could not be saved.')
  }
  const pharmacyPatch: Record<string, unknown> = { integration_tier: v.value.tier }
  if (v.value.faxNumber) pharmacyPatch['fax_number'] = v.value.faxNumber
  if (!await updatePharmacy(db, ctx.pharmacyId, pharmacyPatch)) return UNAVAILABLE('How you receive orders could not be saved.')

  // A method changed: the old method's secrets are no longer needed.
  if (!sameMethod) {
    const old = (r.app.ordering_details?.['vault'] as VaultIds | undefined) ?? {}
    await deleteVaultSecrets(db, Object.values(old))
  }
  await recordOnboardingEvent(db, { actor: { userId: ctx.userId, role: 'pharmacy_admin' }, action: 'ordering_saved', pharmacyId: ctx.pharmacyId, applicationId: r.app.application_id, detail: { method: v.value.method } })
  if (!await setSteps(db, r.app, withStep(r.app.steps_completed ?? [], 'ordering'))) return UNAVAILABLE('Your progress could not be saved.')
  return { ok: true }
}

// ── f. BAA and terms ─────────────────────────────────────────

export async function acceptAgreement(db: SupabaseClient, ctx: WizardCtx, input: Record<string, unknown>, now: Date = new Date()): Promise<{ ok: true } | Fail> {
  const v = validateAcceptance(input)
  if (!v.ok) return invalid(v.errors)
  const r = await editable(db, ctx.pharmacyId)
  if (!r.ok) return r

  const { data: existing, error: readError } = await db.from('pharmacy_agreement_acceptances')
    .select('acceptance_id').eq('pharmacy_id', ctx.pharmacyId).eq('template_version', AGREEMENT.version).limit(1)
  if (readError) return UNAVAILABLE('The agreement could not be recorded.')
  if ((existing ?? []).length === 0) {
    // Append-only: who, as whom, when, which version, which exact text.
    const { error } = await db.from('pharmacy_agreement_acceptances').insert({
      pharmacy_id: ctx.pharmacyId,
      application_id: r.app.application_id,
      user_id: ctx.userId,
      ...v.value,
      accepted_at: now.toISOString(),
    })
    if (error) {
      console.error('[pharmacy-onboarding] acceptance could not be recorded:', error.code ?? error.message)
      return UNAVAILABLE('The agreement could not be recorded.')
    }
    await recordOnboardingEvent(db, { actor: { userId: ctx.userId, role: 'pharmacy_admin' }, action: 'agreement_accepted', pharmacyId: ctx.pharmacyId, applicationId: r.app.application_id, detail: { template_version: AGREEMENT.version } })
  }
  if (!await setSteps(db, r.app, withStep(r.app.steps_completed ?? [], 'agreement'))) return UNAVAILABLE('Your progress could not be saved.')
  return { ok: true }
}

// ── g. Catalog ───────────────────────────────────────────────

export async function saveCatalog(
  db: SupabaseClient, ctx: WizardCtx, input: Record<string, unknown>,
): Promise<{ ok: true; rowCount: number; warnings: string[] } | (Fail & { warnings?: string[] })> {
  const choice = input['choice']
  let patch: Record<string, unknown>
  let rowCount = 0
  let warnings: string[] = []
  if (choice === 'skipped') {
    patch = { catalog_choice: 'skipped', catalog_rows: null, catalog_row_count: null, catalog_warnings: null }
  } else if (choice === 'uploaded') {
    const rows = input['rows']
    if (!Array.isArray(rows) || rows.length === 0) return { ok: false, status: 400, error: 'The CSV has no rows.' }
    if (rows.length > MAX_CATALOG_ROWS) return { ok: false, status: 400, error: `The CSV has more than ${MAX_CATALOG_ROWS} rows. Split it, or skip and send it to CompoundIQ.` }
    const checked = validateCatalogRows(rows)
    warnings = checked.warnings.slice(0, 200)
    if (checked.valid.length === 0) return { ok: false, status: 422, error: 'No row in the CSV could be used. Check the columns against the template.', warnings }
    rowCount = checked.valid.length
    patch = { catalog_choice: 'uploaded', catalog_rows: checked.valid, catalog_row_count: rowCount, catalog_warnings: warnings }
  } else {
    return { ok: false, status: 400, error: 'Upload a catalog CSV or choose to skip.' }
  }

  const r = await editable(db, ctx.pharmacyId)
  if (!r.ok) return r
  const { error } = await db.from('pharmacy_onboarding_applications').update(patch).eq('application_id', r.app.application_id)
  if (error) return UNAVAILABLE('The catalog could not be saved.')
  await recordOnboardingEvent(db, { actor: { userId: ctx.userId, role: 'pharmacy_admin' }, action: choice === 'skipped' ? 'catalog_skipped' : 'catalog_staged', pharmacyId: ctx.pharmacyId, applicationId: r.app.application_id, detail: { rows: rowCount } })
  if (!await setSteps(db, r.app, withStep(r.app.steps_completed ?? [], 'catalog'))) return UNAVAILABLE('Your progress could not be saved.')
  return { ok: true, rowCount, warnings }
}

// ── h. Submit ────────────────────────────────────────────────

export async function submitApplication(db: SupabaseClient, ctx: WizardCtx, now: Date = new Date()): Promise<{ ok: true } | Fail> {
  const r = await editable(db, ctx.pharmacyId)
  if (!r.ok) return r
  const done = r.app.steps_completed ?? []
  const missing = SAVED_STEPS.filter(s => !done.includes(s))
  if (missing.length > 0) {
    const labels = missing.map(s => ONBOARDING_STEPS.find(x => x.key === s)!.label)
    return { ok: false, status: 409, error: `Finish these steps before you submit: ${labels.join(', ')}.` }
  }
  if (!await recordOnboardingEvent(db, { actor: { userId: ctx.userId, role: 'pharmacy_admin' }, action: 'application_submitted', pharmacyId: ctx.pharmacyId, applicationId: r.app.application_id })) {
    return UNAVAILABLE('Your application could not be submitted.')
  }
  const { data, error } = await db.from('pharmacy_onboarding_applications')
    .update({ status: 'submitted', submitted_at: now.toISOString() })
    .eq('application_id', r.app.application_id).in('status', ['in_progress', 'sent_back'])
    .select('application_id')
  if (error || (data ?? []).length === 0) return UNAVAILABLE('Your application could not be submitted.')
  return { ok: true }
}

// ── Load ─────────────────────────────────────────────────────

export interface WizardState {
  status:         string
  stepsCompleted: string[]
  reviewNote:     string | null
  submittedAt:    string | null
  pharmacy:       Record<string, unknown>
  licenses:       Array<{ state: string; licenseNumber: string; expiresOn: string; sterileCompounding: boolean | null; verificationStatus: string; verificationNote: string | null; hasDocument: boolean }>
  ordering:       Record<string, unknown> | null
  catalog:        { choice: string | null; rowCount: number | null; warnings: string[] }
  agreement:      { key: string; version: string; title: string; text: string; textSha256: string; banner: string; draft: boolean; acceptance: { signerName: string; signerTitle: string; acceptedAt: string } | null }
}

const PHARMACY_COLUMNS = 'name, legal_name, dba_name, address_line1, address_line2, city, state, zip, phone, ncpdp_id, npi, dea_number, facility_type, integration_tier, fax_number, ship_carriers, ships_cold_chain, ship_to_states, order_cutoff_local, onboarding_status, is_active'

/** How orders reach the pharmacy, as shown: never secrets or Vault ids. */
export function orderingView(app: { ordering_method: string | null; ordering_details: Record<string, unknown> | null }): Record<string, unknown> | null {
  const d = app.ordering_details ?? {}
  const secretsStored = !!d['vault'] && Object.keys(d['vault'] as object).length > 0
  if (app.ordering_method === 'api') return { method: 'api', baseUrl: d['base_url'] ?? null, authType: d['auth_type'] ?? null, secretsStored }
  if (app.ordering_method === 'portal') return { method: 'portal', portalUrl: d['portal_url'] ?? null, secretsStored }
  if (app.ordering_method === 'fax') return { method: 'fax', faxNumber: d['fax_number'] ?? null }
  return null
}

export async function loadOnboarding(db: SupabaseClient, pharmacyId: string): Promise<{ ok: true; state: WizardState } | Fail> {
  const r = await readApplication(db, pharmacyId)
  if (!r.ok) return r
  const [pharmacy, licenses, acceptance] = await Promise.all([
    db.from('pharmacies').select(PHARMACY_COLUMNS).eq('pharmacy_id', pharmacyId).maybeSingle(),
    readLicenses(db, pharmacyId),
    db.from('pharmacy_agreement_acceptances').select('signer_name, signer_title, accepted_at, template_version')
      .eq('pharmacy_id', pharmacyId).eq('template_version', AGREEMENT.version).order('accepted_at', { ascending: false }).limit(1),
  ])
  if (pharmacy.error || !pharmacy.data || !licenses || acceptance.error) return UNAVAILABLE('Your application could not be read.')
  const accepted = ((acceptance.data ?? []) as Array<{ signer_name: string; signer_title: string; accepted_at: string }>)[0] ?? null
  const warnings = Array.isArray(r.app.catalog_warnings) ? (r.app.catalog_warnings as unknown[]).map(String) : []

  return {
    ok: true,
    state: {
      status: r.app.status,
      stepsCompleted: r.app.steps_completed ?? [],
      reviewNote: r.app.review_note,
      submittedAt: r.app.submitted_at,
      pharmacy: pharmacy.data as Record<string, unknown>,
      licenses: licenses.map(l => ({
        state: l.state_code, licenseNumber: l.license_number, expiresOn: l.expiration_date, sterileCompounding: l.sterile_compounding,
        verificationStatus: l.verification_status, verificationNote: l.verification_note, hasDocument: !!l.document_path,
      })),
      ordering: orderingView(r.app),
      catalog: { choice: r.app.catalog_choice, rowCount: r.app.catalog_row_count, warnings },
      agreement: {
        key: AGREEMENT.key, version: AGREEMENT.version, title: AGREEMENT.title, text: AGREEMENT.text,
        textSha256: agreementTextSha256(), banner: AGREEMENT.banner, draft: AGREEMENT.draft,
        acceptance: accepted ? { signerName: accepted.signer_name, signerTitle: accepted.signer_title, acceptedAt: accepted.accepted_at } : null,
      },
    },
  }
}
