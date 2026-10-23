// ============================================================
// /api/ops/onboarding/clinics/[clinicId] (ops_admin)
// ============================================================
//
// GET   the clinic's review details (practice, providers with the NPI
//       registry result and licenses, staff invites, agreements,
//       history): lib/onboarding/review. Read-only.
//
// POST:
// { action: 'approve' }               activate the clinic
// { action: 'send_back', note }        return it to the admin with a note
//
// Approving a clinic with a provider whose NPI is not verified in the
// national registry needs { licenseChecked: true } (422 otherwise): ops
// checked that license with the state board. The approval event's note
// records it. Only a SUBMITTED clinic can be reviewed (409 otherwise). Approval sets
// clinics.is_active and onboarding_status 'approved': from then on the
// clinic can sign and send (batch-sign checks both). Both actions record
// who and when on the clinic and in the onboarding audit log.

import { NextRequest, NextResponse } from 'next/server'
import { requireOpsAdmin, readJson } from '@/lib/onboarding/access'
import { recordOnboardingEvent } from '@/lib/onboarding/events'
import { UUID_RE } from '@/lib/providers/team-access'
import { loadClinicReview } from '@/lib/onboarding/review'
import { LICENSE_CHECK_REQUIRED_MESSAGE, licenseCheckNote, loadProviderSummaries, type ProviderSummary } from '@/lib/onboarding/provider-review'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ clinicId: string }> }): Promise<NextResponse> {
  const access = await requireOpsAdmin()
  if (!access.ok) return access.response
  const { clinicId } = await params
  if (!UUID_RE.test(clinicId)) return NextResponse.json({ error: 'Invalid clinic id' }, { status: 400 })
  try {
    const review = await loadClinicReview(access.supabase, clinicId)
    if (!review) return NextResponse.json({ error: 'Clinic not found' }, { status: 404 })
    return NextResponse.json(review, { headers: { 'cache-control': 'no-store' } })
  } catch (err) {
    console.error(`[ops/onboarding] review read failed | clinic=${clinicId}:`, err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'The clinic review could not be loaded. Try again.' }, { status: 503 })
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ clinicId: string }> }): Promise<NextResponse> {
  const access = await requireOpsAdmin()
  if (!access.ok) return access.response
  const { user, supabase } = access
  const { clinicId } = await params
  if (!UUID_RE.test(clinicId)) return NextResponse.json({ error: 'Invalid clinic id' }, { status: 400 })

  const body = await readJson(request)
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  const action = body['action']
  const note = typeof body['note'] === 'string' ? body['note'].trim().slice(0, 2000) : ''
  if (action !== 'approve' && action !== 'send_back') {
    return NextResponse.json({ error: 'action must be approve or send_back' }, { status: 400 })
  }
  if (action === 'send_back' && !note) {
    return NextResponse.json({ error: 'Write a note telling the clinic what to change.' }, { status: 400 })
  }

  const { data: clinic, error } = await supabase
    .from('clinics')
    .select('clinic_id, name, onboarding_status')
    .eq('clinic_id', clinicId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) {
    console.error(`[ops/onboarding] clinic read failed | clinic=${clinicId}: ${error.message}`)
    return NextResponse.json({ error: 'The clinic could not be read. Try again.' }, { status: 503 })
  }
  if (!clinic) return NextResponse.json({ error: 'Clinic not found' }, { status: 404 })
  if (clinic.onboarding_status !== 'submitted') {
    return NextResponse.json({ error: 'Only a submitted clinic can be approved or sent back.' }, { status: 409 })
  }

  // A provider whose NPI is not verified in the national registry: approve
  // only after ops confirms they checked the license with the state board
  // (licenseChecked: true). The confirmation is the approval event's note.
  let approvalNote: string | null = null
  if (action === 'approve') {
    let summaries: ProviderSummary[]
    try {
      summaries = (await loadProviderSummaries(supabase, [{ clinicId, signupSource: null }])).get(clinicId) ?? []
    } catch (err) {
      console.error(`[ops/onboarding] providers read failed | clinic=${clinicId}:`, err instanceof Error ? err.message : err)
      return NextResponse.json({ error: 'The clinic’s providers could not be checked. Try again.' }, { status: 503 })
    }
    const unverified = summaries.filter(p => !p.npiVerified).map(p => p.name)
    if (unverified.length > 0) {
      if (body['licenseChecked'] !== true) {
        return NextResponse.json({ error: LICENSE_CHECK_REQUIRED_MESSAGE, code: 'LICENSE_CHECK_REQUIRED', unverified }, { status: 422 })
      }
      approvalNote = licenseCheckNote(unverified)
    }
  }

  const now = new Date().toISOString()
  const patch = action === 'approve'
    ? { is_active: true, onboarding_status: 'approved', onboarding_reviewed_at: now, onboarding_reviewed_by: user.id, onboarding_review_note: null, updated_at: now }
    : { onboarding_status: 'changes_requested', onboarding_reviewed_at: now, onboarding_reviewed_by: user.id, onboarding_review_note: note, updated_at: now }

  const { error: updErr } = await supabase
    .from('clinics')
    .update(patch)
    .eq('clinic_id', clinicId)
    .eq('onboarding_status', 'submitted')
  if (updErr) {
    console.error(`[ops/onboarding] review failed | clinic=${clinicId} action=${action}: ${updErr.message}`)
    return NextResponse.json({ error: 'The review could not be saved. Try again.' }, { status: 500 })
  }

  await recordOnboardingEvent(supabase, {
    clinicId, event: action === 'approve' ? 'approved' : 'sent_back', actorUserId: user.id, actorRole: 'ops_admin',
    note: action === 'send_back' ? note : approvalNote,
  })
  console.info(`[ops/onboarding] clinic ${action === 'approve' ? 'approved' : 'sent back'} | clinic=${clinicId} by=${user.id}`)
  return NextResponse.json({ ok: true, onboardingStatus: patch.onboarding_status })
}
