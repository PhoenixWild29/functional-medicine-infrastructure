// ============================================================
// PUT /api/onboarding/practice — onboarding step 1 (clinic admin)
// ============================================================
//
// Legal name, DBA, address, phone, practice NPI (Type 2, optional), tax
// ID last 4 only, and who pays shipping. Validated server-side; a whole
// tax ID is refused. Saving marks the step complete.

import { NextRequest, NextResponse } from 'next/server'
import { requireOnboardingAdmin, readJson, setStep } from '@/lib/onboarding/access'
import { validatePracticeDetails } from '@/lib/onboarding/practice'

export async function PUT(request: NextRequest): Promise<NextResponse> {
  const access = await requireOnboardingAdmin({ editable: true })
  if (!access.ok) return access.response
  const { user, clinicId, supabase } = access

  const body = await readJson(request)
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  const v = validatePracticeDetails(body)
  if (!v.ok) return NextResponse.json({ error: 'Check the highlighted fields.', errors: v.errors }, { status: 400 })

  const p = v.value
  const { error } = await supabase
    .from('clinics')
    .update({
      legal_name:      p.legalName,
      dba_name:        p.dbaName,
      address_line1:   p.addressLine1,
      address_line2:   p.addressLine2,
      city:            p.city,
      state:           p.state,
      postal_code:     p.postalCode,
      contact_phone:   p.phone,
      practice_npi:    p.practiceNpi,
      tax_id_last4:    p.taxIdLast4,
      absorb_shipping: p.absorbShipping,
      updated_at:      new Date().toISOString(),
    })
    .eq('clinic_id', clinicId)
  if (error) {
    console.error(`[onboarding/practice] save failed | clinic=${clinicId}: ${error.message}`)
    return NextResponse.json({ error: 'The practice details could not be saved. Try again.' }, { status: 500 })
  }
  const step = await setStep(supabase, clinicId, 'practice', 'complete', user.id)
  if (!step.ok) return NextResponse.json({ error: 'Saved, but your progress could not be recorded. Try again.' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
