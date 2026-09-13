// ============================================================
// New Prescription — Step 1: Pharmacy Search — WO-27 + WO-80
// /new-prescription/search
// ============================================================
//
// Moved from /new-prescription to /new-prescription/search as part
// of the WO-80 patient-centric redesign. Patient state is now
// auto-populated from the session context (selected in step 0).
//
// The pharmacy search form reads the patient's shipping state from
// the PrescriptionSession context rather than requiring manual input.
//
// WO-98: the same page reopens an existing line —
//   ?editId=<session line>   Edit from the Review card
//   ?editOrder=<order id>    Edit a draft line (patient/provider pinned)
//   ?addToOrder=<order id>   + Add prescription to a draft (pinned)
// No new page: the builder is pre-selected from the line's values and
// the margin page saves back to the same line / order.

import { WizardProgress }    from '@/components/wizard-progress'
import { HipaaTimeout }      from '@/components/hipaa-timeout'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { loadDraftContext, type DraftContext } from '@/lib/orders/load-draft-context'
import { isProviderRole }    from '@/lib/auth/current-provider'
import { SessionBanner }      from '../_components/session-banner'
import { DraftSessionPin }    from '../_components/draft-session-pin'
import { CascadingPrescriptionBuilder } from '../_components/cascading-prescription-builder'
import { editTargetFromParams } from '../_lib/edit-target'
import { getWizardSteps }    from '../_lib/wizard-steps'

export const metadata = {
  title: 'New Prescription — Find a Pharmacy',
}

interface PageProps {
  searchParams: Promise<{ editId?: string; editOrder?: string; addToOrder?: string }>
}

export default async function PharmacySearchPage({ searchParams }: PageProps) {
  // Session validation — the session context is client-side, so we can't
  // enforce it here. The SessionBanner + PharmacySearchForm will redirect
  // to /new-prescription if no patient is selected.
  const params = await searchParams
  let editTarget = editTargetFromParams(params)

  // One auth read for the page. getUser(), never getSession() — middleware
  // owns token rotation. No redirect() from this streamed page body; a
  // missing user just falls back to the MA label and the plain flow.
  const supabaseAuth = await createServerClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()

  // WO-100: step 1 is labelled "Patient" for a provider (they ARE the
  // provider) and "Patient & Provider" for everyone else.
  const providerIsSelf = isProviderRole(user?.user_metadata['app_role'])
  const WIZARD_STEPS = getWizardSteps({ providerIsSelf, hrefs: { 1: '/new-prescription' } })

  // WO-98: draft targets need the order's patient/provider pinned and
  // the line's current values. Resolved here (service role, clinic-
  // scoped); a missing / non-draft order falls back to the plain flow.
  let draft: DraftContext | null = null
  if (editTarget && editTarget.kind !== 'session') {
    const clinicId = typeof user?.user_metadata['clinic_id'] === 'string'
      ? user.user_metadata['clinic_id'] as string
      : null
    if (clinicId) {
      draft = await loadDraftContext(createServiceClient(), clinicId, editTarget.orderId)
    }
    if (!draft) editTarget = null
  }

  const isEditing = editTarget?.kind === 'session' || editTarget?.kind === 'draft'
  const heading = isEditing
    ? 'Edit Prescription'
    : editTarget?.kind === 'draft-add'
      ? 'Add Prescription to Draft'
      : 'Configure Prescription'

  const body = (
    <>
        {/* Session banner — patient + provider pinned at top */}
        <SessionBanner />

        <div className="mb-6">
          <WizardProgress steps={WIZARD_STEPS} currentStep={2} />
          <h1 className="mt-4 text-2xl font-bold text-foreground">{heading}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isEditing
              ? 'The current values are pre-selected. Change what you need, then continue to save the line in place.'
              : editTarget?.kind === 'draft-add'
                ? 'Patient and provider are pinned from the draft. The new line is added next to it.'
                : 'Search for the medication, select formulation and pharmacy, set dose and frequency.'}
          </p>
          {editTarget?.kind === 'draft' && draft && (
            <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800" data-testid="draft-edit-notice">
              Editing draft line <strong>{draft.medicationName}</strong> — the draft keeps its order id.
            </p>
          )}
        </div>

        <CascadingPrescriptionBuilder
          editTarget={editTarget}
          initial={draft && editTarget?.kind === 'draft' ? draft.initial : null}
        />
    </>
  )

  return (
    <>
      <HipaaTimeout />
      <main className="mx-auto max-w-2xl px-4 py-8">
        {/* WO-98: a draft target pins its patient/provider on the session
            before the banner + builder mount (see DraftSessionPin). */}
        {draft
          ? <DraftSessionPin patient={draft.patient} provider={draft.provider}>{body}</DraftSessionPin>
          : body}
      </main>
    </>
  )
}
