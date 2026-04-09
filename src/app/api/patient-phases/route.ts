// ============================================================
// Patient Protocol Phase Management API — WO-86
// ============================================================
//
// GET  /api/patient-phases?patient_id=xxx     → list active protocols + current phases for a patient
// POST /api/patient-phases                    → start a patient on a protocol or advance phase
// PATCH /api/patient-phases?tracking_id=xxx   → update status (pause, complete, discontinue)

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createServerClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const supabaseAuth = await createServerClient()
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServiceClient()
  const { searchParams } = new URL(req.url)
  const patientId = searchParams.get('patient_id')

  if (!patientId) return NextResponse.json({ error: 'Missing patient_id' }, { status: 400 })

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

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}

export async function POST(req: NextRequest) {
  const supabaseAuth = await createServerClient()
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServiceClient()
  const body = await req.json()

  // Start patient on protocol or advance phase
  if (body.action === 'start') {
    const { patient_id, protocol_id, initial_phase, provider_id } = body
    if (!patient_id || !protocol_id || !initial_phase) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

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

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ data }, { status: 201 })
  }

  if (body.action === 'advance') {
    const { tracking_id, new_phase, provider_id, reason, lab_results } = body
    if (!tracking_id || !new_phase) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Get current phase for history
    const { data: current } = await supabase
      .from('patient_protocol_phases')
      .select('current_phase')
      .eq('tracking_id', tracking_id)
      .single()

    if (!current) return NextResponse.json({ error: 'Tracking not found' }, { status: 404 })

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

    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

    // Log advancement history
    await supabase.from('phase_advancement_history').insert({
      tracking_id,
      from_phase: current.current_phase,
      to_phase: new_phase,
      advanced_by: provider_id ?? null,
      reason: reason ?? null,
      lab_results: lab_results ?? null,
    })

    return NextResponse.json({ ok: true, from: current.current_phase, to: new_phase })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}

export async function PATCH(req: NextRequest) {
  const supabaseAuth = await createServerClient()
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServiceClient()
  const { searchParams } = new URL(req.url)
  const trackingId = searchParams.get('tracking_id')
  if (!trackingId) return NextResponse.json({ error: 'Missing tracking_id' }, { status: 400 })

  const body = await req.json()
  const { status: newStatus } = body as { status: string }

  if (!['active', 'paused', 'completed', 'discontinued'].includes(newStatus)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  const { error } = await supabase
    .from('patient_protocol_phases')
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq('tracking_id', trackingId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
