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

import { NextRequest, NextResponse } from 'next/server'
import type { User } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'
import { createServerClient } from '@/lib/supabase/server'
import { logPhiAccess } from '@/lib/audit/phi-access'
import { getUserClinicId, getUserRole } from '@/lib/auth/claims'

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
    return { ok: false, response: NextResponse.json({ error: 'Forbidden — protocol phases are kept by clinic staff' }, { status: 403 }) }
  }
  if (change && role !== 'provider') {
    return { ok: false, response: NextResponse.json({ error: 'Only a provider can change a patient\'s protocol phase.' }, { status: 403 }) }
  }
  return { ok: true, user, clinicId }
}

const NOT_FOUND = () => NextResponse.json({ error: 'Not found' }, { status: 404 })
const READ_FAILED = () => NextResponse.json({ error: 'The record could not be read. Nothing was changed — try again.' }, { status: 500 })
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
    return { ok: false, response: NextResponse.json({ error: 'The current phase could not be read. Nothing was changed — try again.' }, { status: 500 }) }
  }
  const row = current as { current_phase: string; patient_id: string } | null
  if (!row) return { ok: false, response: NextResponse.json({ error: 'Tracking not found' }, { status: 404 }) }
  const inClinic = await patientInClinic(supabase, row.patient_id, clinicId)
  if (inClinic === 'error') return { ok: false, response: READ_FAILED() }
  if (inClinic === 'no') return { ok: false, response: NextResponse.json({ error: 'Tracking not found' }, { status: 404 }) }
  return { ok: true, patientId: row.patient_id, currentPhase: row.current_phase }
}

export async function GET(req: NextRequest) {
  const caller = await resolveCaller(false)
  if (!caller.ok) return caller.response

  const supabase = createServiceClient()
  const { searchParams } = new URL(req.url)
  const patientId = searchParams.get('patient_id')

  if (!patientId) return NextResponse.json({ error: 'Missing patient_id' }, { status: 400 })

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

export async function POST(req: NextRequest) {
  const caller = await resolveCaller(true)
  if (!caller.ok) return caller.response

  const supabase = createServiceClient()
  const body = await req.json()

  // Start patient on protocol or advance phase
  if (body.action === 'start') {
    const { patient_id, protocol_id, initial_phase, provider_id } = body
    if (!patient_id || !protocol_id || !initial_phase) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

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
        advanced_by: provider_id ?? null,
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

  if (body.action === 'advance') {
    const { tracking_id, new_phase, provider_id, reason, lab_results } = body
    if (!tracking_id || !new_phase) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Get current phase for history (only a tracking row of this clinic's patient).
    const current = await trackingInClinic(supabase, tracking_id, caller.clinicId)
    if (!current.ok) return current.response

    // Update to new phase
    const { error: updateErr } = await supabase
      .from('patient_protocol_phases')
      .update({
        current_phase: new_phase,
        phase_started_at: new Date().toISOString(),
        advanced_by: provider_id ?? null,
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
      advanced_by: provider_id ?? null,
      reason: reason ?? null,
      lab_results: lab_results ?? null,
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
      return NextResponse.json({ error: 'The phase change could not be recorded. Nothing was changed — try again.' }, { status: 500 })
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

export async function PATCH(req: NextRequest) {
  const caller = await resolveCaller(true)
  if (!caller.ok) return caller.response

  const supabase = createServiceClient()
  const { searchParams } = new URL(req.url)
  const trackingId = searchParams.get('tracking_id')
  if (!trackingId) return NextResponse.json({ error: 'Missing tracking_id' }, { status: 400 })

  const body = await req.json()
  const { status: newStatus } = body as { status: string }

  if (!['active', 'paused', 'completed', 'discontinued'].includes(newStatus)) {
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
