// ============================================================
// Patient Protocol Phase Management API — WO-86
// ============================================================
//
// GET  /api/patient-phases?patient_id=xxx     → list active protocols + current phases for a patient
// POST /api/patient-phases                    → start a patient on a protocol or advance phase
// PATCH /api/patient-phases?tracking_id=xxx   → update status (pause, complete, discontinue)
//
// Access (found open while wiring Compliance C2): any signed-in user of
// any clinic could read or change any patient's phases by id. Now:
//   - getUser(), never getSession(): the token is verified;
//   - clinic staff only (provider, medical assistant, clinic admin), and
//     changing a phase (start, advance, status) is the provider's, a
//     clinical decision;
//   - every read and write is scoped to the caller's clinic: a patient,
//     protocol or tracking row of another clinic is 404, nothing written.
//
// Input (after auth, before any read or write): ids are ids (a bad id
// reaching Postgres was a 500, error 22P02), phase names and the reason
// are bounded, the status is a closed set, and a body that is not JSON is
// a 400 (lib/api/input).

import { NextRequest, NextResponse } from 'next/server'
import type { User } from '@supabase/supabase-js'
import type { Json } from '@/types/database.types'
import { createServiceClient } from '@/lib/supabase/service'
import { createServerClient } from '@/lib/supabase/server'
import { logPhiAccess } from '@/lib/audit/phi-access'
import { getUserClinicId, getUserRole } from '@/lib/auth/claims'
import { withApiErrors } from '@/lib/api/with-api-errors'
import { resolveCurrentProvider } from '@/lib/auth/current-provider'
import { refuseCrossSite } from '@/lib/security/same-origin'
import { z } from 'zod'
import { MAX_NAME, MAX_NOTE, boundedText, parseInput, parseJsonBody, uuid } from '@/lib/api/input'

const STAFF_ROLES = new Set(['provider', 'medical_assistant', 'clinic_admin'])

type Supabase = ReturnType<typeof createServiceClient>

type Caller =
  | { ok: true; user: User; clinicId: string }
  | { ok: false; response: NextResponse }

/** The verified clinic user; `change` requires the provider. */
async function resolveCaller(change: boolean): Promise<Caller> {
  const supabaseAuth = await createServerClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const role = getUserRole(user) ?? null
  const clinicId = getUserClinicId(user) ?? null
  if (!clinicId || !role || !STAFF_ROLES.has(role)) {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden: protocol phases are kept by clinic staff' }, { status: 403 }) }
  }
  if (change && role !== 'provider') {
    return { ok: false, response: NextResponse.json({ error: 'Only a provider can change a patient\'s protocol phase.' }, { status: 403 }) }
  }
  return { ok: true, user, clinicId }
}

const STATUSES = ['active', 'paused', 'completed', 'discontinued'] as const

// A phase name ('loading', 'maintenance', ...) and the provider's reason.
const phase = () => boundedText(MAX_NAME).min(1)
const optionalId = () => uuid().nullish()
const StartBody = z.object({
  action:        z.literal('start'),
  patient_id:    uuid(),
  protocol_id:   uuid(),
  initial_phase: phase(),
  provider_id:   optionalId(),
})
const AdvanceBody = z.object({
  action:      z.literal('advance'),
  tracking_id: uuid(),
  new_phase:   phase(),
  provider_id: optionalId(),
  reason:      boundedText(MAX_NOTE).nullish(),
  // Stored as JSONB on the history row; its shape is the caller's.
  lab_results: z.unknown().optional(),
})

const NOT_FOUND = () => NextResponse.json({ error: 'Not found' }, { status: 404 })
const READ_FAILED = () => NextResponse.json({ error: 'The record could not be read. Nothing was changed. Try again.' }, { status: 500 })
// A failed write answers this, never the database's own text (it can quote
// the row); the detail is logged.
const WRITE_FAILED = () => NextResponse.json({ error: 'The change could not be saved. Nothing was changed, try again.' }, { status: 500 })

/** Whether the patient is the caller's clinic's: 'yes', 'no', or 'error'. */
async function patientInClinic(supabase: Supabase, patientId: string, clinicId: string): Promise<'yes' | 'no' | 'error'> {
  const { data, error } = await supabase
    .from('patients')
    .select('patient_id')
    .eq('patient_id', patientId)
    .eq('clinic_id', clinicId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) {
    console.error('[patient-phases] patient scope read failed:', error.message)
    return 'error'
  }
  return data ? 'yes' : 'no'
}

/** A tracking row, when its patient is the caller's clinic's. */
async function trackingInClinic(
  supabase: Supabase,
  trackingId: string,
  clinicId: string,
): Promise<{ ok: true; patientId: string; currentPhase: string } | { ok: false; response: NextResponse }> {
  const { data: current, error: currentErr } = await supabase
    .from('patient_protocol_phases')
    .select('current_phase, patient_id')
    .eq('tracking_id', trackingId)
    .maybeSingle()
  if (currentErr) {
    console.error('[patient-phases] current phase read failed:', currentErr.message, '| tracking=', trackingId)
    return { ok: false, response: NextResponse.json({ error: 'The current phase could not be read. Nothing was changed. Try again.' }, { status: 500 }) }
  }
  const row = current as { current_phase: string; patient_id: string } | null
  if (!row) return { ok: false, response: NextResponse.json({ error: 'Tracking not found' }, { status: 404 }) }
  const inClinic = await patientInClinic(supabase, row.patient_id, clinicId)
  if (inClinic === 'error') return { ok: false, response: READ_FAILED() }
  if (inClinic === 'no') return { ok: false, response: NextResponse.json({ error: 'Tracking not found' }, { status: 404 }) }
  return { ok: true, patientId: row.patient_id, currentPhase: row.current_phase }
}

async function getHandler(req: NextRequest) {
  const caller = await resolveCaller(false)
  if (!caller.ok) return caller.response

  const supabase = createServiceClient()
  const { searchParams } = new URL(req.url)
  const patientId = searchParams.get('patient_id')

  if (!patientId) return NextResponse.json({ error: 'Missing patient_id' }, { status: 400 })
  const query = parseInput(z.object({ patient_id: uuid() }), { patient_id: patientId })
  if (!query.ok) return query.response

  const inClinic = await patientInClinic(supabase, patientId, caller.clinicId)
  if (inClinic === 'error') return READ_FAILED()
  if (inClinic === 'no') return NOT_FOUND()

  const { data, error } = await supabase
    .from('patient_protocol_phases')
    .select(`
      tracking_id,
      current_phase,
      phase_started_at,
      status,
      advancement_note,
      created_at,
      protocol_templates (
        protocol_id,
        name,
        description,
        therapeutic_category,
        total_duration_weeks
      ),
      providers:advanced_by (
        first_name,
        last_name
      )
    `)
    .eq('patient_id', patientId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[patient-phases] phases read failed:', error.message)
    return READ_FAILED()
  }
  // Compliance C2: the patient's protocol phases were read.
  await logPhiAccess({ user: caller.user, action: 'view', resource: 'patient_phases', route: '/api/patient-phases', patientId, headers: req.headers ?? null })
  return NextResponse.json({ data })
}

/**
 * Who advanced the phase: the signed-in provider (their own provider row
 * in this clinic), never an id from the body. A body provider_id naming
 * anyone else is refused, not ignored: it is a client bug or a forgery,
 * and the record of who changed a treatment phase must not be put down to
 * another provider. A provider login with no linked provider row cannot
 * act as a provider (fail closed, lib/auth/current-provider).
 */
async function recordedAs(
  supabase: Supabase, caller: { user: User; clinicId: string }, named: unknown,
): Promise<{ ok: true; providerId: string } | { ok: false; response: NextResponse }> {
  const me = await resolveCurrentProvider(supabase, { userId: caller.user.id, clinicId: caller.clinicId })
  if (!me) {
    return { ok: false, response: NextResponse.json({ error: 'This login is not linked to a provider record.' }, { status: 403 }) }
  }
  if (named !== undefined && named !== null && named !== '' && named !== me.provider_id) {
    return { ok: false, response: NextResponse.json({ error: 'You can only record a phase change as yourself.' }, { status: 403 }) }
  }
  return { ok: true, providerId: me.provider_id }
}

async function postHandler(req: NextRequest) {
  const crossSite = refuseCrossSite(req)
  if (crossSite) return crossSite
  const caller = await resolveCaller(true)
  if (!caller.ok) return caller.response

  const parsedBody = await parseJsonBody(req, z.record(z.string(), z.unknown()))
  if (!parsedBody.ok) return parsedBody.response
  const body = parsedBody.data
  const supabase = createServiceClient()


  // Start patient on protocol or advance phase
  if (body['action'] === 'start') {
    if (!body['patient_id'] || !body['protocol_id'] || !body['initial_phase']) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    const start = parseInput(StartBody, body)
    if (!start.ok) return start.response
    const { patient_id, protocol_id, initial_phase } = start.data
    const as = await recordedAs(supabase, caller, start.data.provider_id)
    if (!as.ok) return as.response
    const advancedBy = as.providerId

    // The patient and the protocol must both be this clinic's.
    const inClinic = await patientInClinic(supabase, patient_id, caller.clinicId)
    if (inClinic === 'error') return READ_FAILED()
    if (inClinic === 'no') return NOT_FOUND()
    const { data: protocol, error: protocolErr } = await supabase
      .from('protocol_templates')
      .select('protocol_id')
      .eq('protocol_id', protocol_id)
      .eq('clinic_id', caller.clinicId)
      .maybeSingle()
    if (protocolErr) {
      console.error('[patient-phases] protocol scope read failed:', protocolErr.message)
      return READ_FAILED()
    }
    if (!protocol) return NOT_FOUND()

    const { data, error } = await supabase
      .from('patient_protocol_phases')
      .upsert({
        patient_id,
        protocol_id,
        current_phase: initial_phase,
        advanced_by: advancedBy,
        status: 'active',
      }, { onConflict: 'patient_id,protocol_id' })
      .select()
      .single()

    if (error) {
      console.error('[patient-phases] protocol start failed:', error.message)
      return WRITE_FAILED()
    }
    // Compliance C2: a protocol started for the patient.
    await logPhiAccess({ user: caller.user, action: 'create', resource: 'patient_phases', route: '/api/patient-phases', patientId: patient_id, headers: req.headers ?? null })
    return NextResponse.json({ data }, { status: 201 })
  }

  if (body['action'] === 'advance') {
    if (!body['tracking_id'] || !body['new_phase']) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    const advance = parseInput(AdvanceBody, body)
    if (!advance.ok) return advance.response
    const { tracking_id, new_phase, reason, lab_results } = advance.data
    const as = await recordedAs(supabase, caller, advance.data.provider_id)
    if (!as.ok) return as.response
    const advancedBy = as.providerId

    // Get current phase for history (only a tracking row of this clinic's patient).
    const current = await trackingInClinic(supabase, tracking_id, caller.clinicId)
    if (!current.ok) return current.response

    // Update to new phase
    const { error: updateErr } = await supabase
      .from('patient_protocol_phases')
      .update({
        current_phase: new_phase,
        phase_started_at: new Date().toISOString(),
        advanced_by: advancedBy,
        advancement_note: reason ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('tracking_id', tracking_id)

    if (updateErr) {
      console.error('[patient-phases] phase advance failed:', updateErr.message, '| tracking=', tracking_id)
      return WRITE_FAILED()
    }

    // Log advancement history. An advancement without its history (who,
    // why, which labs) is not kept: put the phase back and say so.
    const { error: historyErr } = await supabase.from('phase_advancement_history').insert({
      tracking_id,
      from_phase: current.currentPhase,
      to_phase: new_phase,
      advanced_by: advancedBy,
      reason: reason ?? null,
      lab_results: (lab_results ?? null) as Json | null,
    })

    if (historyErr) {
      console.error('[patient-phases] history insert failed:', historyErr.message, '| tracking=', tracking_id)
      const { error: revertErr } = await supabase
        .from('patient_protocol_phases')
        .update({ current_phase: current.currentPhase, updated_at: new Date().toISOString() })
        .eq('tracking_id', tracking_id)
      if (revertErr) {
        console.error('[patient-phases] CRITICAL: revert failed:', revertErr.message, '| tracking=', tracking_id)
        return NextResponse.json({
          error: `The phase was advanced to ${new_phase}, but its history could not be recorded and the change could not be undone. Contact support before advancing again.`,
        }, { status: 500 })
      }
      return NextResponse.json({ error: 'The phase change could not be recorded. Nothing was changed. Try again.' }, { status: 500 })
    }

    // Compliance C2: the patient's protocol phase changed.
    await logPhiAccess({
      user: caller.user, action: 'update', resource: 'patient_phases', route: '/api/patient-phases',
      patientId: current.patientId, headers: req.headers ?? null,
    })
    return NextResponse.json({ ok: true, from: current.currentPhase, to: new_phase })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}

async function patchHandler(req: NextRequest) {
  const crossSite = refuseCrossSite(req)
  if (crossSite) return crossSite
  const caller = await resolveCaller(true)
  if (!caller.ok) return caller.response

  const supabase = createServiceClient()
  const { searchParams } = new URL(req.url)
  const trackingId = searchParams.get('tracking_id')
  if (!trackingId) return NextResponse.json({ error: 'Missing tracking_id' }, { status: 400 })
  const query = parseInput(z.object({ tracking_id: uuid() }), { tracking_id: trackingId })
  if (!query.ok) return query.response

  const parsedBody = await parseJsonBody(req, z.record(z.string(), z.unknown()))
  if (!parsedBody.ok) return parsedBody.response
  const newStatus = parsedBody.data['status']

  if (typeof newStatus !== 'string' || !(STATUSES as readonly string[]).includes(newStatus)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  // Only a tracking row of this clinic's patient.
  const current = await trackingInClinic(supabase, trackingId, caller.clinicId)
  if (!current.ok) return current.response

  const { error } = await supabase
    .from('patient_protocol_phases')
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq('tracking_id', trackingId)

  if (error) {
    console.error('[patient-phases] status update failed:', error.message, '| tracking=', trackingId)
    return WRITE_FAILED()
  }
  // Compliance C2: the patient's protocol status changed.
  await logPhiAccess({
    user: caller.user, action: 'update', resource: 'patient_phases', route: '/api/patient-phases',
    patientId: current.patientId, headers: req.headers ?? null,
  })
  return NextResponse.json({ ok: true })
}

export const GET = withApiErrors('/api/patient-phases', getHandler)
export const POST = withApiErrors('/api/patient-phases', postHandler)
export const PATCH = withApiErrors('/api/patient-phases', patchHandler)
