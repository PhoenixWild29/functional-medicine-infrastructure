// ============================================================
// Settings > Patients > Import (Patient Intake spec v1.1, PR 5)
// /settings/patients/import
// ============================================================
//
// The clinic admin and medical assistants import existing patients from a
// CSV. Providers see a notice instead (and Settings does not link them
// here): importing patients is front-office work, and every imported
// patient is checked by the person who uploaded the file.
//
// getUser(), never getSession(); role and clinic from claims.ts. No
// redirect() from the page body.

import { createServerClient } from '@/lib/supabase/server'
import { SessionGuardNotice } from '@/components/session-guard-notice'
import { getUserClinicId, getUserRole } from '@/lib/auth/claims'
import { IMPORT_ROLES } from '@/lib/patients/import/roles'
import Link from 'next/link'
import { ImportWizard } from './_components/import-wizard'

const BACK_LINK = 'text-sm font-medium text-blue-700 underline underline-offset-2 hover:text-blue-800 dark:text-blue-300 dark:hover:text-blue-200 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring'

/** The way back to Settings, above either view. */
function BackToSettings() {
  return (
    <div className="mx-auto max-w-5xl px-4 pt-8">
      <Link href="/settings" className={BACK_LINK}>Back to Settings</Link>
    </div>
  )
}

export const metadata = {
  title: 'Import patients',
}

export default async function ImportPatientsPage() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return <SessionGuardNotice />
  if (!getUserClinicId(user)) {
    return <SessionGuardNotice title="No clinic linked" message="Your account is not linked to a clinic. Contact your administrator." />
  }

  if (!IMPORT_ROLES.has(getUserRole(user) ?? '')) {
    return (
      <main>
        <BackToSettings />
        <div className="mx-auto max-w-5xl px-4 py-6">
          <section className="rounded-lg border border-border bg-card p-6" data-testid="patient-import-staff-only">
            <h1 className="text-lg font-semibold text-foreground">Import patients</h1>
            <p className="mt-2 text-sm text-foreground">Only the clinic admin or a medical assistant can import patients.</p>
          </section>
        </div>
      </main>
    )
  }

  return (
    <main>
      <BackToSettings />
      <ImportWizard />
    </main>
  )
}
