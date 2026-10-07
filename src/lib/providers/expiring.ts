// ============================================================
// Licenses about to expire, for the dashboard (Compliance C4)
// ============================================================
//
// The clinic admin sees every provider's licenses that expire within 30
// days; a provider sees their own. Anyone else sees none. Read through the
// caller's session client (RLS). A warning that cannot be loaded is
// logged and left out: it never breaks the dashboard.

import { expiringLicenses, todayUtc } from './credentials'

export interface ExpiringLicense {
  providerName: string
  state:        string
  expiresOn:    string
  daysLeft:     number
}

type Query = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any
}

export async function loadExpiringLicenses(
  supabase: Query,
  who: { clinicId: string; userId: string; role: string | undefined },
  today: string = todayUtc(),
  days = 30,
): Promise<ExpiringLicense[]> {
  if (who.role !== 'clinic_admin' && who.role !== 'provider') return []
  try {
    let q = supabase.from('providers')
      .select('provider_id, first_name, last_name')
      .eq('clinic_id', who.clinicId)
      .eq('is_active', true)
      .is('deleted_at', null)
    if (who.role === 'provider') q = q.eq('user_id', who.userId)
    const { data: providers, error: providersError } = await q
    if (providersError) throw new Error(providersError.message)
    const list = (providers ?? []) as Array<{ provider_id: string; first_name: string; last_name: string }>
    if (list.length === 0) return []

    const until = new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
    const { data: licenses, error: licensesError } = await supabase.from('provider_state_licenses')
      .select('provider_id, state, license_number, expires_on')
      .in('provider_id', list.map(p => p.provider_id))
      .gte('expires_on', today)
      .lte('expires_on', until)
    if (licensesError) throw new Error(licensesError.message)

    const names = new Map(list.map(p => [p.provider_id, `${p.first_name} ${p.last_name}`]))
    const rows = ((licenses ?? []) as Array<{ provider_id: string; state: string; license_number: string; expires_on: string }>)
      .map(l => ({ providerId: l.provider_id, state: l.state, licenseNumber: l.license_number, expiresOn: l.expires_on }))
    return expiringLicenses(rows, today, days).map(l => ({
      providerName: names.get(l.providerId) ?? 'A provider',
      state:        l.state,
      expiresOn:    l.expiresOn,
      daysLeft:     l.daysLeft,
    }))
  } catch (err) {
    console.error('[dashboard] expiring licenses could not be read:', err instanceof Error ? err.message : err)
    return []
  }
}
