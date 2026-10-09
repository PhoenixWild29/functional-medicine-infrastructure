// ============================================================
// Settings, Team (Compliance C4)
// /settings/team
// ============================================================
//
// Each provider's NPI status and state licenses. The clinic admin sees the
// clinic's providers and can add or edit licenses and re-run the NPI check;
// a provider sees their own credentials, read-only; a medical assistant
// gets a notice. Read through the session client (RLS: own clinic only).
// Full invite and add-provider flows come later.

import Link from 'next/link'
import { createServerClient } from '@/lib/supabase/server'
import { SessionGuardNotice } from '@/components/session-guard-notice'
import { todayUtc } from '@/lib/providers/credentials'
import { CredentialsEditor } from './_components/credentials-editor'
import { getUserClinicId, getUserRole } from '@/lib/auth/claims'

export const metadata = {
  title: 'Team',
}

interface ProviderRow {
  provider_id: string
  first_name:  string
  last_name:   string
  npi_number:  string
  user_id:     string | null
}
interface VerificationRow {
  provider_id:  string
  npi:          string
  status:       string
  reason:       string | null
  taxonomy_desc: string | null
  checked_at:   string
  source:       string
}
interface LicenseRow {
  provider_id:    string
  state:          string
  license_number: string
  expires_on:     string
  source:         string
}

const NPI_LABEL: Record<string, string> = {
  verified:   'Verified',
  unverified: 'Not verified: the registry could not be reached',
  mismatch:   'Does not match the registry',
  not_found:  'Not in the registry',
  invalid:    'Not a valid NPI',
}

function npiStatus(p: ProviderRow, v: VerificationRow | undefined): { label: string; ok: boolean } {
  if (!v) return { label: 'Not checked yet', ok: false }
  if (v.npi !== p.npi_number) return { label: 'NPI changed since it was checked', ok: false }
  return { label: NPI_LABEL[v.status] ?? v.status, ok: v.status === 'verified' }
}

function licenseStatus(expiresOn: string, today: string): { label: string; tone: 'ok' | 'warn' | 'bad' } {
  if (expiresOn < today) return { label: `Expired ${expiresOn}`, tone: 'bad' }
  const days = Math.round((Date.parse(`${expiresOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
  if (days <= 30) return { label: `Expires ${expiresOn} (in ${days} day${days === 1 ? '' : 's'})`, tone: 'warn' }
  return { label: `Active until ${expiresOn}`, tone: 'ok' }
}

const TONE: Record<'ok' | 'warn' | 'bad', string> = {
  ok:   'text-emerald-700',
  warn: 'text-amber-700',
  bad:  'text-red-700',
}

export default async function TeamPage() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return <SessionGuardNotice />

  const clinicId = getUserClinicId(user) ?? null
  if (!clinicId) {
    return <SessionGuardNotice title="No clinic linked" message="Your account is not linked to a clinic. Contact your administrator." />
  }
  const role = getUserRole(user)
  const isAdmin = role === 'clinic_admin'
  if (!isAdmin && role !== 'provider') {
    return (
      <main className="mx-auto max-w-5xl px-4 py-8">
        <section className="rounded-lg border border-border bg-card p-6" data-testid="team-not-available">
          <h1 className="text-lg font-semibold text-foreground">Team</h1>
          <p className="mt-2 text-sm text-muted-foreground">Provider credentials are shown to the clinic admin and to each provider.</p>
        </section>
      </main>
    )
  }

  let providersQuery = supabase
    .from('providers')
    .select('provider_id, first_name, last_name, npi_number, user_id')
    .eq('clinic_id', clinicId)
    .eq('is_active', true)
    .is('deleted_at', null)
  if (!isAdmin) providersQuery = providersQuery.eq('user_id', user.id)
  const { data: providerData, error: providerError } = await providersQuery.order('last_name', { ascending: true })

  const providers = (providerData ?? []) as ProviderRow[]
  const ids = providers.map(p => p.provider_id)
  const [verRes, licRes] = ids.length
    ? await Promise.all([
        supabase.from('provider_npi_verifications').select('provider_id, npi, status, reason, taxonomy_desc, checked_at, source').in('provider_id', ids),
        supabase.from('provider_state_licenses').select('provider_id, state, license_number, expires_on, source').in('provider_id', ids).order('state', { ascending: true }),
      ])
    : [{ data: [], error: null }, { data: [], error: null }]

  if (providerError || verRes.error || licRes.error) {
    console.error('[team] read failed:', (providerError ?? verRes.error ?? licRes.error)?.message)
    return (
      <main className="mx-auto max-w-5xl px-4 py-8">
        <section role="alert" className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-800" data-testid="team-error">
          Provider credentials could not be loaded. This is an error, not an empty team. Reload the page to try again.
        </section>
      </main>
    )
  }

  const verifications = new Map(((verRes.data ?? []) as VerificationRow[]).map(v => [v.provider_id, v]))
  const licenses = (licRes.data ?? []) as LicenseRow[]
  const today = todayUtc()

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 space-y-6">
      <div>
        <Link href="/settings" className="text-xs text-muted-foreground underline hover:text-foreground">Clinic Settings</Link>
        <h1 className="mt-2 text-2xl font-bold text-foreground">Team</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          A provider can sign a prescription only with a verified NPI and an active license in the patient&apos;s state.
          {isAdmin ? ' Add or update licenses and re-run the NPI check here.' : ' Your clinic admin keeps these up to date.'}
        </p>
      </div>

      {providers.length === 0 && (
        <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground" data-testid="team-empty">
          {isAdmin ? 'No active providers in this clinic yet.' : 'Your login is not linked to a provider record. Contact your administrator.'}
        </p>
      )}

      {providers.map(p => {
        const v = verifications.get(p.provider_id)
        const npi = npiStatus(p, v)
        const mine = licenses.filter(l => l.provider_id === p.provider_id)
        return (
          <section key={p.provider_id} className="rounded-lg border border-border bg-card p-6 space-y-4" data-testid={`team-provider-${p.provider_id}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-base font-semibold text-foreground">{p.first_name} {p.last_name}</h2>
              <p className="text-sm text-muted-foreground">
                NPI {p.npi_number}{' '}
                <span className={npi.ok ? TONE.ok : TONE.bad} data-testid={`npi-status-${p.provider_id}`}>{npi.label}</span>
                {v?.source === 'demo_seed' && <span className="ml-1 text-xs">(demo record, not checked against the registry)</span>}
              </p>
            </div>
            {v?.reason && v.status !== 'verified' && v.source !== 'demo_seed' && <p className="text-xs text-muted-foreground">{v.reason}</p>}

            {mine.length === 0 ? (
              <p className="text-sm text-amber-700" data-testid={`no-licenses-${p.provider_id}`}>No state licenses on file: this provider cannot sign.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr><th scope="col" className="py-1 pr-4">State</th><th scope="col" className="py-1 pr-4">License</th><th scope="col" className="py-1">Status</th></tr>
                </thead>
                <tbody>
                  {mine.map(l => {
                    const s = licenseStatus(l.expires_on, today)
                    return (
                      <tr key={l.state} className="border-t border-border">
                        <td className="py-1 pr-4 text-foreground">{l.state}</td>
                        <td className="py-1 pr-4 text-foreground">{l.license_number}</td>
                        <td className={`py-1 ${TONE[s.tone]}`}>{s.label}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}

            {isAdmin && <CredentialsEditor providerId={p.provider_id} providerName={`${p.first_name} ${p.last_name}`} demoRecord={v?.source === 'demo_seed'} />}
          </section>
        )
      })}
    </main>
  )
}
