/**
 * @jest-environment node
 *
 * Inbound EHR patients (Keragon): the contract, the mapping to patients,
 * matching and upsert.
 *
 *   - Contract: event_id, event_type 'patient.upsert', and a patient with
 *     external_patient_id, name, date_of_birth, sex, mobile, email,
 *     address, allergies. Invalid input names the fields.
 *   - Upsert by (clinic, 'keragon', external_patient_id) through
 *     patient_external_ids.
 *   - Otherwise the intake duplicate rule (same date of birth and the same
 *     mobile or the same name, active patients of this clinic): one match
 *     with the same name is linked, not duplicated. More than one match, a
 *     mobile match under a different name, or a match already linked to
 *     another EHR id: a new patient flagged for staff (possible_duplicate_of).
 *     Never merged.
 *   - A field the patient entered at self-intake is never overwritten: the
 *     EHR's value is kept in patient_field_changes (applied = false) and
 *     the event is flagged. Every field sync does change is recorded too.
 *   - SMS consent is never set by sync.
 *   - The result for the log: ids, codes and field names only.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { onboardingFake } from '@/__tests__/helpers/onboarding-fake'
import { parsePatientEvent } from '../contract'
import { toPatientFields } from '../mapping'
import { applyPatientEvent } from '../sync'

const fixture = (name: string) => JSON.parse(readFileSync(join(__dirname, '..', '__fixtures__', name), 'utf8')) as Record<string, unknown>
const FULL = fixture('patient-upsert-full.json')
const MINIMAL = fixture('patient-upsert-minimal.json')
const INVALID = fixture('patient-upsert-invalid.json')

const CLINIC = 'c1000000-0000-4000-8000-000000000001'
const OTHER_CLINIC = 'c1000000-0000-4000-8000-000000000002'
const NOW = new Date('2026-10-12T15:00:30.000Z')
const SYNC_EVENT = 'se000000-0000-4000-8000-000000000001'

function patientOf(event: Record<string, unknown>, over: Record<string, unknown> = {}) {
  const r = parsePatientEvent({ ...event, patient: { ...(event['patient'] as object), ...over } })
  if (!r.ok) throw new Error(JSON.stringify(r.errors))
  return r.event.patient
}

const existing = (over: Record<string, unknown> = {}) => ({
  patient_id: `p-${Math.random().toString(16).slice(2, 10)}`, clinic_id: CLINIC, is_active: true, deleted_at: null,
  first_name: 'Jordan', last_name: 'Sample', date_of_birth: '1985-04-12', sex: 'female',
  phone: '+15125550147', phone_e164: '+15125550147', email: null, address_line1: null, address_line2: null, city: null, state: null, zip: null,
  allergies: null, nkda: false, source: 'staff', external_id: null, intake_status: 'complete', intake_completed_at: null,
  sms_opt_in: false, sms_consent_at: null, sms_consent_source: null, possible_duplicate_of: null, ...over,
})

function world(patients: Record<string, unknown>[] = [], links: Record<string, unknown>[] = []) {
  return onboardingFake(
    { patients, patient_external_ids: links, patient_field_changes: [] },
    { unique: { patient_external_ids: ['clinic_id+system+external_patient_id', 'patient_id+system'] } },
  )
}
const ctx = { clinicId: CLINIC, syncEventId: SYNC_EVENT, now: NOW }

// ── Contract ─────────────────────────────────────────────────

describe('the contract', () => {
  it('the full sample parses, with the mobile as given and the address nested', () => {
    const r = parsePatientEvent(FULL)
    expect(r).toEqual({ ok: true, event: expect.objectContaining({ eventId: 'evt_demo_0001', eventType: 'patient.upsert', patient: expect.objectContaining({
      externalPatientId: 'EHR-DEMO-10001', firstName: 'Jordan', lastName: 'Sample', dateOfBirth: '1985-04-12', sex: 'female',
      mobile: '+15125550147', email: 'jordan.sample@example.com',
      address: { line1: '100 Example St', line2: 'Apt 4', city: 'Austin', state: 'TX', zip: '78701' },
      allergies: ['Penicillin', 'Sulfa'], noKnownDrugAllergies: false,
    }) }) })
  })

  it('only external_patient_id, the name, date of birth and mobile are required; absent fields stay absent', () => {
    const r = parsePatientEvent(MINIMAL)
    if (!r.ok) throw new Error('should parse')
    expect(r.event.patient.sex).toBeUndefined()
    expect(r.event.patient.email).toBeUndefined()
    expect(r.event.patient.address).toBeUndefined()
    expect(r.event.patient.allergies).toBeUndefined()
  })

  it('invalid input names each field, and keeps the event id for the log', () => {
    const r = parsePatientEvent(INVALID)
    expect(r).toEqual({ ok: false, eventId: 'evt_demo_0003', errors: expect.objectContaining({
      'patient.external_patient_id': expect.any(String), 'patient.date_of_birth': expect.any(String), 'patient.sex': expect.any(String), 'patient.mobile': expect.any(String),
    }) })
  })

  it('refuses a missing or malformed event id, an unknown event type, a future DOB, a bad email, state or zip', () => {
    const bad = (p: Record<string, unknown>, top: Record<string, unknown> = {}) => parsePatientEvent({ ...FULL, ...top, patient: { ...(FULL['patient'] as object), ...p } })
    expect(bad({}, { event_id: undefined })).toMatchObject({ ok: false, errors: { event_id: expect.any(String) } })
    expect(bad({}, { event_id: 'has spaces' })).toMatchObject({ ok: false, errors: { event_id: expect.any(String) } })
    expect(bad({}, { event_type: 'patient.delete' })).toMatchObject({ ok: false, errors: { event_type: expect.any(String) } })
    expect(bad({ date_of_birth: '2999-01-01' })).toMatchObject({ ok: false, errors: { 'patient.date_of_birth': expect.any(String) } })
    expect(bad({ email: 'not-an-email' })).toMatchObject({ ok: false, errors: { 'patient.email': expect.any(String) } })
    expect(bad({ address: { line1: 'x', city: 'Austin', state: 'Texas', zip: '787' } })).toMatchObject({ ok: false, errors: { 'patient.address.state': expect.any(String), 'patient.address.zip': expect.any(String) } })
    expect(parsePatientEvent('not json object')).toMatchObject({ ok: false, eventId: null })
  })
})

// ── Mapping ──────────────────────────────────────────────────

describe('the mapping to patients', () => {
  it('maps every contract field to its patients column, the mobile to E.164', () => {
    expect(toPatientFields(patientOf(FULL))).toEqual({
      first_name: 'Jordan', last_name: 'Sample', date_of_birth: '1985-04-12', sex: 'female',
      phone: '+15125550147', phone_e164: '+15125550147', email: 'jordan.sample@example.com',
      address_line1: '100 Example St', address_line2: 'Apt 4', city: 'Austin', state: 'TX', zip: '78701',
      allergies: ['Penicillin', 'Sulfa'], nkda: false,
    })
  })

  it('a (512) mobile becomes +1512...; absent fields are not mapped (never cleared)', () => {
    const f = toPatientFields(patientOf(MINIMAL))
    expect(f).toEqual({ first_name: 'Riley', last_name: 'Example', date_of_birth: '1990-01-31', phone: '+15125550148', phone_e164: '+15125550148' })
  })

  it('never maps SMS consent, whatever the payload says', () => {
    const p = patientOf(FULL, { sms_opt_in: true, sms_consent: true })
    expect(Object.keys(toPatientFields(p)).filter(k => k.startsWith('sms'))).toEqual([])
  })
})

// ── Upsert and matching ──────────────────────────────────────

describe('a new patient', () => {
  it('is created with source ehr and the external id, linked, never opted in to SMS', async () => {
    const db = world()
    const out = await applyPatientEvent(db.client, ctx, patientOf(FULL))
    expect(out).toEqual(expect.objectContaining({ status: 'applied', patientId: expect.any(String), detail: expect.objectContaining({ action: 'created' }) }))
    const [p] = db.rows('patients')
    expect(p).toEqual(expect.objectContaining({ clinic_id: CLINIC, source: 'ehr', external_id: 'EHR-DEMO-10001', first_name: 'Jordan', phone_e164: '+15125550147', intake_status: 'complete', sms_opt_in: false }))
    expect(Object.keys(p!).filter(k => k.startsWith('sms_consent'))).toEqual([])
    expect(db.rows('patient_external_ids')).toEqual([expect.objectContaining({ clinic_id: CLINIC, patient_id: out.patientId, system: 'keragon', external_patient_id: 'EHR-DEMO-10001', last_synced_at: NOW.toISOString() })])
  })

  it('without a usable mobile it cannot be created (patients need one): an error, nothing written', async () => {
    const db = world()
    const p = { ...patientOf(MINIMAL) }
    delete (p as { mobile?: string }).mobile
    expect(await applyPatientEvent(db.client, ctx, p)).toEqual(expect.objectContaining({ status: 'error', errorCode: 'mobile_required', patientId: null }))
    expect(db.rows('patients')).toEqual([])
  })
})

describe('upsert by external id', () => {
  it('the same external id updates the linked patient and records each change', async () => {
    const linked = existing({ patient_id: 'p-linked', source: 'ehr', external_id: 'EHR-DEMO-10001', email: 'old@example.com' })
    const db = world([linked], [{ link_id: 'l1', clinic_id: CLINIC, patient_id: 'p-linked', system: 'keragon', external_patient_id: 'EHR-DEMO-10001' }])
    const out = await applyPatientEvent(db.client, ctx, patientOf(FULL))
    expect(out).toEqual(expect.objectContaining({ status: 'applied', patientId: 'p-linked', detail: expect.objectContaining({ action: 'updated', fields_updated: expect.arrayContaining(['email', 'address_line1', 'allergies']) }) }))
    expect(db.rows('patients')).toHaveLength(1)
    expect(db.rows('patients')[0]).toEqual(expect.objectContaining({ email: 'jordan.sample@example.com', city: 'Austin', allergies: ['Penicillin', 'Sulfa'] }))
    expect(db.rows('patient_field_changes')).toEqual(expect.arrayContaining([expect.objectContaining({
      clinic_id: CLINIC, patient_id: 'p-linked', field: 'email', old_value: 'old@example.com', new_value: 'jordan.sample@example.com', applied: true, source: 'ehr_sync', sync_event_id: SYNC_EVENT,
    })]))
  })

  it('nothing different: skipped, nothing written', async () => {
    const same = existing({ patient_id: 'p-same', email: 'jordan.sample@example.com', address_line1: '100 Example St', address_line2: 'Apt 4', city: 'Austin', state: 'TX', zip: '78701', allergies: ['Penicillin', 'Sulfa'] })
    const db = world([same], [{ link_id: 'l1', clinic_id: CLINIC, patient_id: 'p-same', system: 'keragon', external_patient_id: 'EHR-DEMO-10001' }])
    expect(await applyPatientEvent(db.client, ctx, patientOf(FULL))).toEqual(expect.objectContaining({ status: 'skipped', patientId: 'p-same' }))
    expect(db.writes('patients', 'update')).toEqual([])
    expect(db.rows('patient_field_changes')).toEqual([])
  })

  it('a linked patient that was removed is not revived: skipped with a code', async () => {
    const gone = existing({ patient_id: 'p-gone', is_active: false, deleted_at: '2026-10-01T00:00:00Z' })
    const db = world([gone], [{ link_id: 'l1', clinic_id: CLINIC, patient_id: 'p-gone', system: 'keragon', external_patient_id: 'EHR-DEMO-10001' }])
    expect(await applyPatientEvent(db.client, ctx, patientOf(FULL))).toEqual(expect.objectContaining({ status: 'skipped', patientId: 'p-gone', errorCode: 'patient_inactive' }))
    expect(db.writes('patients')).toEqual([])
  })
})

describe('matching with the intake duplicate rules', () => {
  it('one active patient with the same DOB, mobile and name: linked, not duplicated', async () => {
    const db = world([existing({ patient_id: 'p-match' })])
    const out = await applyPatientEvent(db.client, ctx, patientOf(FULL))
    expect(out).toEqual(expect.objectContaining({ status: 'applied', patientId: 'p-match', detail: expect.objectContaining({ action: 'linked', matched_on: 'mobile_and_date_of_birth' }) }))
    expect(db.rows('patients')).toHaveLength(1)
    expect(db.rows('patient_external_ids')).toEqual([expect.objectContaining({ patient_id: 'p-match', external_patient_id: 'EHR-DEMO-10001' })])
    expect(db.rows('patients')[0]!['source']).toBe('staff')
  })

  it('the same name and DOB with a new mobile: linked (matched on name and DOB), the mobile updated and recorded', async () => {
    const db = world([existing({ patient_id: 'p-name', phone: '+15125550999', phone_e164: '+15125550999' })])
    const out = await applyPatientEvent(db.client, ctx, patientOf(FULL))
    expect(out).toEqual(expect.objectContaining({ status: 'applied', patientId: 'p-name', detail: expect.objectContaining({ action: 'linked', matched_on: 'name_and_date_of_birth' }) }))
    expect(db.rows('patients')[0]).toEqual(expect.objectContaining({ phone_e164: '+15125550147' }))
    expect(db.rows('patient_field_changes')).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'phone', old_value: '+15125550999', new_value: '+15125550147', applied: true })]))
  })

  it('names compare case- and space-insensitively', async () => {
    const db = world([existing({ patient_id: 'p-case', first_name: ' jordan ', last_name: 'SAMPLE' })])
    expect(await applyPatientEvent(db.client, ctx, patientOf(FULL))).toEqual(expect.objectContaining({ patientId: 'p-case', detail: expect.objectContaining({ action: 'linked' }) }))
  })

  it('the same mobile and DOB under a different name (twins on a parent\'s phone): a new patient, flagged, never merged', async () => {
    const db = world([existing({ patient_id: 'p-twin', first_name: 'Morgan' })])
    const out = await applyPatientEvent(db.client, ctx, patientOf(FULL))
    expect(out).toEqual(expect.objectContaining({ status: 'flagged', detail: expect.objectContaining({ action: 'created', reason: 'name_differs' }) }))
    expect(db.rows('patients')).toHaveLength(2)
    const created = db.rows('patients').find(p => p['patient_id'] === out.patientId)!
    expect(created).toEqual(expect.objectContaining({ possible_duplicate_of: 'p-twin', possible_duplicate_matched_on: 'mobile_and_date_of_birth', possible_duplicate_flagged_at: NOW.toISOString() }))
    expect(db.rows('patients').find(p => p['patient_id'] === 'p-twin')!['first_name']).toBe('Morgan')
  })

  it('more than one match: a new patient flagged against the mobile match', async () => {
    const db = world([
      existing({ patient_id: 'p-by-name', phone: '+15125550999', phone_e164: '+15125550999' }),
      existing({ patient_id: 'p-by-mobile' }),
    ])
    const out = await applyPatientEvent(db.client, ctx, patientOf(FULL))
    expect(out).toEqual(expect.objectContaining({ status: 'flagged', detail: expect.objectContaining({ action: 'created', reason: 'several_matches', candidates: 2 }) }))
    expect(db.rows('patients').find(p => p['patient_id'] === out.patientId)).toEqual(expect.objectContaining({ possible_duplicate_of: 'p-by-mobile' }))
  })

  it('a match already linked to another EHR id: a new patient, flagged', async () => {
    const db = world([existing({ patient_id: 'p-other-ehr' })], [{ link_id: 'l1', clinic_id: CLINIC, patient_id: 'p-other-ehr', system: 'keragon', external_patient_id: 'EHR-SOMEONE-ELSE' }])
    const out = await applyPatientEvent(db.client, ctx, patientOf(FULL))
    expect(out).toEqual(expect.objectContaining({ status: 'flagged', detail: expect.objectContaining({ reason: 'match_linked_elsewhere' }) }))
    expect(db.rows('patients').find(p => p['patient_id'] === out.patientId)).toEqual(expect.objectContaining({ possible_duplicate_of: 'p-other-ehr' }))
  })

  it('only active patients of this clinic are candidates', async () => {
    const db = world([
      existing({ patient_id: 'p-other-clinic', clinic_id: OTHER_CLINIC }),
      existing({ patient_id: 'p-deleted', is_active: false, deleted_at: '2026-10-01T00:00:00Z' }),
    ])
    const out = await applyPatientEvent(db.client, ctx, patientOf(FULL))
    expect(out).toEqual(expect.objectContaining({ status: 'applied', detail: expect.objectContaining({ action: 'created' }) }))
    expect(db.rows('patients').find(p => p['patient_id'] === out.patientId)!['possible_duplicate_of']).toBeNull()
  })
})

describe('what a patient entered at self-intake', () => {
  it('is never overwritten: the EHR value is kept for staff, the event flagged; other fields still update', async () => {
    const self = existing({ patient_id: 'p-self', source: 'staff', intake_completed_at: '2026-10-10T10:00:00Z', city: 'Round Rock', sex: 'unknown', email: 'old@example.com' })
    const db = world([self], [{ link_id: 'l1', clinic_id: CLINIC, patient_id: 'p-self', system: 'keragon', external_patient_id: 'EHR-DEMO-10001' }])
    const out = await applyPatientEvent(db.client, ctx, patientOf(FULL))
    // Kept: what the patient entered (city, sex). Updated: what they left
    // blank (filling a blank overwrites nothing) and what staff entered.
    expect(out).toEqual(expect.objectContaining({ status: 'flagged', patientId: 'p-self', detail: expect.objectContaining({ action: 'updated', fields_kept: ['sex', 'city'], fields_updated: expect.arrayContaining(['email', 'address_line1', 'allergies']) }) }))
    expect((out.detail as { fields_updated: string[] }).fields_updated).not.toContain('city')
    const p = db.rows('patients')[0]!
    expect(p).toEqual(expect.objectContaining({ city: 'Round Rock', sex: 'unknown', email: 'jordan.sample@example.com' }))
    expect(db.rows('patient_field_changes')).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'city', old_value: 'Round Rock', new_value: 'Austin', applied: false }),
      expect.objectContaining({ field: 'email', applied: true }),
    ]))
  })

  it('SMS consent a patient gave is never touched', async () => {
    const self = existing({ patient_id: 'p-consent', sms_opt_in: true, sms_consent_at: '2026-10-10T10:00:00Z', sms_consent_source: 'self_intake' })
    const db = world([self], [{ link_id: 'l1', clinic_id: CLINIC, patient_id: 'p-consent', system: 'keragon', external_patient_id: 'EHR-DEMO-10001' }])
    await applyPatientEvent(db.client, ctx, patientOf(FULL, { sms_opt_in: false }))
    for (const w of db.writes('patients')) expect(Object.keys(w.payload as object).filter(k => k.startsWith('sms'))).toEqual([])
    expect(db.rows('patients')[0]).toEqual(expect.objectContaining({ sms_opt_in: true, sms_consent_source: 'self_intake' }))
  })
})

describe('what goes to the log', () => {
  it('ids, codes and field names only: no name, DOB, mobile, email, address or allergy', async () => {
    const db = world([existing({ patient_id: 'p-twin', first_name: 'Morgan' })])
    const out = await applyPatientEvent(db.client, ctx, patientOf(FULL))
    const logged = JSON.stringify(out)
    for (const phi of ['Jordan', 'Sample', '1985-04-12', '5125550147', 'jordan.sample', 'Example St', 'Austin', 'Penicillin', 'Morgan']) expect(logged).not.toContain(phi)
  })
})
