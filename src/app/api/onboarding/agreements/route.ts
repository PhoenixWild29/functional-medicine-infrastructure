// ============================================================
// POST /api/onboarding/agreements — BAA and terms (clinic admin)
// ============================================================
//
// { agreement: 'baa' | 'terms', version, signerName, signerTitle }
//
// Records an acceptance in agreement_acceptances (append-only): signer
// name and title, the signed-in user, when, the template version and the
// SHA-256 of the exact template text, computed here from the server's
// copy (a hash sent by the browser is ignored). The version must be the
// current one: a stale page (a template that changed since it loaded)
// is 409, so nobody accepts text they were not shown. Accepting completes
// the step.

import { NextRequest, NextResponse } from 'next/server'
import { requireOnboardingAdmin, readJson, setStep } from '@/lib/onboarding/access'
import { AGREEMENTS, agreementSha256, isAgreementKey } from '@/lib/onboarding/agreements'

export async function POST(request: NextRequest): Promise<NextResponse> {
  const access = await requireOnboardingAdmin({ editable: true })
  if (!access.ok) return access.response
  const { user, clinicId, supabase } = access

  const body = await readJson(request)
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  const key = body['agreement']
  if (!isAgreementKey(key)) return NextResponse.json({ error: 'agreement must be baa or terms' }, { status: 400 })
  const template = AGREEMENTS[key]

  const signerName = typeof body['signerName'] === 'string' ? body['signerName'].trim().slice(0, 200) : ''
  const signerTitle = typeof body['signerTitle'] === 'string' ? body['signerTitle'].trim().slice(0, 200) : ''
  const errors: Record<string, string> = {}
  if (!signerName) errors['signerName'] = 'Enter your full name.'
  if (!signerTitle) errors['signerTitle'] = 'Enter your title.'
  if (Object.keys(errors).length > 0) return NextResponse.json({ error: 'Check the highlighted fields.', errors }, { status: 400 })

  if (body['version'] !== template.version) {
    return NextResponse.json({ error: `The ${template.title} has been updated since this page loaded. Reload and review it again.` }, { status: 409 })
  }

  const { error } = await supabase.from('agreement_acceptances').insert({
    clinic_id:        clinicId,
    agreement:        key,
    template_version: template.version,
    text_sha256:      agreementSha256(template.text),
    signer_name:      signerName,
    signer_title:     signerTitle,
    user_id:          user.id,
  })
  if (error) {
    console.error(`[onboarding/agreements] acceptance not recorded | clinic=${clinicId} agreement=${key}: ${error.message}`)
    return NextResponse.json({ error: 'Your acceptance could not be recorded. Try again.' }, { status: 500 })
  }
  const step = await setStep(supabase, clinicId, key, 'complete', user.id)
  if (!step.ok) return NextResponse.json({ error: 'Accepted, but your progress could not be recorded. Try again.' }, { status: 500 })
  console.info(`[onboarding/agreements] accepted | clinic=${clinicId} agreement=${key} version=${template.version}`)
  return NextResponse.json({ ok: true, version: template.version }, { status: 201 })
}
