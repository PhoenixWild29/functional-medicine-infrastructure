// ============================================================
// Settings, Access log (Compliance C2)
// /settings/access-log
// ============================================================
//
// Read-only, clinic admin only: who viewed or changed this clinic's
// patients' data, and when. Filter by patient and date range; each row
// shows who acted (their name and email, resolved server-side from the
// actor's user id), their role, the action, the resource and the time.
//
// Providers and medical assistants get a notice and nothing is read. The
// log is read through the session client, so the phi_access_log SELECT
// policy (own clinic only) applies, and the clinic is filtered here too.
// The service role only resolves who acted (lib/audit/access-log-actors);
// it never reads the log.
// The patient list for the filter is read the same way. Opening this page
// is itself logged (view, access_log).

import { patientName } from '@/lib/patients/display'
import Link from 'next/link'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveAccessLogActors } from '@/lib/audit/access-log-actors'
import { SessionGuardNotice } from '@/components/session-guard-notice'
import { logPhiAccess, currentRequestHeaders } from '@/lib/audit/phi-access'
import {
  ACCESS_LOG_PAGE_SIZE,
  actionLabel,
  parseAccessLogFilters,
  resourceLabel,
  roleLabel,
} from '@/lib/audit/access-log-view'
import { getUserClinicId, getUserRole } from '@/lib/auth/claims'

export const metadata = {
  title: 'Access log',
}

interface PageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

interface LogRow {
  id:          string
  occurred_at: string
  actor_user_id: string | null
  actor_role:  string
  action:      string
  resource:    string
}

function when(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

export default async function AccessLogPage({ searchParams }: PageProps = {}) {
  // getUser(), never getSession(). No redirect() from a streamed page body.
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return <SessionGuardNotice />

  const clinicId = getUserClinicId(user) ?? null
  if (!clinicId) {
    return <SessionGuardNotice title="No clinic linked" message="Your account is not linked to a clinic. Contact your administrator." />
  }
  if (getUserRole(user) !== 'clinic_admin') {
    return (
      <main className="mx-auto max-w-5xl px-4 py-8">
        <section className="rounded-lg border border-border bg-card p-6" data-testid="access-log-admin-only">
          <h1 className="text-lg font-semibold text-foreground">Access log</h1>
          <p className="mt-2 text-sm text-muted-foreground">Only the clinic admin can view the access log.</p>
        </section>
      </main>
    )
  }

  const filters = parseAccessLogFilters((await searchParams) ?? {})

  let query = supabase
    .from('phi_access_log')
    .select('id, occurred_at, actor_user_id, actor_role, action, resource')
    .eq('clinic_id', clinicId)
  if (filters.patientId) query = query.eq('patient_id', filters.patientId)
  if (filters.fromIso) query = query.gte('occurred_at', filters.fromIso)
  if (filters.toIsoExclusive) query = query.lt('occurred_at', filters.toIsoExclusive)

  const [logResult, patientsResult] = await Promise.all([
    query.order('occurred_at', { ascending: false }).limit(ACCESS_LOG_PAGE_SIZE),
    supabase
      .from('patients')
      .select('patient_id, first_name, last_name, phone')
      .eq('clinic_id', clinicId)
      .is('deleted_at', null)
      .order('last_name', { ascending: true }),
  ])

  if (logResult.error || patientsResult.error) {
    console.error('[access-log] read failed:', (logResult.error ?? patientsResult.error)?.code ?? 'unknown')
    return (
      <main className="mx-auto max-w-5xl px-4 py-8">
        <section role="alert" className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-800" data-testid="access-log-error">
          The access log could not be loaded. This is an error, not an empty log. Reload the page to try again.
        </section>
      </main>
    )
  }

  const rows = (logResult.data ?? []) as LogRow[]
  const patients = (patientsResult.data ?? []) as Array<{ patient_id: string; first_name: string | null; last_name: string | null; phone: string | null }>
  const actors = await resolveAccessLogActors(createServiceClient(), clinicId, rows.map(r => r.actor_user_id))

  // Opening the log lists the clinic's patients (the filter): itself an access.
  await logPhiAccess({
    user, action: 'view', resource: 'access_log', route: '/settings/access-log',
    patientId: filters.patientId, headers: await currentRequestHeaders(),
  })

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 space-y-6">
      <div>
        <Link href="/settings" className="text-xs text-muted-foreground underline hover:text-foreground">Clinic Settings</Link>
        <h1 className="mt-2 text-2xl font-bold text-foreground">Access log</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Who viewed or changed your patients&apos; information, and when. Read-only; entries cannot be edited or removed.
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4" aria-label="Filter the access log">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Patient
          <select name="patient" defaultValue={filters.patientId ?? ''} className="rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground">
            <option value="">All patients</option>
            {patients.map(p => (
              <option key={p.patient_id} value={p.patient_id}>{patientName(p, 'last-first')}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          From
          <input type="date" name="from" defaultValue={filters.from ?? ''} className="rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          To
          <input type="date" name="to" defaultValue={filters.to ?? ''} className="rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground" />
        </label>
        <button type="submit" className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          Filter
        </button>
      </form>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground" data-testid="access-log-empty">
          No access recorded for these filters.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm" data-testid="access-log-table">
            <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2">Time</th>
                <th scope="col" className="px-4 py-2">Who</th>
                <th scope="col" className="px-4 py-2">Role</th>
                <th scope="col" className="px-4 py-2">Action</th>
                <th scope="col" className="px-4 py-2">What</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-2 whitespace-nowrap text-foreground">{when(r.occurred_at)}</td>
                  <td className="px-4 py-2 text-foreground">
                    <ActorCell actor={r.actor_user_id ? actors[r.actor_user_id] : undefined} />
                  </td>
                  <td className="px-4 py-2 text-foreground">{roleLabel(r.actor_role)}</td>
                  <td className="px-4 py-2 text-foreground">{actionLabel(r.action)}</td>
                  <td className="px-4 py-2 text-foreground">{resourceLabel(r.resource)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === ACCESS_LOG_PAGE_SIZE && (
            <p className="px-4 py-2 text-xs text-muted-foreground">
              Showing the latest {ACCESS_LOG_PAGE_SIZE}. Narrow the dates or pick a patient to see more.
            </p>
          )}
        </div>
      )}
    </main>
  )
}

/** The person's name, and their email beneath it as an email (never as the name). */
function ActorCell({ actor }: { actor: { name: string | null; email: string | null } | undefined }) {
  if (!actor || (!actor.name && !actor.email)) return <span className="text-muted-foreground">Unknown user</span>
  return (
    <>
      {actor.name && <span className="block">{actor.name}</span>}
      {actor.email && <span className="block text-xs text-muted-foreground">{actor.email}</span>}
    </>
  )
}
